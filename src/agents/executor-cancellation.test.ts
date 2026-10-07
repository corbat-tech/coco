import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentExecutor, type AgentDefinition, type AgentResult } from "./executor.js";
import { ToolRegistry } from "../tools/registry.js";
import { RuntimeToolExecutor } from "../runtime/runtime-tool-executor.js";
import type { ChatWithToolsResponse, LLMProvider } from "../providers/types.js";

const definition: AgentDefinition = {
  role: "researcher",
  systemPrompt: "Fixture",
  allowedTools: ["read_file"],
  maxTurns: 3,
};
const task = { id: "fixture-task", description: "Fixture task" };
const response: ChatWithToolsResponse = {
  id: "fixture",
  content: "fixture completed",
  stopReason: "end_turn",
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "fixture",
  toolCalls: [],
};
function fixture() {
  const chat = vi.fn<LLMProvider["chatWithTools"]>();
  const provider: LLMProvider = {
    id: "fixture",
    name: "fixture",
    initialize: vi.fn(),
    chat: vi.fn(),
    chatWithTools: chat,
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: () => 1,
    getContextWindow: () => 200000,
    isAvailable: async () => true,
  };
  const registry = new ToolRegistry();
  const effect = vi.fn().mockResolvedValue("fixture data");
  registry.register({
    name: "read_file",
    description: "In-memory read",
    category: "file",
    parameters: z.object({ path: z.string() }),
    execute: effect,
  });
  const executor = new AgentExecutor(provider, registry);
  const runtime = new RuntimeToolExecutor({ toolRegistry: registry, mode: "ask" });
  return { chat, effect, executor, runtime };
}
function failed(result: AgentResult, diagnostic: string) {
  expect(result.success).toBe(false);
  expect(result.output).toContain(diagnostic);
  expect(result.structuredResult).toBeDefined();
  expect(result.structuredResult?.status).toBe("failed");
}

describe("AgentExecutor cancellation boundaries", () => {
  it("pre-abort returns structured failure without a provider call", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort"));
    const result = await f.executor.execute(definition, task, { signal: controller.signal });
    failed(result, "fixture preabort");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.effect).not.toHaveBeenCalled();
  });

  it("passes the host signal to the provider on a successful execution", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockResolvedValue(response);
    const result = await f.executor.execute(definition, task, { signal: controller.signal });
    expect(result.success).toBe(true);
    expect(result.output).toBe(response.content);
    expect(f.chat.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("does not accept a late provider success after cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockImplementation(async () => {
      controller.abort(new Error("fixture late cancel"));
      return response;
    });
    const result = await f.executor.execute(definition, task, { signal: controller.signal });
    failed(result, "fixture late cancel");
    expect(result.output).not.toContain(response.content);
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("normalizes provider AbortError to the original host reason without retry", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockImplementation(async () => {
      controller.abort(new Error("fixture host stop"));
      throw Object.assign(new Error("SDK abort wrapper"), { name: "AbortError" });
    });
    const result = await f.executor.execute(definition, task, { signal: controller.signal });
    failed(result, "fixture host stop");
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("preserves an independent late failure instead of masking it with cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockImplementation(async () => {
      controller.abort(new Error("fixture cancellation"));
      throw new Error("fixture ENOSPC diagnostic");
    });
    const result = await f.executor.execute(definition, task, { signal: controller.signal });
    failed(result, "fixture ENOSPC diagnostic");
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("abort during the first real tool prevents second tool and next provider turn", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockResolvedValue({
      ...response,
      stopReason: "tool_use",
      toolCalls: [
        { id: "first", name: "read_file", input: { path: "first" } },
        { id: "second", name: "read_file", input: { path: "second" } },
      ],
    });
    f.effect.mockImplementation(async () => {
      controller.abort(new Error("fixture tool canceled"));
      return "first tool finished late";
    });
    const result = await f.executor.execute(definition, task, { signal: controller.signal });
    failed(result, "fixture tool canceled");
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.chat).toHaveBeenCalledOnce();
  });

  it("delegated tool cancellation also leaves later calls undispatched", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.chat.mockResolvedValue({
      ...response,
      stopReason: "tool_use",
      toolCalls: [
        { id: "first", name: "read_file", input: { path: "first" } },
        { id: "second", name: "read_file", input: { path: "second" } },
      ],
    });
    const dispatch = vi.fn(async (call: Parameters<RuntimeToolExecutor["execute"]>[0]) => {
      const result = await f.runtime.execute(call);
      controller.abort(new Error("fixture delegation canceled"));
      return result;
    });
    const result = await f.executor.execute(definition, task, {
      signal: controller.signal,
      executeDelegatedTool: dispatch,
    });
    failed(result, "fixture delegation canceled");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.chat).toHaveBeenCalledOnce();
  });
});
