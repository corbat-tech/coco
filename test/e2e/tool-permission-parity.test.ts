/**
 * Hermetic execution-boundary parity, not model capability or delegated authority.
 * Real runtime/registry policies execute only in-memory fixture tool functions.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRuntimeToolDispatch } from "../../src/cli/repl/runtime-tool-dispatch.js";
import type { ToolCall } from "../../src/providers/types.js";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import { RuntimeToolExecutor } from "../../src/runtime/runtime-tool-executor.js";
import type { RuntimeMode } from "../../src/runtime/types.js";
import { ToolRegistry, type ToolCategory } from "../../src/tools/registry.js";

const TOOLS: Array<{ name: string; category: ToolCategory }> = [
  { name: "read_file", category: "file" },
  { name: "write_file", category: "file" },
  { name: "copy_file", category: "file" },
  { name: "move_file", category: "file" },
  { name: "git_pull", category: "git" },
  { name: "install_deps", category: "build" },
  { name: "make", category: "build" },
  { name: "run_script", category: "build" },
  { name: "http_fetch", category: "bash" },
  { name: "http_json", category: "bash" },
  { name: "get_env", category: "config" },
  { name: "manage_permissions", category: "config" },
  { name: "bash_background", category: "bash" },
  { name: "bash_exec", category: "bash" },
];
const MODES: RuntimeMode[] = ["ask", "plan", "build", "debug", "review", "architect"];
const CASES = TOOLS.flatMap((tool) =>
  MODES.flatMap((mode) => [false, true].map((confirmed) => ({ ...tool, mode, confirmed }))),
);

describe("tool permission parity across execution boundaries", () => {
  it.each(CASES)(
    "$name / $mode / confirmed=$confirmed",
    async ({ name, category, mode, confirmed }) => {
      const registry = new ToolRegistry();
      const effects: string[] = [];
      registry.register({
        name,
        category,
        description: "In-memory permission fixture; never performs the named external effect",
        parameters: z.object({ marker: z.string() }),
        async execute({ marker }) {
          effects.push(marker);
          return { marker };
        },
      });
      const runtime = new AgentRuntime({
        providerType: "openai",
        model: "fixture-model",
        toolRegistry: registry,
      });
      const session = runtime.createSession({ mode });
      const executor = new RuntimeToolExecutor({ toolRegistry: registry, mode });
      const call: ToolCall = { id: "parity-call", name, input: { marker: name } };
      const input = { sessionId: session.id, mode, toolName: name, input: call.input, confirmed };
      const dispatch = createRuntimeToolDispatch(
        runtime,
        session.id,
        mode,
        confirmed ? [call] : [],
      );
      const allowed = name === "read_file" || (confirmed && (mode === "build" || mode === "debug"));
      const boundaries = [
        { name: "runtime facade", execute: () => runtime.executeTool(input) },
        { name: "shared executor", execute: () => executor.execute(input) },
        { name: "REPL dispatch", execute: () => dispatch(structuredClone(call)) },
      ];

      for (const boundary of boundaries) {
        const effectsBefore = effects.length;
        const result = await boundary.execute();
        expect(result.success, boundary.name).toBe(allowed);
        expect(effects.length - effectsBefore, boundary.name).toBe(allowed ? 1 : 0);
        if (!allowed) expect(result.error, boundary.name).toBeTruthy();
      }
      expect(effects).toEqual(allowed ? [name, name, name] : []);
    },
  );
});
