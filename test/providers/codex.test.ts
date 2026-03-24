/**
 * Tests for CodexProvider
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CodexProvider } from "../../src/providers/codex.js";

// Mock the auth module
vi.mock("../../src/auth/index.js", () => ({
  getValidAccessToken: vi.fn(),
}));

import { getValidAccessToken } from "../../src/auth/index.js";

describe("CodexProvider", () => {
  let provider: CodexProvider;

  beforeEach(() => {
    provider = new CodexProvider();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildRequestBody", () => {
    it("should use max_tokens instead of max_output_tokens in request body", async () => {
      // Mock valid access token
      vi.mocked(getValidAccessToken).mockResolvedValue({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600000,
      });

      await provider.initialize({
        apiKey: "test-token",
        model: "gpt-5.4-codex",
        maxTokens: 4096,
      });

      // Access private method via type assertion
      const buildRequestBody = (provider as unknown as {
        buildRequestBody(
          model: string,
          input: unknown,
          instructions: string | undefined,
          options: { maxTokens?: number; temperature?: number } | undefined,
        ): Record<string, unknown>;
      }).buildRequestBody;

      const body = buildRequestBody.call(
        provider,
        "gpt-5.4-codex",
        [{ role: "user", content: "Hello" }],
        undefined,
        { maxTokens: 4096, temperature: 0.7 },
      );

      // Verify max_tokens is present
      expect(body).toHaveProperty("max_tokens");
      expect(body.max_tokens).toBe(4096);

      // Verify max_output_tokens is NOT present
      expect(body).not.toHaveProperty("max_output_tokens");
    });

    it("should use default max_tokens when not provided", async () => {
      vi.mocked(getValidAccessToken).mockResolvedValue({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600000,
      });

      await provider.initialize({
        apiKey: "test-token",
        model: "gpt-5.4-codex",
      });

      const buildRequestBody = (provider as unknown as {
        buildRequestBody(
          model: string,
          input: unknown,
          instructions: string | undefined,
          options: { maxTokens?: number; temperature?: number } | undefined,
        ): Record<string, unknown>;
      }).buildRequestBody;

      const body = buildRequestBody.call(
        provider,
        "gpt-5.4-codex",
        [{ role: "user", content: "Hello" }],
        undefined,
        undefined,
      );

      // Verify default max_tokens (8192)
      expect(body).toHaveProperty("max_tokens");
      expect(body.max_tokens).toBe(8192);
      expect(body).not.toHaveProperty("max_output_tokens");
    });
  });

  describe("makeRequest", () => {
    it("should send max_tokens parameter to Codex API endpoint", async () => {
      // Mock fetch to capture the request body
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type": "response.completed", "response": {"output": []}}\n\n',
              ),
            );
            controller.close();
          },
        }),
        headers: new Headers({ "content-type": "text/event-stream" }),
      });
      global.fetch = fetchMock;

      vi.mocked(getValidAccessToken).mockResolvedValue({
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600000,
      });

      await provider.initialize({
        apiKey: "test-token",
        model: "gpt-5.4-codex",
        maxTokens: 2048,
      });

      // Trigger a chat request
      const messages = [{ role: "user" as const, content: "Hello" }];

      try {
        // Consume the async generator
        for await (const _chunk of provider.chat(messages, { maxTokens: 2048 })) {
          // Just consume the stream
        }
      } catch {
        // Expected to fail due to mock stream parsing
      }

      // Verify fetch was called
      expect(fetchMock).toHaveBeenCalled();

      // Get the request body
      const callArgs = fetchMock.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body as string);

      // Verify the request uses max_tokens, not max_output_tokens
      expect(requestBody).toHaveProperty("max_tokens");
      expect(requestBody.max_tokens).toBe(2048);
      expect(requestBody).not.toHaveProperty("max_output_tokens");
    });
  });
});
