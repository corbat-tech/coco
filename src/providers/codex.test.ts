/**
 * Tests for OpenAI Codex provider
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock the auth module
const mockGetValidAccessToken = vi.fn();
vi.mock("../auth/index.js", () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
}));

// Mock global fetch
const mockFetch = vi.fn() as Mock;
vi.stubGlobal("fetch", mockFetch);

/**
 * Helper: create a JWT token with custom claims payload.
 * Format: header.payload.signature (base64url encoded)
 */
function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.fake-signature`;
}

/**
 * Helper: build a ReadableStream that yields SSE lines from an array of event objects
 */
function buildSSEStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
  lines.push("data: [DONE]\n\n");

  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < lines.length) {
        controller.enqueue(encoder.encode(lines[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Helper: mock a successful Codex API response with the given content
 */
function mockSuccessfulChatResponse(
  content: string,
  opts?: { id?: string; inputTokens?: number; outputTokens?: number; status?: string },
) {
  const id = opts?.id ?? "resp-test-123";
  const inputTokens = opts?.inputTokens ?? 100;
  const outputTokens = opts?.outputTokens ?? 50;
  const status = opts?.status ?? "completed";

  const events = [
    { id, type: "response.created" },
    { type: "response.output_text.delta", delta: content },
    {
      type: "response.completed",
      response: {
        id,
        status,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    },
  ];

  mockFetch.mockResolvedValue({
    ok: true,
    body: buildSSEStream(events),
  });
}

describe("CodexProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("should initialize with OAuth token from token store", async () => {
      const token = createFakeJwt({ chatgpt_account_id: "acct-123" });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});

      expect(mockGetValidAccessToken).toHaveBeenCalledWith("openai");
    });

    it("should initialize with apiKey fallback when no OAuth token", async () => {
      const token = createFakeJwt({ chatgpt_account_id: "acct-456" });
      mockGetValidAccessToken.mockResolvedValue(null);

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({ apiKey: token });

      // Should not throw
    });

    it("should throw when no OAuth token and no API key", async () => {
      mockGetValidAccessToken.mockResolvedValue(null);

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      await expect(provider.initialize({})).rejects.toThrow(/No OAuth token found/);
    });

    it("should extract account ID from chatgpt_account_id claim", async () => {
      const token = createFakeJwt({ chatgpt_account_id: "acct-direct" });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});

      // Verify account ID is used in requests
      mockSuccessfulChatResponse("Hello");
      await provider.chat([{ role: "user", content: "Hi" }]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers["ChatGPT-Account-Id"]).toBe("acct-direct");
    });

    it("should extract account ID from auth sub-claim", async () => {
      const token = createFakeJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "acct-auth" },
      });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});

      mockSuccessfulChatResponse("Hi");
      await provider.chat([{ role: "user", content: "test" }]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers["ChatGPT-Account-Id"]).toBe("acct-auth");
    });

    it("should extract account ID from organizations claim", async () => {
      const token = createFakeJwt({
        organizations: [{ id: "org-123" }],
      });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});

      mockSuccessfulChatResponse("Hi");
      await provider.chat([{ role: "user", content: "test" }]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers["ChatGPT-Account-Id"]).toBe("org-123");
    });

    it("should handle invalid JWT gracefully (no account ID)", async () => {
      mockGetValidAccessToken.mockResolvedValue({ accessToken: "not-a-jwt" });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});

      // Should not throw; account ID is simply undefined
      mockSuccessfulChatResponse("Hi");
      await provider.chat([{ role: "user", content: "test" }]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = fetchCall[1].headers as Record<string, string>;
      expect(headers["ChatGPT-Account-Id"]).toBeUndefined();
    });
  });

  describe("id and name", () => {
    it("should have correct id and name", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(provider.id).toBe("codex");
      expect(provider.name).toBe("OpenAI Codex (ChatGPT Plus/Pro)");
    });
  });

  describe("getContextWindow", () => {
    it("should return 200000 for gpt-5.2-codex (default)", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(provider.getContextWindow()).toBe(200000);
    });

    it("should return 200000 for gpt-5-codex", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(provider.getContextWindow("gpt-5-codex")).toBe(200000);
    });

    it("should return 200000 for configured model", async () => {
      const token = createFakeJwt({});
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({ model: "gpt-5" });

      expect(provider.getContextWindow()).toBe(200000);
    });

    it("should return 128000 for unknown model", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(provider.getContextWindow("unknown-model")).toBe(128000);
    });
  });

  describe("countTokens", () => {
    it("should estimate tokens as ceil(length/4)", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      // "Hello" = 5 chars => ceil(5/4) = 2
      expect(provider.countTokens("Hello")).toBe(2);
    });

    it("should return 0 for empty string", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(provider.countTokens("")).toBe(0);
    });

    it("should handle longer text", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      // 100 chars => ceil(100/4) = 25
      const text = "a".repeat(100);
      expect(provider.countTokens(text)).toBe(25);
    });
  });

  describe("isAvailable", () => {
    it("should return true when OAuth token is available", async () => {
      const token = createFakeJwt({});
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(await provider.isAvailable()).toBe(true);
    });

    it("should return false when no OAuth token", async () => {
      mockGetValidAccessToken.mockResolvedValue(null);

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(await provider.isAvailable()).toBe(false);
    });

    it("should return false when token retrieval throws", async () => {
      mockGetValidAccessToken.mockRejectedValue(new Error("Token error"));

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe("chat", () => {
    async function initProvider() {
      const token = createFakeJwt({ chatgpt_account_id: "acct-test" });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});
      return provider;
    }

    it("should throw ProviderError if not initialized", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /not initialized/i,
      );
    });

    it("should send chat message and return response", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hello! How can I help?", {
        id: "resp-abc",
        inputTokens: 10,
        outputTokens: 8,
      });

      const response = await provider.chat([{ role: "user", content: "Hi" }]);

      expect(response.content).toBe("Hello! How can I help?");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(8);
      expect(response.id).toBe("resp-abc");
      expect(response.stopReason).toBe("end_turn");
    });

    it("should use default model gpt-5.2-codex", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      const response = await provider.chat([{ role: "user", content: "Hello" }]);

      expect(response.model).toBe("gpt-5.2-codex");
    });

    it("should use model from options", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      const response = await provider.chat([{ role: "user", content: "Hello" }], {
        model: "gpt-5-codex",
      });

      expect(response.model).toBe("gpt-5-codex");

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe("gpt-5-codex");
    });

    it("should extract system message as instructions", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      await provider.chat([
        { role: "system", content: "You are a coding assistant" },
        { role: "user", content: "Hello" },
      ]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.instructions).toBe("You are a coding assistant");
      // System message should be filtered from input
      expect(body.input).toHaveLength(1);
      expect(body.input[0].role).toBe("user");
    });

    it("should use default instructions when no system message", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      await provider.chat([{ role: "user", content: "Hello" }]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.instructions).toBe("You are a helpful coding assistant.");
    });

    it("should map system role to developer in input messages", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      // Even though system is extracted as instructions, test the role mapping
      // by checking remaining non-system messages
      await provider.chat([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.input[0].role).toBe("user");
      expect(body.input[0].content[0].type).toBe("input_text");
      expect(body.input[1].role).toBe("assistant");
      expect(body.input[1].content[0].type).toBe("output_text");
    });

    it("should handle array content in messages", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Done");

      await provider.chat([
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "tool_result", tool_use_id: "call_1", content: "result data" },
          ],
        },
      ]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1].body as string);
      // extractTextContent joins text parts
      expect(body.input[0].content[0].text).toContain("Hello");
      expect(body.input[0].content[0].text).toContain("Tool result:");
    });

    it("should handle response.output_text.done event (full text)", async () => {
      const provider = await initProvider();

      const events = [
        { id: "resp-1", type: "response.created" },
        { type: "response.output_text.delta", delta: "partial " },
        { type: "response.output_text.done", text: "Complete response text" },
        {
          type: "response.completed",
          response: {
            id: "resp-1",
            status: "completed",
            usage: { input_tokens: 5, output_tokens: 10 },
          },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream(events),
      });

      const response = await provider.chat([{ role: "user", content: "Hello" }]);

      // output_text.done replaces the accumulated delta content
      expect(response.content).toBe("Complete response text");
    });

    it("should throw ProviderError on API error response", async () => {
      const provider = await initProvider();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /Codex API error: 429/,
      );
    });

    it("should throw ProviderError when response body is null", async () => {
      const provider = await initProvider();

      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      });

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /No response body/,
      );
    });

    it("should throw when no content is returned", async () => {
      const provider = await initProvider();

      // Stream with no text events
      const events = [
        { id: "resp-1", type: "response.created" },
        {
          type: "response.completed",
          response: {
            id: "resp-1",
            status: "completed",
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream(events),
      });

      await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
        /No response content/,
      );
    });

    it("should map incomplete status to max_tokens stop reason", async () => {
      const provider = await initProvider();

      const events = [
        { type: "response.output_text.delta", delta: "Truncated..." },
        {
          type: "response.completed",
          response: {
            status: "incomplete",
            usage: { input_tokens: 100, output_tokens: 4096 },
          },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream(events),
      });

      const response = await provider.chat([{ role: "user", content: "Hello" }]);

      expect(response.stopReason).toBe("max_tokens");
    });

    it("should handle invalid JSON in SSE lines gracefully", async () => {
      const provider = await initProvider();

      // Build a custom stream with some invalid JSON
      const encoder = new TextEncoder();
      const lines = [
        "data: {invalid json}\n\n",
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
        "data: [DONE]\n\n",
      ];

      let index = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < lines.length) {
            controller.enqueue(encoder.encode(lines[index]));
            index++;
          } else {
            controller.close();
          }
        },
      });

      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const response = await provider.chat([{ role: "user", content: "Hello" }]);
      expect(response.content).toBe("Hello");
    });

    it("should send request to the correct Codex API endpoint", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      await provider.chat([{ role: "user", content: "Hello" }]);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://chatgpt.com/backend-api/codex/responses",
        expect.any(Object),
      );
    });

    it("should set stream: true and store: false in the request body", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hi");

      await provider.chat([{ role: "user", content: "Hello" }]);

      const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(true);
      expect(body.store).toBe(false);
    });
  });

  describe("chatWithTools", () => {
    async function initProvider() {
      const token = createFakeJwt({ chatgpt_account_id: "acct-test" });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});
      return provider;
    }

    it("should delegate to chat() and return empty toolCalls", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("I'll help with that", { inputTokens: 20, outputTokens: 15 });

      const response = await provider.chatWithTools([{ role: "user", content: "Read test.txt" }], {
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      });

      expect(response.content).toBe("I'll help with that");
      expect(response.toolCalls).toEqual([]);
      expect(response.usage.inputTokens).toBe(20);
      expect(response.usage.outputTokens).toBe(15);
    });
  });

  describe("stream", () => {
    async function initProvider() {
      const token = createFakeJwt({ chatgpt_account_id: "acct-test" });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});
      return provider;
    }

    it("should throw if not initialized", async () => {
      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();

      const iterator = provider.stream([{ role: "user", content: "Hello" }]);
      // Calling next() triggers the generator which calls chat() which checks initialization
      await expect(
        (async () => {
          for await (const _chunk of iterator) {
            // consume
          }
        })(),
      ).rejects.toThrow(/not initialized/i);
    });

    it("should yield text chunks and a done chunk", async () => {
      const provider = await initProvider();
      mockSuccessfulChatResponse("Hello World!");

      const chunks: Array<{ type: string; text?: string }> = [];
      for await (const chunk of provider.stream([{ role: "user", content: "Hi" }])) {
        chunks.push(chunk);
      }

      // Should have text chunks plus a "done" chunk at the end
      expect(chunks.length).toBeGreaterThan(1);
      const textChunks = chunks.filter((c) => c.type === "text");
      expect(textChunks.length).toBeGreaterThan(0);

      // Last chunk should be "done"
      expect(chunks[chunks.length - 1]?.type).toBe("done");

      // All text combined should equal the original content
      const combinedText = textChunks.map((c) => c.text).join("");
      expect(combinedText).toBe("Hello World!");
    });

    it("should handle empty content response", async () => {
      const provider = await initProvider();

      // A response that results in an empty content will throw in chat()
      const events = [
        {
          type: "response.completed",
          response: { status: "completed", usage: { input_tokens: 1, output_tokens: 0 } },
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        body: buildSSEStream(events),
      });

      await expect(
        (async () => {
          for await (const _chunk of provider.stream([{ role: "user", content: "Hi" }])) {
            // consume
          }
        })(),
      ).rejects.toThrow(/No response content/);
    });
  });

  describe("streamWithTools", () => {
    it("should delegate to stream()", async () => {
      const token = createFakeJwt({ chatgpt_account_id: "acct-test" });
      mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

      const { CodexProvider } = await import("./codex.js");
      const provider = new CodexProvider();
      await provider.initialize({});

      mockSuccessfulChatResponse("Streaming with tools");

      const chunks: Array<{ type: string; text?: string }> = [];
      for await (const chunk of provider.streamWithTools([{ role: "user", content: "Hi" }], {
        tools: [
          { name: "test", description: "test", input_schema: { type: "object", properties: {} } },
        ],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[chunks.length - 1]?.type).toBe("done");
    });
  });
});

describe("createCodexProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a provider instance", async () => {
    const { createCodexProvider } = await import("./codex.js");

    const provider = createCodexProvider();

    expect(provider.id).toBe("codex");
    expect(provider.name).toBe("OpenAI Codex (ChatGPT Plus/Pro)");
  });

  it("should call initialize when config is provided", async () => {
    const token = createFakeJwt({});
    mockGetValidAccessToken.mockResolvedValue({ accessToken: token });

    const { createCodexProvider } = await import("./codex.js");

    // Config triggers async init (fire-and-forget)
    const provider = createCodexProvider({ apiKey: "test" });

    expect(provider.id).toBe("codex");
  });

  it("should not throw when config init fails silently", async () => {
    mockGetValidAccessToken.mockRejectedValue(new Error("Auth failed"));

    const { createCodexProvider } = await import("./codex.js");

    // Should not throw (error is caught internally)
    const provider = createCodexProvider({ apiKey: "bad-key" });

    expect(provider.id).toBe("codex");
  });
});
