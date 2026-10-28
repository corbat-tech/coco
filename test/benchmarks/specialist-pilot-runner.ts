import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LLMProvider } from "../../src/providers/types.js";
import type { ThinkingMode } from "../../src/providers/thinking.js";
import { createCocoEvaluationAdapter } from "./specialist-coco-adapter.js";
import { createPilotCases, readPilotManifest, checkPilotCase } from "./specialist-pilot-cases.js";
import { runSpecialistEvaluation, type EvaluationConfiguration } from "./specialist-evaluation.js";

export interface CocoPilotCampaignOptions {
  provider: LLMProvider;
  model: string;
  thinking?: ThinkingMode;
  commit: string;
  outputDirectory: string;
  maxRuns: number;
  repetitions: number;
  timeoutMs: number;
  maxTurns: number;
  maxTokens: number;
  split: "development" | "reserved" | "all";
  /** Host assertion of explicit approval; never derive this from model-authored arguments. */
  approvedConsumption: boolean;
  fixtureRoot?: string;
  /** Explicit smoke subsets; defaults preserve the complete selected split and all three modes. */
  caseIds?: readonly string[];
  configurations?: readonly EvaluationConfiguration[];
  signal?: AbortSignal;
}

/** Exact public test invocation, not a model-authored shell command. This is not an OS sandbox. */
async function executePublicTests(workspace: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const env: NodeJS.ProcessEnv = { LANG: "C", TZ: "UTC" };
  if (process.platform === "win32" && process.env.SystemRoot)
    env.SystemRoot = process.env.SystemRoot;
  return new Promise<{ success: boolean; output: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--experimental-test-isolation=none",
        "--test-reporter=tap",
        path.join(workspace, "public.test.mjs"),
      ],
      {
        cwd: workspace,
        env,
        signal: boundedSignal,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let failed = false;
    const collect = (chunk: Buffer) => {
      if (output.length + chunk.length > 32_000) {
        failed = true;
        child.kill();
      }
      output = (output + chunk.toString("utf8")).slice(0, 32_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      const tests = Number(/^# tests (\d+)\s*$/m.exec(output)?.[1] ?? 0);
      const passes = Number(/^# pass (\d+)\s*$/m.exec(output)?.[1] ?? 0);
      resolve({
        success:
          code === 0 &&
          !failed &&
          !boundedSignal.aborted &&
          tests > 0 &&
          passes === tests &&
          /^# fail 0\s*$/m.test(output),
        output,
      });
    });
  });
}

/** Execute a reviewable pilot only after explicit host approval. Never loads credentials or initializes a provider. */
export async function runCocoPilotCampaign(options: CocoPilotCampaignOptions) {
  if (options.approvedConsumption !== true)
    throw new Error("Explicit consumption approval is required before running a Coco pilot.");
  if (!["development", "reserved", "all"].includes(options.split))
    throw new Error("Unknown pilot split.");
  const metadata = await readPilotManifest(options.fixtureRoot);
  const selected = metadata.filter(
    (item) =>
      options.split === "all" ||
      item.split ===
        (options.split === "reserved" ? "reserved-after-implementation" : "development"),
  );
  if (options.caseIds?.some((id) => !selected.some((item) => item.id === id)))
    throw new Error("Requested case is outside the selected frozen split.");
  const cases = (await createPilotCases(options.fixtureRoot)).filter(
    (item) =>
      selected.some((entry) => entry.id === item.id) &&
      (!options.caseIds || options.caseIds.includes(item.id)),
  );
  if (!cases.length) throw new Error("The pilot selection is empty.");
  const sources = await Promise.all(
    [
      new URL("./specialist-coco-adapter.ts", import.meta.url),
      new URL("../../src/runtime/permission-policy.ts", import.meta.url),
      new URL("../../src/runtime/agent-profiles.ts", import.meta.url),
    ].map((file) => readFile(file, "utf8")),
  );
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const identity = {
    commit: options.commit,
    model: options.model,
    effort:
      typeof options.thinking === "string"
        ? options.thinking
        : JSON.stringify(options.thinking ?? "provider-default"),
    adapterVersion: `coco-cli-v1:${hash(sources[0]!)}`,
    toolPolicySha256: hash(
      JSON.stringify({
        adapter: sources[0],
        policy: sources[1],
        limits: [options.maxTurns, options.maxTokens],
        solutionFiles: selected
          .filter((item) => cases.some((entry) => entry.id === item.id))
          .map((item) => [item.id, item.solutionFiles]),
      }),
    ),
    promptSha256: hash(
      JSON.stringify({
        adapter: sources[0],
        profiles: sources[2],
        tasks: cases.map((item) => item.task),
      }),
    ),
    requestLimits: { maxTurns: options.maxTurns, requestedMaxOutputTokens: options.maxTokens },
    split: options.split,
  };
  return runSpecialistEvaluation({
    cases,
    configurations: options.configurations,
    repetitions: options.repetitions,
    maxRuns: options.maxRuns,
    timeoutMs: options.timeoutMs,
    outputDirectory: options.outputDirectory,
    identity,
    signal: options.signal,
    runCase: async (context) =>
      createCocoEvaluationAdapter({
        provider: options.provider,
        model: options.model,
        thinking: options.thinking,
        maxTurns: options.maxTurns,
        maxTokens: options.maxTokens,
        writablePaths: selected.find((item) => item.id === context.caseId)!.solutionFiles,
        executePublicTests,
      })(context),
    check: (context) => checkPilotCase(context, options.fixtureRoot),
  });
}
