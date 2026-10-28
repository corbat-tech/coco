import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentManager } from "./manager.js";
import { ToolRegistry } from "../../../tools/registry.js";
import type { ChatWithToolsResponse, LLMProvider } from "../../../providers/types.js";

const terminal: ChatWithToolsResponse = {
  id: "fixture",
  content: "Observed result",
  stopReason: "end_turn",
  toolCalls: [],
  usage: { inputTokens: 3, outputTokens: 2 },
  model: "fixture",
};

function fixture() {
  const chat = vi.fn<LLMProvider["chatWithTools"]>().mockResolvedValue(terminal);
  const provider = {
    id: "fixture",
    name: "fixture",
    chatWithTools: chat,
  } as unknown as LLMProvider;
  const registry = new ToolRegistry();
  const effect = vi.fn(async () => "observed file");
  registry.register({
    name: "read_file",
    description: "Read fixture",
    category: "file",
    parameters: z.object({ path: z.string() }),
    execute: effect,
  });
  return { manager: new AgentManager(provider, registry), chat, effect, provider };
}

describe("specialist terminal integrity", () => {
  it("never executes a tool from a truncated response", async () => {
    const f = fixture();
    f.chat.mockResolvedValue({
      ...terminal,
      stopReason: "max_tokens",
      toolCalls: [{ id: "read", name: "read_file", input: { path: "file" } }],
    });
    const result = await f.manager.spawn("explore", "Read fixture");
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/truncat|incomplete/i);
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("honors a requested turn ceiling and does not report exhaustion as completion", async () => {
    const f = fixture();
    f.chat.mockResolvedValue({
      ...terminal,
      content: "",
      stopReason: "tool_use",
      toolCalls: [{ id: "read", name: "read_file", input: { path: "file" } }],
    });
    const result = await f.manager.spawn("explore", "Read fixture", { maxTurns: 1 });
    expect(f.chat).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/turn.*limit|exhaust/i);
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it("preserves model, thinking, output reserve and project instructions", async () => {
    const f = fixture();
    await f.manager.spawn("explore", "Read fixture", {
      model: "selected-model",
      thinking: "high",
      maxTokens: 512,
      projectInstructions: "Use the user's Python conventions.",
    });
    expect(f.chat.mock.calls[0]?.[1]).toMatchObject({
      model: "selected-model",
      thinking: "high",
      maxTokens: 512,
    });
    expect(f.chat.mock.calls[0]?.[1].system).toContain("user's Python conventions");
  });

  it("rejects tool-use stop without calls instead of reporting success", async () => {
    const f = fixture();
    f.chat.mockResolvedValue({ ...terminal, stopReason: "tool_use", toolCalls: [] });
    expect((await f.manager.spawn("explore", "Read fixture")).success).toBe(false);
  });

  it("does not execute tools attached to a terminal stop reason", async () => {
    const f = fixture();
    f.chat.mockResolvedValue({
      ...terminal,
      stopReason: "end_turn",
      toolCalls: [{ id: "read", name: "read_file", input: { path: "fixture" } }],
    });
    expect((await f.manager.spawn("explore", "Read fixture")).success).toBe(false);
    expect(f.effect).not.toHaveBeenCalled();
  });

  it("does not mark an unknown stop reason without tools as completed", async () => {
    const f = fixture();
    f.chat.mockResolvedValue({
      ...terminal,
      stopReason: "unknown",
    } as unknown as ChatWithToolsResponse);
    expect((await f.manager.spawn("explore", "Read fixture")).success).toBe(false);
    expect(f.effect).not.toHaveBeenCalled();
  });

  it("rejects an oversized composed context before dispatching a model request", async () => {
    const f = fixture();
    f.provider.getContextWindow = () => 32;
    f.provider.countTokens = (text) => text.length;
    const result = await f.manager.spawn("explore", "Inspect the code");
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/context exceeds/i);
    expect(f.chat).not.toHaveBeenCalled();
  });
});
