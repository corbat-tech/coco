import { createServer } from "node:http";
import { expect, it } from "vitest";
import { GeminiProvider } from "../src/providers/gemini.js";

it.each(["deadline", "return"])(
  "Gemini closes a pending SSE body on %s",
  async (mode) => {
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
      const provider = new GeminiProvider();
      await provider.initialize({
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
        await expect(iterator.next()).rejects.toMatchObject({ name: "TimeoutError" });
      } else {
        await iterator.return?.();
      }
      await closed;
      expect(controller.signal.aborted).toBe(false);
      expect(requests).toBe(1);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await iterator?.return?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  5000,
);
