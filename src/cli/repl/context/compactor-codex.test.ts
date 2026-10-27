import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexProvider } from "../../../providers/codex.js";
import type { Message } from "../../../providers/types.js";
import { ContextCompactor } from "./compactor.js";

vi.mock("../../../auth/index.js", () => ({
  getValidAccessToken: vi.fn(async () => ({ accessToken: "fixture-token" })),
}));

afterEach(() => vi.unstubAllGlobals());

describe("compaction with the real subscription adapter", () => {
  it.each([
    { model: "gpt-6.1-sol", summaryModel: undefined },
    { model: "gpt-6-astra", summaryModel: undefined },
    { model: "gpt-6-luna", summaryModel: undefined },
    { model: "gpt-6-luna", summaryModel: "gpt-6.1-sol" },
    { model: "gpt-6.1-sol", summaryModel: "gpt-6-luna" },
  ])(
    "uses valid default reasoning for $model (summary override: $summaryModel)",
    async ({ model, summaryModel }) => {
      const fetch = vi.fn(async () => {
        const events = [
          { type: "response.created", id: "fixture-summary" },
          { type: "response.output_text.delta", delta: "Files inspected; tests still pending." },
          {
            type: "response.completed",
            response: {
              id: "fixture-summary",
              status: "completed",
              output: [],
              usage: { input_tokens: 100, output_tokens: 20 },
            },
          },
        ];
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
        );
      });
      vi.stubGlobal("fetch", fetch);
      const provider = new CodexProvider();
      await provider.initialize({ model });
      const messages: Message[] = [
        { role: "user", content: "Preserve the public API" },
        { role: "assistant", content: "Older inspection evidence ".repeat(2000) },
        { role: "user", content: "Continue verification" },
        { role: "assistant", content: "Checking tests" },
      ];
      const result = await new ContextCompactor({ preserveLastN: 2 }).compact(messages, provider, {
        summaryModel,
      });
      expect(result.wasCompacted).toBe(true);
      expect(result.messages[0]?.content).toContain("Preserve the public API");
      expect(result.messages.slice(-2)).toEqual(messages.slice(-2));
      expect(fetch).toHaveBeenCalledOnce();
      const request = JSON.parse(
        (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      );
      expect(request.model).toBe(summaryModel ?? model);
      expect(request.reasoning).toEqual({ effort: "medium" });
    },
  );
});
