import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { VertexProvider } from "../src/providers/vertex.js";
import { GeminiProvider } from "../src/providers/gemini.js";

it.each([
  ["gemini", "deadline"],
  ["gemini", "return"],
  ["vertex", "deadline"],
  ["vertex", "return"],
])(
  "%s closes a pending SSE body on %s",
  async (kind, mode) => {
    let disconnected!: () => void;
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      request.resume();
      response.on("close", disconnected);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "READY" }] } }] })}\n\n`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local listener");
    const controller = new AbortController();
    let iterator: AsyncIterator<unknown> | undefined;
    try {
      // Exercise the 100 ms deadline after the real SSE body is observable.
      // Cold SDK/HTTP startup on a busy runner must not consume this test's
      // pending-body interval. Network I/O and server closure remain real.
      if (mode === "deadline") {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      }
      const provider = kind === "vertex" ? new VertexProvider() : new GeminiProvider();
      await provider.initialize({
        project: "fixture-project",
        apiKey: "fixture-not-a-real-key",
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
      iterator = provider
        .stream([{ role: "user", content: "local fixture" }], {
          signal: controller.signal,
          timeout: mode === "deadline" ? 100 : 2000,
        })
        [Symbol.asyncIterator]();
      expect(await iterator.next()).toMatchObject({ value: { type: "text", text: "READY" } });
      if (mode === "deadline") {
        const pending = expect(iterator.next()).rejects.toMatchObject({ name: "TimeoutError" });
        await vi.advanceTimersByTimeAsync(100);
        await pending;
      } else {
        await iterator.return?.();
      }
      await closed;
      expect(controller.signal.aborted).toBe(false);
      expect(requests).toBe(1);
    } finally {
      try {
        controller.abort();
        server.closeAllConnections();
        await iterator?.return?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      } finally {
        vi.useRealTimers();
      }
    }
  },
  5000,
);
