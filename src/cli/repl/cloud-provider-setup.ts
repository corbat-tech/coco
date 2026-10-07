import * as p from "@clack/prompts";
import { getCatalogDefaultModel, getProviderCatalogEntry } from "../../providers/catalog.js";
import { createProvider } from "../../providers/index.js";
import { getApiKey, getBaseUrl } from "../../config/env.js";
import type { ProviderConfig } from "../../providers/types.js";

/** Azure and AWS authenticate through credential chains as well as API keys. */
export async function setupCloudProvider(type: "azure-openai" | "bedrock", signal?: AbortSignal) {
  const config: ProviderConfig = {};
  async function field(message: string, initialValue?: string) {
    const value = await p.text({
      message,
      initialValue,
      signal,
      validate: (text) => (text?.trim() ? undefined : "Required"),
    });
    return p.isCancel(value) ? undefined : value.trim();
  }
  if (type === "azure-openai") {
    config.baseUrl = await field("Azure resource endpoint (HTTPS)", getBaseUrl(type));
    if (!config.baseUrl) return null;
    config.deployment = await field(
      "Azure model deployment name",
      process.env["AZURE_OPENAI_DEPLOYMENT"],
    );
    if (!config.deployment) return null;
  } else {
    config.region = await field(
      "AWS region",
      process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"],
    );
    if (!config.region) return null;
    config.awsProfile = process.env["AWS_PROFILE"];
  }
  const credential = await p.select({
    message: "Authentication",
    signal,
    options: [
      {
        value: "chain",
        label:
          type === "bedrock"
            ? "AWS credential chain (profile, SSO, role)"
            : "Microsoft Entra identity",
      },
      { value: "key", label: type === "bedrock" ? "Bedrock API token" : "Azure API key" },
    ],
  });
  if (p.isCancel(credential)) return null;
  if (credential === "key") {
    config.apiKey = getApiKey(type);
    if (!config.apiKey) {
      const key = await p.password({
        message: "API credential",
        signal,
        validate: (text) => (text?.trim() ? undefined : "Required"),
      });
      if (p.isCancel(key)) return null;
      config.apiKey = key.trim();
    }
  }
  const model = await p.select({
    message: "Model deployed in your account",
    signal,
    initialValue: getCatalogDefaultModel(type),
    options: getProviderCatalogEntry(type).models.map((m) => ({ value: m.id, label: m.name })),
  });
  if (p.isCancel(model)) return null;
  config.model = model;
  config.cloudAuth = credential === "chain" ? "identity" : "api-key";
  const instance = await createProvider(type, {
    ...config,
    apiKey: credential === "chain" ? "" : config.apiKey,
  });
  if (!(await instance.isAvailable({ signal })))
    throw new Error(
      `The selected ${type} deployment/model is unavailable. Check credentials, region and account access.`,
    );
  return {
    type,
    model,
    apiKey: config.apiKey ?? "",
    authMethod: "none" as const,
    ...config,
    cloudAuth: credential === "chain" ? ("identity" as const) : ("api-key" as const),
    instance,
  };
}
