import { createProvider as createLLMProvider, type ProviderType } from "../providers/index.js";
import type { LLMProvider, ProviderConfig } from "../providers/types.js";
import {
  getCatalogDefaultModel,
  getCatalogModel,
  getCatalogRecommendedModel,
  getProviderCatalogEntry,
  PROVIDER_CATALOG,
  type ModelCatalogEntry,
  type ProviderCatalogEntry,
} from "../providers/catalog.js";
import {
  getProviderRuntimeCapability,
  probeProviderRuntimeCapability,
  type ProviderProbeResult,
  type ProviderRuntimeCapability,
} from "../providers/runtime-capabilities.js";

/** Catalog-backed provider/model registry used by runtime consumers. */
export class ProviderRegistry {
  listProviders(): ProviderCatalogEntry[] {
    return Object.values(PROVIDER_CATALOG);
  }

  getProvider(provider: ProviderType): ProviderCatalogEntry {
    return getProviderCatalogEntry(provider);
  }

  listModels(provider: ProviderType): ModelCatalogEntry[] {
    return this.getProvider(provider).models;
  }

  getModel(provider: ProviderType, model: string): ModelCatalogEntry | undefined {
    return getCatalogModel(provider, model);
  }

  getDefaultModel(provider: ProviderType): string {
    return getCatalogDefaultModel(provider);
  }

  getRecommendedModel(provider: ProviderType): ModelCatalogEntry {
    return getCatalogRecommendedModel(provider);
  }

  getCapability(provider: ProviderType, model?: string): ProviderRuntimeCapability {
    return getProviderRuntimeCapability(provider, model);
  }

  async createProvider(provider: ProviderType, config: ProviderConfig = {}): Promise<LLMProvider> {
    return createLLMProvider(provider, config);
  }

  async probe(
    provider: ProviderType,
    model: string | undefined,
    checkAvailability?: () => Promise<boolean>,
  ): Promise<ProviderProbeResult> {
    return probeProviderRuntimeCapability(provider, model, checkAvailability);
  }
}

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}
