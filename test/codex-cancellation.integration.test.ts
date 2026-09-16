import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { CodexProvider } from "../src/providers/codex.js";

vi.mock("../src/auth/index.js", () => ({
  getValidAccessToken: async () => ({ accessToken: "local-fixture-token" }),
}));
const realFetch = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([
  ["chat", "headers"],
  ["chatWithTools", "headers"],
  ["stream", "headers"],
  ["streamWithTools", "headers"],
  ["stream", "body"],
  ["streamWithTools", "body"],
] as const)(
  "Codex %s cancels real HTTP during %s",
  async (method, phase) => {
    const received = deferred();
    const disconnected = deferred();
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      request.resume();
      response.on("close", disconnected.resolve);
      if (phase === "body") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "READY" })}\n\n`,
        );
      }
      received.resolve();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    // Keep the production endpoint contract intact; redirect this fixture only to loopback.
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      return realFetch(`http://127.0.0.1:${address.port}/responses`, init);
    });
    const controller = new AbortController();
    const seen: string[] = [];
    let outcome: Promise<unknown> | undefined;
    try {
      const provider = new CodexProvider();
      await provider.initialize({ timeout: 2000 });
      const messages = [{ role: "user" as const, content: "local fixture" }];
      const options = { signal: controller.signal, maxRetries: 0, tools: [] };
      const pending =
        method === "chat" || method === "chatWithTools"
          ? provider[method](messages, options)
          : (async () => {
              for await (const chunk of provider[method](messages, options)) {
                seen.push(chunk.type);
                if (phase === "body" && chunk.type === "text") controller.abort();
              }
            })();
      outcome = pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      expect(
        await Promise.race([received.promise.then(() => "received"), outcome.then(() => "ended")]),
      ).toBe("received");
      if (phase === "headers") controller.abort();
      expect(await outcome).toEqual({ error: controller.signal.reason });
      await disconnected.promise;
      expect(requests).toBe(1);
      expect(seen).toEqual(phase === "body" ? ["text"] : []);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await outcome;
    }
  },
  5000,
);
