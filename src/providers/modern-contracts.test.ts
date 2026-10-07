import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ chat: vi.fn(), responses: vi.fn(), list: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    static APIError = class extends Error {};
    chat = { completions: { create: io.chat } };
    responses = { create: io.responses };
    models = { list: io.list };
  },
}));
import { OpenAIProvider } from "./openai.js";
import { resolveModelMigration, MODEL_RETIREMENTS } from "./model-lifecycle.js";
import { getCatalogModel } from "./catalog.js";
import {
  getThinkingCapability,
  mapToAnthropic,
  mapToAnthropicEffort,
  mapToGeminiThinkingConfig,
} from "./thinking.js";
import { estimateCost, formatCost } from "./pricing.js";
import { assertRuntimeUsageWithinPolicy } from "../runtime/context.js";
import type { Message } from "./types.js";
const tools = [
  {
    name: "read_file",
    description: "Read",
    input_schema: { type: "object" as const, properties: {} },
  },
];
const user: Message[] = [{ role: "user", content: "Read file" }];
function toolReply(reasoning = "opaque reasoning") {
  return {
    id: "reply",
    model: "fixture",
    usage: {},
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          reasoning_content: reasoning,
          tool_calls: [
            {
              id: "call",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"a.ts"}' },
            },
          ],
        },
      },
    ],
  };
}
async function adapter(id: string, model: string) {
  const p = new OpenAIProvider(id, id);
  await p.initialize({ apiKey: "fixture", model });
  return p;
}
beforeEach(() => {
  vi.resetAllMocks();
  io.chat.mockResolvedValue(toolReply());
  io.responses.mockResolvedValue({
    id: "response",
    status: "completed",
    model: "grok-4.7",
    output_text: "",
    usage: {},
    output: [
      { type: "reasoning", id: "reasoning", encrypted_content: "ciphertext", summary: [] },
      { type: "function_call", id: "item", call_id: "call", name: "read_file", arguments: "{}" },
    ],
  });
});
describe("documented model contracts", () => {
  it("uses published long-context prices and never treats unknown cloud rates as free", () => {
    expect(estimateCost("claude-haiku-5-5", 100001, 1000000, "anthropic").outputCost).toBe(2.5);
    expect(estimateCost("gpt-5.6-luna", 272001, 1000000, "openai").outputCost).toBeCloseTo(1.8);
    expect(
      formatCost(estimateCost("anthropic.claude-sonnet-5-5", 100, 100, "bedrock").totalCost),
    ).toBe("Unknown");
    expect(() =>
      assertRuntimeUsageWithinPolicy(
        { costBudget: { maxEstimatedCostUsd: 1 } },
        { estimatedCostUsd: Number.NaN },
      ),
    ).toThrow(/pricing unavailable/);
  });
  it("all retirement chains resolve to a selectable model on the same platform", () => {
    for (const entry of MODEL_RETIREMENTS) {
      const migrated = resolveModelMigration(entry.provider, entry.model);
      expect(getCatalogModel(entry.provider, migrated.model)).toBeDefined();
      expect(migrated.warning).toContain(entry.model);
      expect(getCatalogModel(entry.provider, entry.model)).toBeUndefined();
    }
    expect(resolveModelMigration("copilot", "gpt-5.2-codex")).toEqual({ model: "gpt-5.2-codex" });
    expect(resolveModelMigration("openai", "customer-finetune")).toEqual({
      model: "customer-finetune",
    });
  });
  it("exposes extended effort levels and honors Anthropic's new off contract", () => {
    expect(getThinkingCapability("anthropic", "claude-opus-5-5").levels).toContain("max");
    expect(mapToAnthropicEffort("max", "claude-fable-5-1")).toBe("max");
    expect(() => mapToAnthropic("off", "claude-opus-5-5")).toThrow(/requires reasoning/);
    expect(mapToAnthropic("off", "claude-sonnet-5-5")).toEqual({ type: "between_tools" });
    expect(mapToAnthropic("off", "claude-haiku-5-5")).toEqual({ type: "disabled" });
  });
  it("does not silently map an unsupported Gemini off level to low", () => {
    expect(() => mapToGeminiThinkingConfig("off", "gemini-3.8-flash")).toThrow(
      /requires reasoning/,
    );
    expect(mapToGeminiThinkingConfig("high", "gemini-3.8-flash")).toEqual({
      thinkingLevel: "high",
    });
  });
  it.each([
    ["minimax", "MiniMax-M3"],
    ["kimi", "kimi-k2.7-code"],
    ["deepseek", "deepseek-flash"],
    ["cerebras", "qwen-3.8-27b"],
  ])("preserves %s reasoning through a tool round trip", async (id, model) => {
    const p = await adapter(id!, model!);
    const result = await p.chatWithTools(user, { tools, maxRetries: 0 });
    const call = result.toolCalls[0]!;
    expect(call.providerState?.reasoningContent).toBe("opaque reasoning");
    await p.chatWithTools(
      [
        ...user,
        { role: "assistant", content: [{ type: "tool_use", ...call }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "file" }] },
      ],
      { tools, maxRetries: 0 },
    );
    const request = io.chat.mock.calls[1]![0];
    expect(request.messages[1].reasoning_content).toBe("opaque reasoning");
    if (id === "minimax" || id === "cerebras") expect(request.parallel_tool_calls).toBeUndefined();
    const other = await adapter("groq", "openai/gpt-oss-120b");
    await other.chatWithTools([{ role: "assistant", content: [{ type: "tool_use", ...call }] }], {
      tools,
      maxRetries: 0,
    });
    expect(io.chat.mock.calls[2]![0].messages[0].reasoning_content).toBeUndefined();
  });
  it("preserves fragmented streaming reasoning and hides typed Mistral thinking chunks", async () => {
    const p = await adapter("deepseek", "deepseek-flash");
    io.chat.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { reasoning_content: "first " } }] };
        yield {
          choices: [
            {
              delta: {
                reasoning_content: "second",
                tool_calls: [
                  { index: 0, id: "call", function: { name: "read_file", arguments: "{}" } },
                ],
              },
            },
          ],
        };
        yield { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
      })(),
    );
    const events = [];
    for await (const event of p.streamWithTools(user, { tools })) events.push(event);
    expect(
      events.find((event) => event.type === "tool_use_end")?.toolCall?.providerState
        ?.reasoningContent,
    ).toBe("first second");
    const mistral = await adapter("mistral", "mistral-medium-3-5");
    const response = toolReply();
    Object.assign(response.choices[0]!.message, {
      content: [
        { type: "thinking", thinking: [{ type: "text", text: "private" }] },
        { type: "text", text: "visible" },
      ],
    });
    io.chat.mockResolvedValue(response);
    expect((await mistral.chatWithTools(user, { tools })).content).toBe("visible");
  });
  it("routes Grok through stateless Responses and replays encrypted items", async () => {
    const p = await adapter("xai", "grok-4.7");
    const result = await p.chatWithTools(user, { tools, thinking: "xhigh", maxRetries: 0 });
    expect(io.chat).not.toHaveBeenCalled();
    expect(io.responses.mock.calls[0]![0]).toMatchObject({
      store: false,
      reasoning: { effort: "xhigh" },
    });
    const call = result.toolCalls[0]!;
    await p.chatWithTools([{ role: "assistant", content: [{ type: "tool_use", ...call }] }], {
      tools,
      maxRetries: 0,
    });
    expect(io.responses.mock.calls[1]![0].input).toContainEqual(
      expect.objectContaining({ encrypted_content: "ciphertext" }),
    );
  });
  it("rejects mandatory reasoning off before making a request", async () => {
    const p = await adapter("minimax", "MiniMax-M2.7");
    await expect(p.chatWithTools(user, { tools, thinking: "off", maxRetries: 0 })).rejects.toThrow(
      /requires reasoning/,
    );
    expect(io.chat).not.toHaveBeenCalled();
  });
  it("a reachable model list does not prove access to the chosen model", async () => {
    const p = await adapter("groq", "unavailable-model");
    io.list.mockResolvedValue({ data: [{ id: "different-model" }] });
    io.chat.mockRejectedValue(new Error("model unavailable"));
    expect(await p.isAvailable()).toBe(false);
    expect(io.chat).toHaveBeenCalledOnce();
  });
});
