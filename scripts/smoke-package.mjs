#!/usr/bin/env node
/** Run against a clean consumer directory containing the installed tarball. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, rm, realpath, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const consumer = await realpath(path.resolve(process.argv[2] ?? process.cwd()));
const requireInstalled = createRequire(path.join(consumer, "package.json"));
const packageRoot = await realpath(path.join(consumer, "node_modules/@corbat-tech/coco"));
const load = async (name) => {
  const resolved = await realpath(requireInstalled.resolve(name));
  assert.ok(
    resolved.startsWith(packageRoot + path.sep),
    "Export resolved outside installed package",
  );
  return import(pathToFileURL(resolved).href);
};
const cli = requireInstalled.resolve("@corbat-tech/coco/cli");
const metadata = JSON.parse(
  await readFile(path.resolve(path.dirname(cli), "../../package.json"), "utf8"),
);
assert.equal(metadata.name, "@corbat-tech/coco");
assert.ok(cli.startsWith(packageRoot + path.sep), "CLI resolved outside installed package");
assert.ok(process.argv[3], "Usage: smoke-package.mjs <consumer> <expected-version>");
assert.equal(metadata.version, process.argv[3], "Unexpected installed version");
for (const arg of ["--version", "--help"]) {
  const result = spawnSync(process.execPath, [cli, arg], {
    cwd: consumer,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  if (arg === "--version") assert.equal(result.stdout.trim(), metadata.version);
  else assert.ok(result.stdout.includes("Usage:"));
}
for (const name of [
  "@corbat-tech/coco",
  "@corbat-tech/coco/presets",
  "@corbat-tech/coco/adapters",
]) {
  await load(name);
}
const {
  createAgentRuntime,
  createToolCallingRuntimeTurnRunner,
  createFileRuntimeSessionStore,
} = await load("@corbat-tech/coco/runtime");
const { ToolRegistry, readFileTool } = await load("@corbat-tech/coco/tools");
const filename = path.join(consumer, "smoke-input.txt");
const expected = "installed-package-tool-result";
await writeFile(filename, expected, { flag: "wx" });
const previousCwd = process.cwd();
const sessionDirectory = await mkdtemp(path.join(consumer, "smoke-session-"));
const sessionPath = path.join(sessionDirectory, "sessions.json");
try {
  process.chdir(consumer);
  let calls = 0;
  const provider = {
    id: "smoke-fixture",
    name: "Smoke fixture",
    async initialize() {},
    async chatWithTools(messages) {
      calls++;
      if (calls >= 2)
        assert.ok(JSON.stringify(messages).includes(expected), "Missing real tool output");
      if (calls === 3) {
        assert.ok(JSON.stringify(messages).includes("Read smoke-input.txt"));
        assert.equal(messages.at(-1).content, "Continue the saved conversation");
      }
      assert.ok(calls <= 3, "Unexpected additional provider call");
      return {
        id: `smoke-${calls}`,
        model: "fixture",
        usage: { inputTokens: 1, outputTokens: 1 },
        content: calls === 1 ? "" : "verified",
        stopReason: calls === 1 ? "tool_use" : "end_turn",
        toolCalls:
          calls === 1 ? [{ id: "read", name: "read_file", input: { path: filename } }] : [],
      };
    },
    countTokens: (text) => text.length,
    getContextWindow: () => 10000,
  };
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  const runtime = await createAgentRuntime({
    providerType: "openai",
    model: "fixture",
    provider,
    toolRegistry: registry,
    runtimeSessionStore: createFileRuntimeSessionStore(sessionPath),
    turnRunner: createToolCallingRuntimeTurnRunner(),
  });
  const session = runtime.createSession({ mode: "ask" });
  const result = await runtime.runTurn({ sessionId: session.id, content: "Read smoke-input.txt" });
  assert.equal(result.content, "verified");
  assert.equal(calls, 2);
  assert.equal(await readFile(filename, "utf8"), expected);
  assert.ok(
    runtime.eventLog.list().some((event) => event.type === "tool.completed" && event.data.success),
  );
  // Reopen through a new store and runtime: no in-memory history may supply the result.
  const reopenedStore = createFileRuntimeSessionStore(sessionPath);
  assert.equal(reopenedStore.get(session.id).messages.length, 4);
  const reopenedRuntime = await createAgentRuntime({
    providerType: "openai",
    model: "fixture",
    provider,
    toolRegistry: registry,
    runtimeSessionStore: reopenedStore,
    turnRunner: createToolCallingRuntimeTurnRunner(),
  });
  const continued = await reopenedRuntime.runTurn({
    sessionId: session.id,
    content: "Continue the saved conversation",
  });
  assert.equal(continued.content, "verified");
  assert.equal(calls, 3, "Continuation must not replay the file tool");
  assert.equal(createFileRuntimeSessionStore(sessionPath).get(session.id).messages.length, 6);
  console.log(
    `Installed package ${metadata.version}: CLI, exports, real file tool and durable continuation PASS (scripted provider).`,
  );
} finally {
  process.chdir(previousCwd);
  await rm(filename, { force: true });
  await rm(sessionDirectory, { recursive: true, force: true });
}
