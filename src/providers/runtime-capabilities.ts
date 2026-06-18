/**
 * Runtime compatibility view derived from the static provider catalog.
 *
 * The catalog records what a model is; this module records how Coco should use it
 * safely at runtime, including endpoint selection and reasoning/tooling limits.
 */

import type { ProviderType } from "./index.js";
import {
  getCatalogModel,
  getProviderCatalogEntry,
  type ModelCatalogEntry,
  type ModelCapability,
  type ModelStatus,
} from "./catalog.js";
import { getThinkingCapability, type ThinkingKind, type ThinkingMode } from "./thinking.js";

export type ProviderEndpointStrategy =
  | "anthropic-messages"
  | "openai-responses"
  | "openai-chat"
  | "gemini-generate-content";

export type ModelCompatibilityStatus = ModelStatus | "unverified";

export interface ProviderRuntimeCapability {
  provider: ProviderType;
  model: string;
  catalogModel?: ModelCatalogEntry;
  status: ModelCompatibilityStatus;
  endpoint: ProviderEndpointStrategy;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  reasoningKinds: ThinkingKind[];
  defaultReasoning: ThinkingMode;
  contextWindow: number;
  maxOutputTokens?: number;
  sourceUrl?: string;
  restrictions: string[];
}

export interface ProviderProbeResult extends ProviderRuntimeCapability {
  available: boolean | "not-checked";
  checkedAt: string;
  error?: string;
}

function hasCapability(model: ModelCatalogEntry | undefined, capability: ModelCapability): boolean {
  return model?.capabilities.includes(capability) ?? false;
}

function selectEndpoint(
  provider: ProviderType,
  model: ModelCatalogEntry | undefined,
): ProviderEndpointStrategy {
  if (hasCapability(model, "anthropic-messages")) return "anthropic-messages";
  if (hasCapability(model, "gemini-generate-content")) return "gemini-generate-content";
  if (provider === "openai" || provider === "codex") {
    if (hasCapability(model, "openai-responses")) return "openai-responses";
  }
  return "openai-chat";
}

function buildRestrictions(
  provider: ProviderType,
  model: string,
  endpoint: ProviderEndpointStrategy,
  supportsReasoning: boolean,
  supportsToolUse: boolean,
): string[] {
  const restrictions: string[] = [];

  if (provider === "copilot" && endpoint === "openai-chat" && supportsToolUse) {
    restrictions.push(
      "Copilot uses an OpenAI-compatible Chat Completions route; Coco omits reasoning_effort on tool calls to avoid upstream 400 errors.",
    );
  }

  if (
    provider !== "openai" &&
    provider !== "codex" &&
    endpoint === "openai-chat" &&
    supportsReasoning
  ) {
    restrictions.push(
      "OpenAI-compatible providers only receive reasoning fields when the provider is explicitly verified.",
    );
  }

  if (!supportsToolUse) {
    restrictions.push("Function tools are not advertised for this model.");
  }

  if (model.toLowerCase().includes("deprecated")) {
    restrictions.push(
      "Model name suggests deprecation; prefer a catalog current/recommended model.",
    );
  }

  return restrictions;
}

export function getProviderRuntimeCapability(
  provider: ProviderType,
  modelId?: string,
): ProviderRuntimeCapability {
  const providerCatalog = getProviderCatalogEntry(provider);
  const model = modelId ?? providerCatalog.defaultModel;
  const catalogModel = getCatalogModel(provider, model);
  const thinking = getThinkingCapability(provider, model);
  const endpoint = selectEndpoint(provider, catalogModel);
  const supportsToolUse = hasCapability(catalogModel, "tool-use");
  const supportsReasoning = thinking.supported;

  return {
    provider,
    model,
    catalogModel,
    status: catalogModel?.status ?? "unverified",
    endpoint,
    supportsStreaming: hasCapability(catalogModel, "streaming"),
    supportsToolUse,
    supportsVision: hasCapability(catalogModel, "vision"),
    supportsReasoning,
    reasoningKinds: thinking.kinds,
    defaultReasoning: thinking.defaultMode,
    contextWindow: catalogModel?.contextWindow ?? 0,
    maxOutputTokens: catalogModel?.maxOutputTokens,
    sourceUrl: catalogModel?.source.url,
    restrictions: buildRestrictions(provider, model, endpoint, supportsReasoning, supportsToolUse),
  };
}

export async function probeProviderRuntimeCapability(
  provider: ProviderType,
  modelId: string | undefined,
  checkAvailability: (() => Promise<boolean>) | undefined,
): Promise<ProviderProbeResult> {
  const capability = getProviderRuntimeCapability(provider, modelId);

  if (!checkAvailability) {
    return {
      ...capability,
      available: "not-checked",
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    return {
      ...capability,
      available: await checkAvailability(),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...capability,
      available: false,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
