import { createServer } from "node:http";
import { expect, it } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { ResilientProvider } from "../src/providers/resilient.js";

it.each(["openai", "anthropic", "gemini"])(
  "%s real SDK respects the outer retry budget on local HTTP",
  async (kind) => {
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      request.resume();
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { type: "api_error", message: "fixture temporary failure" } }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local server address");
    const controller = new AbortController();
    try {
      const provider =
        kind === "openai"
          ? new OpenAIProvider()
          : kind === "gemini"
            ? new GeminiProvider()
            : new AnthropicProvider();
      await provider.initialize({
        apiKey: "local-fixture-key",
        model:
          kind === "openai"
            ? "gpt-4o"
            : kind === "gemini"
              ? "gemini-2.5-flash"
              : "claude-sonnet-4-6",
        baseUrl: `http://127.0.0.1:${address.port}`,
        timeout: 1000,
      });
      const wrapper = new ResilientProvider(provider, {
        retry: { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 },
      });
      await expect(
        wrapper.chat([{ role: "user", content: "local fixture" }], {
          maxRetries: 1,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(requests).toBe(2);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  15000,
);
