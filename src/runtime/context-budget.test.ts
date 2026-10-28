import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, Message } from "../providers/types.js";
import { compactContextToFit, measureContextBudget } from "./context-budget.js";
import { createContextCompactor } from "./context-compactor.js";

const countTokens = (text: string) => Math.ceil(text.length / 4);
const messages: Message[] = [
  { role: "user", content: "Inspect" },
  { role: "assistant", content: "evidence ".repeat(1000) },
];
const base = {
  messages,
  system: "System instruction",
  countTokens,
  contextWindow: 3000,
  reservedOutputTokens: 500,
};

describe("portable context request budget", () => {
  it("counts offered schemas, composed system and output reserve separately", () => {
    const tools = [{ name: "read", input_schema: { description: "large schema ".repeat(100) } }];
    const result = measureContextBudget({
      ...base,
      messages: [{ role: "system", content: "Extra" }, ...messages],
      tools,
    });
    expect(result.systemTokens).toBe(countTokens(base.system) + countTokens("Extra"));
    expect(result.toolTokens).toBe(countTokens(JSON.stringify(tools)));
    expect(result.totalTokens).toBe(result.inputTokens + 500);
    expect(result.fixedTokens).toBe(result.systemTokens + result.toolTokens + 500);
    expect(result.fits).toBe(false);
    expect(measureContextBudget({ ...base, tools: [] }).toolTokens).toBe(0);
  });
  it("fails before summarization when fixed input plus reserve cannot fit", async () => {
    const summarize = vi.fn();
    await expect(
      compactContextToFit({ ...base, tools: [{ schema: "x".repeat(12000) }], summarize }),
    ).rejects.toMatchObject({ code: "fixed_context_exceeds_window" });
    expect(summarize).not.toHaveBeenCalled();
  });
  it("accepts only reduced history that fits including fixed overhead", async () => {
    const shortened: Message[] = [{ role: "user", content: "Summary" }];
    const result = await compactContextToFit({
      ...base,
      summarize: async () => ({ messages: shortened, wasCompacted: true }),
    });
    expect(result.messages).toEqual(shortened);
    expect(result.budget.fits).toBe(true);
    expect(messages[1]?.content).toContain("evidence evidence");
    await expect(
      compactContextToFit({
        ...base,
        contextWindow: 1000,
        summarize: async () => ({
          messages: [{ role: "user", content: "x".repeat(4000) }],
          wasCompacted: true,
        }),
      }),
    ).rejects.toMatchObject({ code: "compacted_context_exceeds_window" });
    await expect(
      compactContextToFit({
        ...base,
        summarize: async (history) => ({ messages: history, wasCompacted: true }),
      }),
    ).rejects.toMatchObject({ code: "compaction_not_reduced" });
  });
  it("preserves original history after failure or cancellation", async () => {
    const before = structuredClone(messages);
    await expect(
      compactContextToFit({
        ...base,
        summarize: async () => {
          throw new Error("unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "compaction_failed" });
    const controller = new AbortController();
    await expect(
      compactContextToFit({
        ...base,
        signal: controller.signal,
        summarize: async () => {
          controller.abort();
          return { messages: [], wasCompacted: true };
        },
      }),
    ).rejects.toThrow();
    expect(messages).toEqual(before);
  });
  it("preserves host-summary provenance across three consecutive recoveries", async () => {
    const provider = {
      countTokens,
      chat: vi.fn(async () => ({
        content: "Files inspected; tests pending",
        stopReason: "end_turn",
      })),
    } as unknown as LLMProvider;
    const compactor = createContextCompactor({ preserveLastN: 2 });
    let history: Message[] = [
      { role: "user", content: "Never deploy" },
      { role: "assistant", content: "old evidence ".repeat(1000) },
      { role: "user", content: "Continue" },
      { role: "assistant", content: "Inspecting" },
    ];
    for (let i = 0; i < 3; i++) {
      const result = await compactContextToFit({
        ...base,
        contextWindow: 10000,
        messages: history,
        summarize: (input, signal) => compactor.compact(input, provider, { signal }),
      });
      expect(result.messages[0]?.content).toContain("Never deploy");
      expect(
        String(result.messages[0]?.content).match(/User instructions preserved verbatim/g),
      ).toHaveLength(1);
      history = [
        ...result.messages,
        { role: "user", content: "Continue" },
        { role: "assistant", content: "more evidence ".repeat(1000) },
      ];
    }
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });
});
