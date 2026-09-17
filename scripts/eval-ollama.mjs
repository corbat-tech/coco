#!/usr/bin/env node
/** Real, local inference against an installed Coco package. Run only inside the evaluation sandbox. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const [consumerArg, model = "qwen3.5:4b", outputArg, filter, fixturePath] = process.argv.slice(2);
if (!consumerArg || !outputArg)
  throw new Error("Usage: eval-ollama.mjs <installed-consumer> <model> <output-dir> [case]");
const consumer = await fs.realpath(consumerArg);
const output = path.resolve(outputArg);
const requireInstalled = createRequire(path.join(consumer, "package.json"));
const load = (name) => import(pathToFileURL(requireInstalled.resolve(name)).href);
const { createAgentRuntime, createToolCallingRuntimeTurnRunner } = await load(
  "@corbat-tech/coco/runtime",
);
const tools = await load("@corbat-tech/coco/tools");
const { createProvider } = await load("@corbat-tech/coco");
const tags = await fetch("http://127.0.0.1:11434/api/tags", {
  signal: AbortSignal.timeout(5000),
}).then((r) => r.json());
const installedModel = tags.models.find((m) => m.name === model);
if (!installedModel)
  throw new Error("Model must already be installed locally; no download or cloud fallback");
const builtinFixtures = [
  {
    id: "bug",
    source: "export const sum = values => values.slice(0,-1).reduce((a,b)=>a+b,0);\n",
    prompt:
      "Fix sum in main.mjs: include every number and return 0 for an empty array. Preserve the exported API. Read the file, edit it and test the result.",
    check:
      "assert.equal(m.sum([1,2,3]),6);assert.equal(m.sum([]),0);assert.equal(m.sum([-3,1]),-2);",
  },
  {
    id: "feature",
    source: "export const slugify = text => text;\n",
    prompt:
      "Implement slugify in main.mjs: trim whitespace, lowercase ASCII text, replace consecutive spaces with a single hyphen, preserve existing hyphens. Do not add dependencies. Read, edit and test.",
    check:
      'assert.equal(m.slugify(" Hello   World "),"hello-world");assert.equal(m.slugify("A-B"),"a-b");assert.equal(m.slugify(""),"");',
  },
  {
    id: "refactor",
    source:
      "export function summarize(xs){let total=0;for(const x of xs){total+=x.amount;}let count=0;for(const x of xs){count++;}return {total,count};}\n",
    prompt:
      "Refactor summarize in main.mjs to compute total and count in one traversal. Preserve API and output including empty input; do not mutate input. Read, edit and test.",
    check:
      'let reads=0;const xs=new Proxy(Object.freeze([Object.freeze({amount:3}),Object.freeze({amount:5})]),{get(target,key,receiver){if(key==="0"||key==="1")reads++;return Reflect.get(target,key,receiver);}});assert.deepEqual(m.summarize(xs),{total:8,count:2});assert.equal(reads,2,"must read each input element once");assert.deepEqual(m.summarize([]),{total:0,count:0});assert.equal(xs.length,2);',
  },
  {
    id: "recovery",
    source: "export const isEven = n => n % 2 === 1;\n",
    prompt:
      "First try reading missing.mjs to check whether the old implementation exists. If it is missing, recover by finding main.mjs and fix its isEven implementation. Preserve API and test negative numbers, zero and positive numbers. Report the missing file honestly.",
    check:
      "assert.equal(m.isEven(0),true);assert.equal(m.isEven(-2),true);assert.equal(m.isEven(3),false);",
  },
  {
    id: "session",
    source: 'export const greet = name => "Hello " + name;\n',
    prompt:
      "Read main.mjs and USER_NOTE.txt. Remember: preserve the Hello prefix and do not change USER_NOTE.txt. Do not edit anything yet; summarize these constraints.",
    followup:
      "Now change greet to trim whitespace around the name while preserving the previous constraints. Read, edit and test. The empty trimmed name must return Hello friend.",
    check:
      'assert.equal(m.greet(" Ada "),"Hello Ada");assert.equal(m.greet("   "),"Hello friend");',
  },
];
const fixtures = fixturePath ? JSON.parse(await fs.readFile(fixturePath, "utf8")) : builtinFixtures;
await fs.mkdir(output, { recursive: true });
const metadata = JSON.parse(
  await fs.readFile(path.join(consumer, "node_modules/@corbat-tech/coco/package.json"), "utf8"),
);
const artifacts = {};
for (const entry of ["@corbat-tech/coco", "@corbat-tech/coco/runtime", "@corbat-tech/coco/tools"])
  artifacts[entry] = createHash("sha256")
    .update(await fs.readFile(requireInstalled.resolve(entry)))
    .digest("hex");
await fs.writeFile(
  path.join(output, "run.json"),
  JSON.stringify(
    {
      version: metadata.version,
      model,
      digest: installedModel.digest,
      artifacts,
      corpus: fixturePath ?? "builtin-v2",
      evaluatorRevision: 4,
    },
    null,
    2,
  ),
);
const results = [];
for (const fixture of fixtures.filter((f) => !filter || filter === "all" || f.id === filter)) {
  const dir = path.join(output, fixture.id);
  await fs.mkdir(dir, { recursive: false });
  await fs.writeFile(path.join(dir, "main.mjs"), fixture.source);
  await fs.writeFile(path.join(dir, "USER_NOTE.txt"), "Do not modify this user-owned file.\n");
  const registry = new tools.ToolRegistry();
  for (const tool of [
    tools.readFileTool,
    tools.writeFileTool,
    tools.editFileTool,
    tools.listDirTool,
    tools.fileExistsTool,
    tools.bashExecTool,
  ])
    registry.register(tool);
  const previous = process.cwd();
  process.chdir(dir);
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Evaluation deadline exceeded")),
    600000,
  );
  let runtime;
  let result;
  let error;
  let calls = 0;
  let terminalResponse = false;
  let lastStopReason;
  const turnStopReasons = [];
  let truncated = false;
  const turnCompletions = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const provider = await createProvider("ollama", {
      apiKey: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model,
      timeout: 120000,
    });
    runtime = await createAgentRuntime({
      providerType: "ollama",
      model,
      provider,
      toolRegistry: registry,
      turnRunner: createToolCallingRuntimeTurnRunner({ maxToolIterations: 30 }),
    });
    const original = provider.chatWithTools.bind(provider);
    provider.chatWithTools = async (...args) => {
      if (++calls > 30) throw new Error("Evaluation call limit exceeded");
      const response = await original(...args);
      lastStopReason = response.stopReason;
      terminalResponse =
        ["end_turn", "stop_sequence"].includes(response.stopReason) &&
        response.toolCalls.length === 0;
      truncated = response.stopReason === "max_tokens";
      usage.inputTokens += response.usage?.inputTokens ?? 0;
      usage.outputTokens += response.usage?.outputTokens ?? 0;
      return response;
    };
    const options = {
      signal: controller.signal,
      timeout: 120000,
      maxTokens: 4096,
      temperature: 0,
      system: `You are a coding agent operating in ${dir}. Use the available tools to complete the task. Only edit files inside this project. Preserve USER_NOTE.txt. Never use network, installs, git, or background processes. Test edits with Node, and report failures honestly.`,
      thinking: "off",
    };
    const input = {
      content: fixture.prompt,
      mode: "build",
      confirmedTools: ["write_file", "edit_file", "bash_exec"],
      options,
    };
    result = await runtime.runTurn(input);
    turnCompletions.push(terminalResponse && !truncated);
    turnStopReasons.push(lastStopReason);
    if (fixture.followup) {
      lastStopReason = undefined;
      terminalResponse = false;
      truncated = false;
      result = await runtime.runTurn({
        ...input,
        sessionId: result.sessionId,
        content: fixture.followup,
      });
      turnCompletions.push(terminalResponse && !truncated);
      turnStopReasons.push(lastStopReason);
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } finally {
    clearTimeout(timer);
    await runtime?.close?.();
    process.chdir(previous);
  }
  const source = await fs.readFile(path.join(dir, "main.mjs"), "utf8");
  const judge = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import assert from 'node:assert/strict';import * as m from ${JSON.stringify(pathToFileURL(path.join(dir, "main.mjs")).href)};${fixture.check}`,
    ],
    { cwd: dir, encoding: "utf8", timeout: 10000 },
  );
  const preserved =
    (await fs.readFile(path.join(dir, "USER_NOTE.txt"), "utf8")) ===
    "Do not modify this user-owned file.\n";
  const events = runtime?.eventLog.list() ?? [];
  const record = {
    id: fixture.id,
    version: metadata.version,
    model,
    digest: installedModel.digest,
    calls,
    seconds: (performance.now() - start) / 1000,
    passed:
      !error &&
      turnCompletions.length > 0 &&
      turnCompletions.every(Boolean) &&
      judge.status === 0 &&
      preserved,
    agentCompleted: !error && turnCompletions.length > 0 && turnCompletions.every(Boolean),
    codeVerified: judge.status === 0 && preserved,
    turnCompletions,
    turnStopReasons,
    lastStopReason,
    completionFailure: error
      ? "runtime_error"
      : truncated
        ? "output_truncated"
        : !terminalResponse
          ? "nonterminal_response"
          : turnCompletions.some((complete) => !complete)
            ? "incomplete_prior_turn"
            : undefined,
    error,
    verification: {
      status: judge.status,
      stderr: judge.stderr?.slice(0, 4000),
      preservedUserFile: preserved,
    },
    usage,
    scope: "runtime-tools-six; session case has two turns, not long-context stress",
    corpusRevision: fixturePath ? "heldout-1" : 2,
    evaluatorRevision: 4,
    answer: result?.content,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    before: fixture.source,
    after: source,
    events,
  };
  await fs.writeFile(path.join(dir, "result.json"), JSON.stringify(record, null, 2));
  results.push(record);
  await fs.writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(
      results.map(({ events, ...r }) => r),
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ id: record.id, passed: record.passed, calls, seconds: record.seconds, error }),
  );
}
