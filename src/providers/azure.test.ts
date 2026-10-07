import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureOpenAIProvider } from "./azure.js";
const identity = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    getToken = identity.token;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Azure v1 deployments", () => {
  it("requires HTTPS and a deployment before making requests", async () => {
    const provider = new AzureOpenAIProvider();
    await expect(
      provider.initialize({ baseUrl: "http://azure.test", deployment: "prod" }),
    ).rejects.toThrow(/HTTPS/);
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT", "");
    await expect(provider.initialize({ baseUrl: "https://azure.test" })).rejects.toThrow(
      /DEPLOYMENT/,
    );
  });
  it.each([false, true])(
    "sends deployment identity separately from catalog metadata, Entra=%s",
    async (entra) => {
      identity.token.mockResolvedValue({ token: "fixture-refreshable-token" });
      const fetcher = vi.fn(async () =>
        Response.json({
          id: "response",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK", annotations: [] }],
            },
          ],
          output_text: "OK",
          model: "gpt-6.1-sol",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
      vi.stubGlobal("fetch", fetcher);
      const provider = new AzureOpenAIProvider();
      await provider.initialize({
        baseUrl: "https://azure.test/openai/v1/",
        deployment: "my-production-deployment",
        model: "gpt-6.1-sol",
        ...(entra ? {} : { apiKey: "fixture-api-key" }),
      });
      await provider.chat([{ role: "user", content: "Hi" }], { maxRetries: 0 });
      const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toBe("https://azure.test/openai/v1/responses");
      expect(JSON.parse(init.body as string)).toMatchObject({
        model: "my-production-deployment",
        store: false,
        reasoning: { effort: "medium" },
      });
      expect(provider.getContextWindow()).toBe(1050000);
      if (entra)
        expect(identity.token).toHaveBeenCalledWith("https://cognitiveservices.azure.com/.default");
    },
  );
});
