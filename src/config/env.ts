/**
 * Environment configuration for Corbat-Coco
 * Loads .env file and provides typed access to environment variables
 */

import { config } from "dotenv";

// Load .env file
config();

/**
 * Supported provider types
 */
export type ProviderType = "anthropic" | "openai" | "gemini" | "kimi";

/**
 * Get API key for a provider
 */
export function getApiKey(provider: ProviderType): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env["ANTHROPIC_API_KEY"];
    case "openai":
      return process.env["OPENAI_API_KEY"];
    case "gemini":
      return process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
    case "kimi":
      return process.env["KIMI_API_KEY"] ?? process.env["MOONSHOT_API_KEY"];
    default:
      return undefined;
  }
}

/**
 * Get base URL for a provider (for custom endpoints)
 */
export function getBaseUrl(provider: ProviderType): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env["ANTHROPIC_BASE_URL"];
    case "openai":
      return process.env["OPENAI_BASE_URL"];
    case "kimi":
      return process.env["KIMI_BASE_URL"] ?? "https://api.moonshot.cn/v1";
    default:
      return undefined;
  }
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: ProviderType): string {
  switch (provider) {
    case "anthropic":
      return process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-20250514";
    case "openai":
      return process.env["OPENAI_MODEL"] ?? "gpt-4o";
    case "gemini":
      return process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash";
    case "kimi":
      return process.env["KIMI_MODEL"] ?? "moonshot-v1-8k";
    default:
      return "gpt-4o";
  }
}

/**
 * Get default provider from environment
 */
export function getDefaultProvider(): ProviderType {
  const provider = process.env["COCO_PROVIDER"]?.toLowerCase();
  if (provider && ["anthropic", "openai", "gemini", "kimi"].includes(provider)) {
    return provider as ProviderType;
  }
  return "anthropic";
}

/**
 * Environment configuration object
 */
export const env = {
  provider: getDefaultProvider(),
  getApiKey,
  getBaseUrl,
  getDefaultModel,
} as const;
