import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, Message } from "../../providers/types.js";
import type { ReplSession } from "./types.js";
import { initializeContextManager } from "./session.js";

function fixture() {
  const session = {
    messages: [
      { role: "user", content: "Preserve the public API" },
      { role: "assistant", content: "work ".repeat(10000) },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "Continue",
      })),
    ] as Message[],
    config: {
      provider: { type: "anthropic", model: "claude-sonnet-4-6", maxTokens: 8192 },
      agent: { systemPrompt: "Help", maxToolIterations: 10, confirmDestructive: true },
    },
  } as ReplSession;
  const provider = {
    getContextWindow: () => 200000,
    countTokens: (text: string) => Math.ceil(text.length / 4),
    chat: vi.fn(async () => ({ content: "Work completed; tests pending" })),
  } as unknown as LLMProvider;
  initializeContextManager(session, provider);
  return { session, provider };
}

describe("session compaction binding", () => {
  it("manual compaction bypasses threshold, installs history, and follows provider rebinding", async () => {
    const { session, provider } = fixture();
    expect(session.contextManager?.shouldCompact()).toBe(false);
    const replacement = {
      ...provider,
      chat: vi.fn(async () => ({ content: "New provider summary" })),
    } as unknown as LLMProvider;
    initializeContextManager(session, replacement);
    const result = await session.compactContext?.({ focusTopic: "API compatibility" });
    expect(result?.wasCompacted).toBe(true);
    expect(session.messages).toEqual(result?.messages);
    expect(provider.chat).not.toHaveBeenCalled();
    expect(vi.mocked(replacement.chat).mock.calls[0]?.[0]?.[0]?.content).toContain(
      "API compatibility",
    );
    expect(session.messages[0]?.content).toContain("Preserve the public API");
  });
  it("never replaces steering added while the summary is pending", async () => {
    const { session, provider } = fixture();
    vi.mocked(provider.chat).mockImplementationOnce(async () => {
      session.messages.push({ role: "user", content: "Stop before deployment" });
      return { content: "Summary" } as Awaited<ReturnType<LLMProvider["chat"]>>;
    });
    const result = await session.compactContext?.();
    expect(result?.wasCompacted).toBe(false);
    expect(result?.failureReason).toContain("changed");
    expect(session.messages.at(-1)?.content).toBe("Stop before deployment");
    expect(session.messages[1]?.content).toContain("work work");
  });
});
