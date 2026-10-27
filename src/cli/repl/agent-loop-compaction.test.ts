import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMProvider, Message, StreamChunk } from "../../providers/types.js";
import { ToolRegistry } from "../../tools/registry.js";
import { executeAgentTurn } from "./agent-loop.js";
import { createContextManager } from "./context/manager.js";
import { getConversationContext } from "./session.js";
import type { ReplSession } from "./types.js";

function fixture(large = true) {
  const session = {
    id: "compaction-test",
    projectPath: "/unused",
    messages: Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: large && i === 1 ? "old work ".repeat(2000) : "Continue",
    })) as Message[],
    trustedTools: new Set<string>(),
    config: {
      ui: { maxHistorySize: 100 },
      provider: { type: "anthropic", model: "claude-sonnet-4-6", maxTokens: 1000 },
      agent: { systemPrompt: "Help", maxToolIterations: 5, confirmDestructive: true },
    },
    contextManager: createContextManager(10000, { reservedTokens: 0, compactionThreshold: 0.6 }),
  } as ReplSession;
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file",
    description: "Read fixture",
    category: "file",
    parameters: z.object({}),
    execute: async () => ({ content: "result ".repeat(1800) }),
  });
  const provider = {
    name: "fixture",
    countTokens: (text: string) => Math.ceil(text.length / 4),
    chat: vi.fn(async () => ({
      content: "Old work completed; verification pending",
      stopReason: "end_turn",
    })),
    streamWithTools: vi.fn(),
  } as unknown as LLMProvider;
  return { session, registry, provider };
}

function textStream(): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: "text", text: "Finished inspecting." } as StreamChunk;
    yield { type: "done", stopReason: "end_turn" } as StreamChunk;
  })();
}

function toolStream(): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield {
      type: "tool_use_end",
      toolCall: { id: "read-1", name: "read_file", input: {} },
    } as StreamChunk;
    yield { type: "done", stopReason: "tool_use" } as StreamChunk;
  })();
}

function expectedTokens(session: ReplSession, provider: LLMProvider, registry: ToolRegistry) {
  return getConversationContext(session, registry).reduce(
    (sum, message) =>
      sum +
      provider.countTokens(
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      ),
    0,
  );
}

describe("in-turn context compaction", () => {
  it("compacts after tool output crosses the threshold and preserves the complete tool pair", async () => {
    const { session, registry, provider } = fixture();
    const requests: Message[][] = [];
    vi.mocked(provider.streamWithTools).mockImplementation((messages) => {
      requests.push(structuredClone(messages));
      return requests.length === 1 ? toolStream() : textStream();
    });
    const result = await executeAgentTurn(session, "Inspect the project", provider, registry);
    expect(result.aborted).toBe(false);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(
      requests[0]?.some(
        (m) =>
          typeof m.content === "string" && m.content.includes("[Previous conversation summary]"),
      ),
    ).toBe(false);
    expect(requests[1]?.[1]?.content).toContain("[Previous conversation summary]");
    const blocks = requests[1]?.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_use", id: "read-1" }),
        expect.objectContaining({ type: "tool_result", tool_use_id: "read-1" }),
      ]),
    );
  });

  it("does not summarize below the threshold", async () => {
    const { session, registry, provider } = fixture(false);
    vi.mocked(provider.streamWithTools).mockImplementation(textStream);
    await executeAgentTurn(session, "Inspect the project", provider, registry);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it.each(["during", "after"] as const)(
    "restores the exact pre-turn history on cancellation %s compaction",
    async (when) => {
      const { session, registry, provider } = fixture();
      session.messages[0] = { role: "user", content: "Steering: preserve the public API" };
      session.messages[6] = {
        role: "assistant",
        content: [{ type: "tool_use", id: "previous-read", name: "read_file", input: {} }],
      };
      session.messages[7] = {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "previous-read", content: "Earlier evidence" },
        ],
      };
      const original = structuredClone(session.messages);
      const controller = new AbortController();
      let streams = 0;
      vi.mocked(provider.chat).mockImplementation(async () => {
        if (when === "during") controller.abort();
        return { content: "Summary", stopReason: "end_turn" } as Awaited<
          ReturnType<LLMProvider["chat"]>
        >;
      });
      vi.mocked(provider.streamWithTools).mockImplementation(() => {
        streams++;
        if (streams === 1) return toolStream();
        controller.abort();
        return textStream();
      });
      const result = await executeAgentTurn(session, "Inspect the project", provider, registry, {
        signal: controller.signal,
      });
      expect(provider.chat).toHaveBeenCalledTimes(1);
      expect(result.aborted).toBe(true);
      expect(session.messages).toEqual(original);
      expect(session.messages.every(Boolean)).toBe(true);
      expect(session.contextManager?.getUsedTokens()).toBe(
        expectedTokens(session, provider, registry),
      );
    },
  );

  it("retains history when summarization fails and continues the turn", async () => {
    const { session, registry, provider } = fixture();
    vi.mocked(provider.chat).mockRejectedValue(new Error("summary unavailable"));
    vi.mocked(provider.streamWithTools)
      .mockImplementationOnce(toolStream)
      .mockImplementationOnce(toolStream)
      .mockImplementation(textStream);
    const result = await executeAgentTurn(session, "Inspect the project", provider, registry);
    expect(result.aborted).toBe(false);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(session.messages[1]?.content).toContain("old work");
    expect(
      session.messages.some(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"),
      ),
    ).toBe(true);
  });

  it("does not repeatedly summarize a history that cannot be reduced", async () => {
    const { session, registry, provider } = fixture(false);
    session.contextManager = createContextManager(10000, {
      reservedTokens: 0,
      compactionThreshold: 0,
    });
    vi.mocked(provider.streamWithTools)
      .mockImplementationOnce(toolStream)
      .mockImplementation(textStream);
    await executeAgentTurn(session, "Inspect the project", provider, registry);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(session.messages[0]?.content).toBe("Continue");
    expect(
      session.messages.some(
        (m) =>
          typeof m.content === "string" && m.content.includes("[Previous conversation summary]"),
      ),
    ).toBe(false);
  });
});
