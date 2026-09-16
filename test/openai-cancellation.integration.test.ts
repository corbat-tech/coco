import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { OpenAIProvider } from "../src/providers/openai.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("OpenAI SDK cancellation against local HTTP", () => {
  for (const model of ["gpt-4o", "gpt-5.2"]) {
    it.each([false, true])(
      `aborts ${model} request (streaming=%s) without retrying`,
      async (streaming) => {
        const received = deferred();
        const disconnected = deferred();
        const firstChunk = deferred();
        const chunkTypes: string[] = [];
        let requests = 0;
        const server = createServer((request, response) => {
          requests++;
          request.resume();
          response.on("close", disconnected.resolve);
          received.resolve();
          if (streaming) {
            response.writeHead(200, { "Content-Type": "text/event-stream" });
            const event =
              model === "gpt-4o"
                ? {
                    id: "fixture",
                    choices: [{ index: 0, delta: { content: "READY" }, finish_reason: null }],
                  }
                : { type: "response.output_text.delta", delta: "READY" };
            response.write(`data: ${JSON.stringify(event)}\n\n`);
          }
          // Leave headers or the SSE body pending until the client cancels real fetch.
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Missing local server address");
        const controller = new AbortController();
        let pending: Promise<unknown> | undefined;
        try {
          const provider = new OpenAIProvider();
          await provider.initialize({
            apiKey: "local-fixture-key",
            model,
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            timeout: 2000,
          });
          const messages = [{ role: "user" as const, content: "local cancellation fixture" }];
          const operation = streaming
            ? (async () => {
                for await (const chunk of provider.stream(messages, {
                  signal: controller.signal,
                })) {
                  chunkTypes.push(chunk.type);
                  if (chunk.type === "text") {
                    firstChunk.resolve();
                    controller.abort();
                  }
                }
                return chunkTypes;
              })()
            : provider.chat(messages, { signal: controller.signal });
          pending = operation.then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          expect(
            await Promise.race([
              (streaming ? firstChunk.promise : received.promise).then(() => "received"),
              pending.then(() => "ended"),
            ]),
          ).toBe("received");
          controller.abort();
          const result = (await pending) as { value?: unknown; error?: unknown };
          expect(result.value).toBeUndefined();
          expect(result.error).toBe(controller.signal.reason);
          await disconnected.promise;
          expect(requests).toBe(1);
          expect(chunkTypes).not.toContain("done");
          if (streaming) expect(chunkTypes).toEqual(["text"]);
        } finally {
          controller.abort();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          if (pending) await pending;
        }
      },
      10000,
    );
  }
});
