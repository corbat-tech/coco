import { getApiKey, getBaseUrl } from "../config/env.js";
import type { ProviderType } from "./provider-types.js";

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
}

/** Aggregator catalogs change independently of their underlying model vendors. */
export async function discoverAggregatorModels(provider: ProviderType): Promise<DiscoveredModel[]> {
  if (provider !== "openrouter" && provider !== "huggingface") return [];
  const baseUrl = getBaseUrl(provider);
  if (!baseUrl) return [];
  const key = getApiKey(provider);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data))
      return [];
    const models = new Map<string, DiscoveredModel>();
    for (const entry of body.data) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id.trim())
        continue;
      if (
        provider === "openrouter" &&
        (!Array.isArray(entry.supported_parameters) ||
          !entry.supported_parameters.includes("tools"))
      )
        continue;
      if (
        Array.isArray(entry.architecture?.output_modalities) &&
        !entry.architecture.output_modalities.includes("text")
      )
        continue;
      models.set(entry.id, {
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : entry.id,
        contextWindow:
          Number.isFinite(entry.context_length) && entry.context_length > 0
            ? entry.context_length
            : undefined,
      });
    }
    return [...models.values()];
  } catch {
    return [];
  }
}
