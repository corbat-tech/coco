/**
 * Hermetic task corpus: real REPL loop, registry, file tools and disk verifiers.
 * Only the provider is scripted. These cases do NOT measure model capability.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { executeAgentTurn } from "../../src/cli/repl/agent-loop.js";
import type { ReplSession } from "../../src/cli/repl/types.js";
import type { LLMProvider, ToolCall } from "../../src/providers/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { editFileTool, readFileTool, writeFileTool } from "../../src/tools/file.js";

function scriptedProvider(calls: ToolCall[]): LLMProvider {
  let turn = 0;
  return {
    id: "task-fixture",
    name: "Scripted task fixture (not a model)",
    async initialize() {},
    async chat() {
      throw new Error("Unexpected non-streaming request");
    },
    async chatWithTools() {
      throw new Error("Unexpected non-streaming request");
    },
    stream() {
      throw new Error("Expected streamWithTools");
    },
    async *streamWithTools() {
      const call = calls[turn++];
      if (call) {
        yield { type: "tool_use_start", toolCall: { id: call.id, name: call.name } };
        yield { type: "tool_use_end", toolCall: call };
        yield { type: "done", stopReason: "tool_use" };
      } else {
        yield { type: "text", text: "Fixture finished; independently verify the files." };
        yield { type: "done", stopReason: "end_turn" };
      }
    },
    countTokens: (text) => Math.ceil(text.length / 4),
    getContextWindow: () => 200000,
    async isAvailable() {
      return true;
    },
  };
}

function session(projectPath: string): ReplSession {
  return {
    id: "task-fixture",
    startedAt: new Date(),
    messages: [],
    projectPath,
    config: {
      provider: { type: "openai", model: "fixture", maxTokens: 8192 },
      ui: { theme: "auto", showTimestamps: false, maxHistorySize: 200, showDiff: "on_request" },
      agent: {
        systemPrompt: "Run the fixture task.",
        maxToolIterations: 8,
        confirmDestructive: false,
      },
    },
    trustedTools: new Set(),
  };
}

function call(id: string, name: string, input: Record<string, unknown>): ToolCall {
  return { id, name, input };
}

describe("REPL task corpus with real file tools", () => {
  let project: string;
  let originalCwd: string;
  let registry: ToolRegistry;

  beforeEach(async () => {
    originalCwd = process.cwd();
    project = await realpath(await mkdtemp(path.join(tmpdir(), "coco-task-")));
    process.chdir(project);
    registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(editFileTool);
    registry.register(writeFileTool);
    await writeFile("user-notes.txt", "Keep my existing work.\n");
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(project, { recursive: true, force: true });
  });

  // The verifier runs outside the agent and fails for the original buggy file.
  function verify(program: string): string {
    return execFileSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: project,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  it("fixes a bug and preserves unrelated user work", async () => {
    await writeFile("math.mjs", "export const add = (a, b) => a - b;\n");
    const verifier =
      'import {add} from "./math.mjs"; if(add(2,3)!==5 || add(-2,3)!==1) process.exit(1)';
    expect(() => verify(verifier)).toThrow();
    const result = await executeAgentTurn(
      session(project),
      "Fix add without modifying user-notes.txt",
      scriptedProvider([
        call("read", "read_file", { path: "math.mjs" }),
        call("fix", "edit_file", { path: "math.mjs", oldText: "a - b", newText: "a + b" }),
      ]),
      registry,
      { skipConfirmation: true },
    );
    expect(result.aborted).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.every((tool) => tool.result.success)).toBe(true);
    expect(() => verify(verifier)).not.toThrow();
    expect(await readFile("user-notes.txt", "utf8")).toBe("Keep my existing work.\n");
  });

  it("adds a feature whose behavior is checked outside the model", async () => {
    const result = await executeAgentTurn(
      session(project),
      "Add a slug function: trim, lowercase and collapse spaces into hyphens",
      scriptedProvider([
        call("feature", "write_file", {
          path: "slug.mjs",
          content: 'export const slug = s => s.trim().toLowerCase().replace(/\\s+/g, "-");\n',
        }),
      ]),
      registry,
      { skipConfirmation: true },
    );
    expect(result.aborted).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.result.success).toBe(true);
    verify(
      'import {slug} from "./slug.mjs"; if(slug(" A  B ")!=="a-b" || slug("")!=="") process.exit(1)',
    );
    expect(await readFile("user-notes.txt", "utf8")).toBe("Keep my existing work.\n");
  });

  it("reports a failed edit without mutation and accepts a corrected call", async () => {
    await writeFile("math.mjs", "export const add = (a, b) => a - b;\n");
    const observed: boolean[] = [];
    const result = await executeAgentTurn(
      session(project),
      "Fix add; recover if an edit fails",
      scriptedProvider([
        call("bad", "edit_file", { path: "math.mjs", oldText: "missing text", newText: "bad" }),
        call("read", "read_file", { path: "math.mjs" }),
        call("retry", "edit_file", { path: "math.mjs", oldText: "a - b", newText: "a + b" }),
      ]),
      registry,
      { skipConfirmation: true, onToolEnd: (tool) => observed.push(tool.result.success) },
    );
    expect(result.aborted).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.toolCalls).toHaveLength(3);
    expect(observed).toEqual([false, true, true]);
    expect(result.toolCalls[0]?.result.error).toBeTruthy();
    expect(result.toolCalls[1]?.result.output).toContain("a - b");
    verify('import {add} from "./math.mjs"; if(add(2,3)!==5) process.exit(1)');
    expect(await readFile("math.mjs", "utf8")).not.toContain("bad");
    expect(await readFile("user-notes.txt", "utf8")).toBe("Keep my existing work.\n");
  });
});
