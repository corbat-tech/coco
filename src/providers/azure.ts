import OpenAI from "openai";
import { DefaultAzureCredential } from "@azure/identity";
import { OpenAIProvider } from "./openai.js";
import type { ProviderConfig } from "./types.js";
import { ProviderError } from "../utils/errors.js";

/** Azure v1 Responses: model is the customer's deployment name; credentials may refresh. */
export class AzureOpenAIProvider extends OpenAIProvider {
  constructor() {
    super("azure-openai", "Azure OpenAI");
  }

  override async initialize(config: ProviderConfig): Promise<void> {
    const endpoint = config.baseUrl ?? process.env["AZURE_OPENAI_ENDPOINT"];
    if (!endpoint)
      throw new ProviderError("Set AZURE_OPENAI_ENDPOINT to your Azure resource endpoint.", {
        provider: this.id,
      });
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:")
      throw new ProviderError("Azure endpoint must use HTTPS.", { provider: this.id });
    const deployment = config.deployment ?? process.env["AZURE_OPENAI_DEPLOYMENT"];
    if (!deployment)
      throw new ProviderError("Set AZURE_OPENAI_DEPLOYMENT to your model deployment name.", {
        provider: this.id,
      });
    this.config = { ...config, deployment };
    const credential = new DefaultAzureCredential();
    this.client = new OpenAI({
      baseURL: endpoint.replace(/\/$/, "").replace(/\/openai\/v1$/, "") + "/openai/v1",
      apiKey:
        config.apiKey ||
        (async () =>
          (await credential.getToken("https://cognitiveservices.azure.com/.default")).token),
      timeout: config.timeout ?? 120000,
      maxRetries: 0,
      // Keep catalog model identity separate from the deployment used on the wire.
      fetch: async (url, init) => {
        if (typeof init?.body === "string") {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (typeof body.model === "string") body.model = deployment;
          init = { ...init, body: JSON.stringify(body) };
        }
        return fetch(url, init);
      },
    });
  }
}
