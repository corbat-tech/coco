import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMProvider, StreamChunk } from "../../providers/types.js";
import { ToolRegistry } from "../../tools/registry.js";
import { executeAgentTurn } from "./agent-loop.js";
import type { ReplSession } from "./types.js";

function fixture(paths: string[], maxToolIterations = 10) {
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file",
    category: "file",
    description: "Read a fixture",
    parameters: z.object({ path: z.string() }),
    async execute({ path }) {
      if (path.startsWith("missing")) throw new Error(`Not found: ${path}`);
      return `Read ${path}`;
    },
  });
  let call = 0;
  const streamWithTools = vi.fn(async function* (): AsyncIterable<StreamChunk> {
    const path = paths[call++];
    if (path) {
      yield {
        type: "tool_use_end",
        toolCall: { id: `call-${call}`, name: "read_file", input: { path } },
      };
      yield { type: "done", stopReason: "tool_use" };
    } else {
      yield { type: "text", text: "Recovered and verified." };
      yield { type: "done", stopReason: "end_turn" };
    }
  });
  const provider = {
    name: "fixture",
    countTokens: (text: string) => Math.ceil(text.length / 4),
    streamWithTools,
  } as unknown as LLMProvider;
  const session = {
    id: "progress-fixture",
    projectPath: "/unused",
    startedAt: new Date(),
    messages: [],
    trustedTools: new Set<string>(),
    config: {
      provider: { type: "openai", model: "fixture", maxTokens: 1000 },
      ui: { maxHistorySize: 100 },
      agent: { systemPrompt: "Inspect files", maxToolIterations, confirmDestructive: false },
    },
  } as ReplSession;
  return { registry, provider, session, streamWithTools };
}

describe("tool progress across long turns", () => {
  it("does not count a recovered historical error as another failure on later iterations", async () => {
    const { session, registry, provider, streamWithTools } = fixture([
      "missing-old-name",
      "actual-name",
      "module-b",
      "module-c",
      "module-d",
      "module-e",
    ]);
    const result = await executeAgentTurn(session, "Inspect the project", provider, registry);
    expect(result.toolCalls).toHaveLength(6);
    expect(result.toolCalls.filter((call) => !call.result.success)).toHaveLength(1);
    expect(streamWithTools).toHaveBeenCalledTimes(7);
    expect(result.content).toContain("Recovered and verified.");
  });

  it("still stops three genuine consecutive identical tool failures", async () => {
    const { session, registry, provider } = fixture([
      "missing-a",
      "missing-a",
      "missing-a",
    ]);
    const result = await executeAgentTurn(session, "Inspect the project", provider, registry);
    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls.every((call) => !call.result.success)).toBe(true);
    expect(result.content).toContain("Recovered and verified.");
  });

  it("does not extend the budget for a failed current iteration because of an old success", async () => {
    const { session, registry, provider, streamWithTools } = fixture(["actual", "missing-a"], 2);
    await executeAgentTurn(session, "Inspect the project", provider, registry);
    const finalOptions = vi.mocked(provider.streamWithTools).mock.calls[2]?.[1];
    expect(streamWithTools).toHaveBeenCalledTimes(3);
    expect(finalOptions?.tools).toEqual([]);
  });
});
