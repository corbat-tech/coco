import { createServer } from "node:http";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";
import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";

describe("real Gemini SDK cancellation before HTTP dispatch", () => {
  it.each(["before invocation", "immediately after invocation"] as const)(
    "does not send HTTP when aborted %s",
    async (timing) => {
      let requests = 0;
      const server = createServer((request, response) => {
        requests += 1;
        request.resume();
        // An SDK that ignores cancellation receives a valid, immediate response,
        // making the regression fail as a resolved call rather than hang.
        response.writeHead(200, { "content-type": "application/json", connection: "close" });
        response.end(
          JSON.stringify({
            candidates: [
              {
                content: { role: "model", parts: [{ text: "fixture" }] },
                finishReason: "STOP",
                index: 0,
              },
            ],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
            modelVersion: "gemini-2.5-flash",
          }),
        );
      });
      try {
        const listening = once(server, "listening");
        server.listen(0, "127.0.0.1");
        await listening;
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing fixture listener");
        const client = new GoogleGenAI({
          apiKey: "fixture-not-a-real-key",
          vertexai: false,
          httpOptions: {
            baseUrl: `http://127.0.0.1:${address.port}`,
            retryOptions: { attempts: 1 },
            timeout: 2000,
          },
        });
        const controller = new AbortController();
        if (timing === "before invocation") controller.abort();
        const pending = client.models.generateContent({
          model: "gemini-2.5-flash",
          contents: "Fixture request",
          config: { abortSignal: controller.signal },
        });
        // Attach rejection handling before the immediate abort, without yielding
        // to asynchronous SDK header initialization in between.
        const outcome = pending.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        if (timing === "immediately after invocation") controller.abort();
        const result = await outcome;
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.error).toBeInstanceOf(Error);
          expect((result.error as Error).message).toMatch(/abort|cancel/i);
        }
        await setImmediate();
        expect(requests).toBe(0);
      } finally {
        if (server.listening) {
          const closed = once(server, "close");
          server.close();
          server.closeAllConnections();
          await closed;
        }
      }
    },
  );
});
