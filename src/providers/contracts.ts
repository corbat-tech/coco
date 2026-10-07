import { getCatalogModel } from "./catalog.js";
import type { ProviderType } from "./provider-types.js";
import type { ThinkingMode } from "./thinking.js";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/** Only send parameters supported by this serving platform/model pair. */
export function catalogEffort(
  provider: string,
  model: string,
  mode?: ThinkingMode,
): ReasoningEffort | undefined {
  const profile = getCatalogModel(provider as ProviderType, model)?.reasoning;
  if (!profile || profile.kind !== "effort") return undefined;
  let effective = mode ?? profile.defaultMode;
  if (typeof effective === "object")
    effective = effective.budget <= 2048 ? "low" : effective.budget <= 8000 ? "medium" : "high";
  if (effective === "auto") effective = profile.defaultMode;
  if (effective === "off") {
    if (profile.mandatory)
      throw new Error(
        `${provider}/${model} requires reasoning; select one of ${profile.levels.join(", ")}.`,
      );
    return "none";
  }
  if (effective === "auto") return undefined;
  if (!profile.levels.includes(effective))
    throw new Error(`Unsupported reasoning level '${effective}' for ${provider}/${model}.`);
  return effective as ReasoningEffort;
}

export function responseEndpoint(provider: string, model: string): boolean {
  return (
    getCatalogModel(provider as ProviderType, model)?.capabilities.includes("openai-responses") ??
    false
  );
}
