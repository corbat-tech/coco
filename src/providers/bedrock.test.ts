import { beforeEach, describe, expect, it, vi } from "vitest";
const aws = vi.hoisted(() => ({ send: vi.fn(), client: vi.fn(), credentials: vi.fn() }));
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor(config: unknown) {
      aws.client(config);
    }
    send = aws.send;
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
  ConverseStreamCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock("@aws-sdk/credential-providers", () => ({ fromNodeProviderChain: aws.credentials }));
import { BedrockProvider } from "./bedrock.js";
import type { Message } from "./types.js";
const tools = [
  {
    name: "read_file",
    description: "Read",
    input_schema: { type: "object" as const, properties: {} },
  },
];
async function create() {
  const p = new BedrockProvider();
  await p.initialize({
    region: "eu-west-1",
    awsProfile: "development",
    model: "anthropic.claude-opus-5-5",
  });
  return p;
}
async function* events(values: unknown[]) {
  yield* values;
}
beforeEach(() => vi.clearAllMocks());
describe("Bedrock Converse contract", () => {
  it("uses AWS credential chain and signs for the chosen region", async () => {
    await create();
    expect(aws.credentials).toHaveBeenCalledWith({ profile: "development" });
    expect(aws.client).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-west-1", maxAttempts: 1 }),
    );
  });
  it("converts tools, reasoning and result IDs through a full round trip", async () => {
    const provider = await create();
    const reasoning = {
      reasoningContent: { reasoningText: { text: "trace", signature: "signed" } },
    };
    aws.send.mockResolvedValue({
      output: {
        message: {
          role: "assistant",
          content: [
            reasoning,
            { toolUse: { toolUseId: "call", name: "read_file", input: { path: "a" } } },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 2, outputTokens: 3 },
    });
    const result = await provider.chatWithTools([{ role: "user", content: "Read" }], {
      tools,
      thinking: "max",
    });
    expect(result.toolCalls[0]?.providerState?.bedrockBlocks).toEqual([reasoning]);
    expect(aws.send.mock.calls[0]![0].input).toMatchObject({
      modelId: "anthropic.claude-opus-5-5",
      additionalModelRequestFields: {
        thinking: { type: "adaptive" },
        output_config: { effort: "max" },
      },
    });
    const history: Message[] = [
      { role: "assistant", content: [{ type: "tool_use", ...result.toolCalls[0]! }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call", content: "result" }] },
    ];
    await provider.chatWithTools(history, { tools });
    expect(aws.send.mock.calls[1]![0].input.messages[0].content[0]).toEqual(reasoning);
    expect(aws.send.mock.calls[1]![0].input.messages[1].content[0].toolResult.toolUseId).toBe(
      "call",
    );
  });
  it("does not emit executable tools from a truncated stream", async () => {
    const provider = await create();
    aws.send.mockResolvedValue({
      stream: events([
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "a", name: "read_file" } },
          },
        },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"path":' } } } },
      ]),
    });
    const collected = [];
    await expect(
      (async () => {
        for await (const chunk of provider.streamWithTools([], { tools })) collected.push(chunk);
      })(),
    ).rejects.toThrow(/without messageStop/);
    expect(collected).toEqual([]);
  });
  it("streams signed reasoning and publishes tools only after terminal validation", async () => {
    const provider = await create();
    aws.send.mockResolvedValue({
      stream: events([
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { text: "trace" } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { signature: "signed" } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        {
          contentBlockStart: {
            contentBlockIndex: 1,
            start: { toolUse: { toolUseId: "a", name: "read_file" } },
          },
        },
        { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: "{}" } } } },
        { contentBlockStop: { contentBlockIndex: 1 } },
        { messageStop: { stopReason: "tool_use" } },
      ]),
    });
    const output = [];
    for await (const chunk of provider.streamWithTools([], { tools })) output.push(chunk);
    expect(output[0]).toMatchObject({
      type: "tool_use_end",
      toolCall: {
        input: {},
        providerState: { provider: "bedrock", model: "anthropic.claude-opus-5-5" },
      },
    });
    expect(output[1]).toMatchObject({ type: "done", stopReason: "tool_use" });
  });
  it("rejects duplicate nonstream tool IDs before executing a batch", async () => {
    const provider = await create();
    aws.send.mockResolvedValue({
      stopReason: "tool_use",
      output: {
        message: {
          content: [
            { toolUse: { toolUseId: "same", name: "read_file", input: {} } },
            { toolUse: { toolUseId: "same", name: "read_file", input: {} } },
          ],
        },
      },
    });
    await expect(provider.chatWithTools([], { tools })).rejects.toThrow(/Duplicate/);
  });
  it("preserves redacted reasoning bytes after history JSON serialization", async () => {
    const provider = await create();
    aws.send.mockResolvedValue({
      stream: events([
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { redactedContent: Uint8Array.from([1, 2]) } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { redactedContent: Uint8Array.from([3]) } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        {
          contentBlockStart: {
            contentBlockIndex: 1,
            start: { toolUse: { toolUseId: "a", name: "read_file" } },
          },
        },
        { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: "{}" } } } },
        { contentBlockStop: { contentBlockIndex: 1 } },
        { messageStop: { stopReason: "tool_use" } },
      ]),
    });
    const output = [];
    for await (const chunk of provider.streamWithTools([], { tools })) output.push(chunk);
    const call = JSON.parse(
      JSON.stringify(output.find((chunk) => chunk.type === "tool_use_end")?.toolCall),
    );
    aws.send.mockResolvedValue({
      stopReason: "end_turn",
      output: { message: { content: [{ text: "done" }] } },
    });
    await provider.chatWithTools(
      [{ role: "assistant", content: [{ type: "tool_use", ...call }] }],
      { tools },
    );
    expect(aws.send.mock.calls[1]![0].input.messages[0].content[0]).toEqual({
      reasoningContent: { redactedContent: Buffer.from([1, 2, 3]) },
    });
  });
  it("forwards cancellation and never sends pre-cancelled requests", async () => {
    const provider = await create();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(provider.chat([], { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(aws.send).not.toHaveBeenCalled();
  });
});
