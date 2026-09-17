import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  LLMProvider,
  ToolCall,
  ChatWithToolsResponse,
  StreamChunk,
} from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createAgentRuntime } from "./agent-runtime.js";
import { createToolCallingRuntimeTurnRunner } from "./tool-calling-turn-runner.js";

const call: ToolCall = { id: "read-1", name: "read_file", input: { path: "example" } };
function response(
  stopReason: ChatWithToolsResponse["stopReason"],
  toolCalls: ToolCall[] = [],
): ChatWithToolsResponse {
  return {
    id: "response",
    content: "Work is complete. Let me run one more check...",
    stopReason,
    toolCalls,
    usage: { inputTokens: 1, outputTokens: 2 },
    model: "fixture",
  };
}
async function fixture(chat: ReturnType<typeof vi.fn>, maxToolIterations = 2) {
  const execute = vi.fn(async () => ({ content: "read successfully" }));
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file",
    category: "file",
    description: "fixture",
    parameters: z.object({ path: z.string() }),
    execute,
  });
  const provider = { id: "ollama", chatWithTools: chat } as unknown as LLMProvider;
  const runtime = await createAgentRuntime({
    providerType: "ollama",
    model: "fixture",
    provider,
    toolRegistry: registry,
    turnRunner: createToolCallingRuntimeTurnRunner({ maxToolIterations }),
  });
  return { runtime, execute };
}
describe("runtime tool turn completion contract", () => {
  it.each([
    ["max_tokens", []],
    ["tool_use", []],
    ["end_turn", [call]],
    ["stop_sequence", [call]],
  ] as const)(
    "rejects nonterminal or inconsistent %s without dispatching pending effects",
    async (reason, calls) => {
      const chat = vi.fn().mockResolvedValue(response(reason, [...calls]));
      const { runtime, execute } = await fixture(chat);
      try {
        await expect(runtime.runTurn({ content: "Work", mode: "build" })).rejects.toThrow(
          /Runtime turn incomplete/,
        );
        expect(chat).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
        expect(runtime.eventLog.list().map((e) => e.type)).toContain("turn.failed");
        expect(runtime.eventLog.list().map((e) => e.type)).not.toContain("turn.completed");
        expect(runtime.listSessions()[0]?.messages).toEqual([]);
      } finally {
        await runtime.close();
      }
    },
  );
  it("reports budget exhaustion as failure without undoing completed effects or fabricating final text", async () => {
    const chat = vi.fn().mockResolvedValue(response("tool_use", [call]));
    const { runtime, execute } = await fixture(chat, 2);
    try {
      await expect(runtime.runTurn({ content: "Work", mode: "build" })).rejects.toThrow(
        /maximum tool iteration budget/,
      );
      expect(chat).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(runtime.eventLog.list().filter((e) => e.type === "tool.completed")).toHaveLength(2);
      expect(runtime.eventLog.list().map((e) => e.type)).not.toContain("turn.completed");
    } finally {
      await runtime.close();
    }
  });
  it.each(["end_turn", "stop_sequence"] as const)(
    "accepts %s after tools when no calls remain",
    async (reason) => {
      const chat = vi
        .fn()
        .mockResolvedValueOnce(response("tool_use", [call]))
        .mockResolvedValueOnce(response(reason));
      const { runtime, execute } = await fixture(chat);
      try {
        const result = await runtime.runTurn({ content: "Work", mode: "build" });
        expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 4 });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(runtime.eventLog.list().map((e) => e.type)).toContain("turn.completed");
      } finally {
        await runtime.close();
      }
    },
  );
  it("does not execute calls from a late provider response after cancellation", async () => {
    const controller = new AbortController();
    const chat = vi.fn(async () => {
      controller.abort(new Error("cancelled"));
      return response("tool_use", [call]);
    });
    const { runtime, execute } = await fixture(chat);
    try {
      await expect(
        runtime.runTurn({ content: "Work", options: { signal: controller.signal } }),
      ).rejects.toThrow("cancelled");
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });
  it("forwards cancellation to tools and stops the remainder of a batch", async () => {
    const controller = new AbortController();
    const chat = vi.fn().mockResolvedValue(response("tool_use", [call, { ...call, id: "read-2" }]));
    const { runtime, execute } = await fixture(chat);
    execute.mockImplementationOnce(async () => {
      controller.abort(new Error("cancel during first tool"));
      return { content: "first tool completed" };
    });
    try {
      await expect(
        runtime.runTurn({ content: "Work", options: { signal: controller.signal } }),
      ).rejects.toThrow("cancel during first tool");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        { path: "example" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(chat).toHaveBeenCalledTimes(1);
      expect(runtime.eventLog.list().map((e) => e.type)).not.toContain("turn.completed");
    } finally {
      await runtime.close();
    }
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid iteration budget %s",
    (budget) => {
      expect(() => createToolCallingRuntimeTurnRunner({ maxToolIterations: budget })).toThrow(
        /positive safe integer/,
      );
    },
  );
});

describe("default runtime completion contract", () => {
  it.each(["max_tokens", "tool_use"] as const)("rejects nonterminal chat %s", async (reason) => {
    const provider = {
      id: "ollama",
      chat: vi.fn().mockResolvedValue(response(reason)),
    } as unknown as LLMProvider;
    const runtime = await createAgentRuntime({
      providerType: "ollama",
      model: "fixture",
      provider,
      toolRegistry: new ToolRegistry(),
    });
    try {
      await expect(runtime.runTurn({ content: "work" })).rejects.toThrow("Runtime turn incomplete");
      expect(runtime.eventLog.list().map((e) => e.type)).not.toContain("turn.completed");
      expect(runtime.listSessions()[0]?.messages).toEqual([]);
    } finally {
      await runtime.close();
    }
  });
  it.each([
    ["truncated", [{ type: "done", stopReason: "max_tokens" }], false],
    [
      "tool call",
      [
        { type: "tool_use_start", toolCall: call },
        { type: "done", stopReason: "end_turn" },
      ],
      false,
    ],
    [
      "duplicate terminal",
      [
        { type: "done", stopReason: "end_turn" },
        { type: "done", stopReason: "end_turn" },
      ],
      false,
    ],
    ["missing terminal", [], false],
    ["missing reason", [{ type: "done" }], false],
    ["valid end", [{ type: "done", stopReason: "end_turn" }], true],
    ["valid stop", [{ type: "done", stopReason: "stop_sequence" }], true],
    [
      "trailing text",
      [
        { type: "done", stopReason: "end_turn" },
        { type: "text", text: "late" },
      ],
      false,
    ],
  ] as Array<[string, StreamChunk[], boolean]>)(
    "handles streaming %s without false completion",
    async (_name, chunks, success) => {
      const provider = {
        id: "ollama",
        countTokens: (s: string) => s.length,
        stream: async function* () {
          yield { type: "text", text: "partial" };
          yield* chunks;
        },
      } as unknown as LLMProvider;
      const runtime = await createAgentRuntime({
        providerType: "ollama",
        model: "fixture",
        provider,
        toolRegistry: new ToolRegistry(),
      });
      try {
        const events = [];
        for await (const event of runtime.streamTurn({ content: "work" })) events.push(event);
        expect(events[0]).toMatchObject({ type: "text", text: "partial" });
        expect(events.at(-1)?.type).toBe(success ? "done" : "error");
        expect(runtime.eventLog.list().some((e) => e.type === "turn.completed")).toBe(success);
        expect(runtime.eventLog.list().some((e) => e.type === "turn.failed")).toBe(!success);
        expect(runtime.listSessions()[0]?.messages).toHaveLength(success ? 2 : 0);
      } finally {
        await runtime.close();
      }
    },
  );
});
