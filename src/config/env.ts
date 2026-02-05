/**
 * Environment configuration for Corbat-Coco
 * Loads credentials from:
 * 1. ~/.coco/.env (global, secure — API keys live here)
 * 2. Environment variables (highest priority, override everything)
 *
 * API keys are user-level credentials, NOT project-level.
 * They are stored only in ~/.coco/.env to avoid accidental commits.
 *
 * Also persists user preferences for provider/model across sessions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_PATHS } from "./paths.js";

// Load ~/.coco/.env (env vars still take precedence)
loadGlobalCocoEnv();

/**
 * Load global config from ~/.coco/.env
 */
function loadGlobalCocoEnv(): void {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return;

    const globalEnvPath = path.join(home, ".coco", ".env");
    const content = fs.readFileSync(globalEnvPath, "utf-8");

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex);
          const value = trimmed.substring(eqIndex + 1);
          // Only set if not already defined (env vars take precedence)
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    // File doesn't exist or can't be read, that's fine
  }
}

/**
 * Supported provider types
 */
export type ProviderType = "anthropic" | "openai" | "codex" | "gemini" | "kimi" | "lmstudio";

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
    case "lmstudio":
      // LM Studio doesn't require API key, but we use a placeholder to mark it as configured
      return process.env["LMSTUDIO_API_KEY"] ?? "lm-studio";
    case "codex":
      // Codex uses OAuth tokens, not API keys - return undefined to trigger OAuth flow
      return undefined;
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
      return process.env["KIMI_BASE_URL"] ?? "https://api.moonshot.ai/v1";
    case "lmstudio":
      return process.env["LMSTUDIO_BASE_URL"] ?? "http://localhost:1234/v1";
    case "codex":
      return "https://chatgpt.com/backend-api/codex/responses";
    default:
      return undefined;
  }
}

/**
 * Get default model for a provider
 * Updated February 2026 - sync with providers-config.ts
 */
export function getDefaultModel(provider: ProviderType): string {
  switch (provider) {
    case "anthropic":
      return process.env["ANTHROPIC_MODEL"] ?? "claude-opus-4-6-20260115";
    case "openai":
      return process.env["OPENAI_MODEL"] ?? "gpt-5.2-codex";
    case "gemini":
      return process.env["GEMINI_MODEL"] ?? "gemini-3-flash-preview";
    case "kimi":
      return process.env["KIMI_MODEL"] ?? "kimi-k2.5";
    case "lmstudio":
      // LM Studio model is selected in the app, we use a placeholder
      return process.env["LMSTUDIO_MODEL"] ?? "local-model";
    case "codex":
      // Codex via ChatGPT subscription uses different models
      return process.env["CODEX_MODEL"] ?? "gpt-5.2-codex";
    default:
      return "gpt-5.2-codex";
  }
}

/**
 * Get default provider from environment
 */
export function getDefaultProvider(): ProviderType {
  const provider = process.env["COCO_PROVIDER"]?.toLowerCase();
  if (provider && ["anthropic", "openai", "codex", "gemini", "kimi", "lmstudio"].includes(provider)) {
    return provider as ProviderType;
  }
  return "anthropic";
}

/**
 * Authentication method for a provider
 */
export type AuthMethod = "apikey" | "oauth" | "gcloud" | "none";

/**
 * User preferences stored in ~/.coco/config.json
 */
interface UserPreferences {
  /** Last used provider (user-facing: "openai", not "codex") */
  provider?: ProviderType;
  /** Last used model per provider */
  models?: Partial<Record<ProviderType, string>>;
  /** Authentication method per provider */
  authMethods?: Partial<Record<ProviderType, AuthMethod>>;
  /** Updated timestamp */
  updatedAt?: string;
}

/** Cached preferences (loaded once at startup) */
let cachedPreferences: UserPreferences | null = null;

/**
 * Load user preferences from ~/.coco/config.json
 */
export function loadUserPreferences(): UserPreferences {
  if (cachedPreferences) {
    return cachedPreferences;
  }

  try {
    const content = fs.readFileSync(CONFIG_PATHS.config, "utf-8");
    cachedPreferences = JSON.parse(content) as UserPreferences;
    return cachedPreferences;
  } catch {
    cachedPreferences = {};
    return cachedPreferences;
  }
}

/**
 * Save user preferences to ~/.coco/config.json
 */
export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  try {
    // Load existing preferences
    const existing = loadUserPreferences();

    // Merge with new preferences
    const updated: UserPreferences = {
      ...existing,
      ...prefs,
      models: { ...existing.models, ...prefs.models },
      authMethods: { ...existing.authMethods, ...prefs.authMethods },
      updatedAt: new Date().toISOString(),
    };

    // Ensure directory exists
    const dir = path.dirname(CONFIG_PATHS.config);
    await fs.promises.mkdir(dir, { recursive: true });

    // Save to disk
    await fs.promises.writeFile(CONFIG_PATHS.config, JSON.stringify(updated, null, 2), "utf-8");

    // Update cache
    cachedPreferences = updated;
  } catch {
    // Silently fail if we can't save preferences
  }
}

/**
 * Save the current provider and model preference
 */
export async function saveProviderPreference(
  provider: ProviderType,
  model: string,
  authMethod?: AuthMethod,
): Promise<void> {
  const prefs = loadUserPreferences();
  const updates: Partial<UserPreferences> = {
    provider,
    models: { ...prefs.models, [provider]: model },
  };

  if (authMethod) {
    updates.authMethods = { ...prefs.authMethods, [provider]: authMethod };
  }

  await saveUserPreferences(updates);
}

/**
 * Get the authentication method for a provider
 */
export function getAuthMethod(provider: ProviderType): AuthMethod | undefined {
  const prefs = loadUserPreferences();
  return prefs.authMethods?.[provider];
}

/**
 * Clear the authentication method for a provider
 */
export async function clearAuthMethod(provider: ProviderType): Promise<void> {
  const prefs = loadUserPreferences();
  if (prefs.authMethods?.[provider]) {
    const updated = { ...prefs.authMethods };
    delete updated[provider];
    await saveUserPreferences({ authMethods: updated });
  }
}

/**
 * Check if a provider uses OAuth authentication
 */
export function isOAuthProvider(provider: ProviderType): boolean {
  return getAuthMethod(provider) === "oauth";
}

/**
 * Get the internal provider ID to use for creating the actual provider.
 * Maps user-facing provider names to internal implementations.
 * e.g., "openai" with OAuth -> "codex" internally
 */
export function getInternalProviderId(provider: ProviderType): ProviderType {
  // OpenAI with OAuth uses the codex provider internally
  if (provider === "openai" && isOAuthProvider("openai")) {
    return "codex";
  }
  return provider;
}

/**
 * Get the last used provider from preferences (falls back to env/anthropic)
 */
export function getLastUsedProvider(): ProviderType {
  const prefs = loadUserPreferences();
  if (prefs.provider && ["anthropic", "openai", "codex", "gemini", "kimi", "lmstudio"].includes(prefs.provider)) {
    return prefs.provider;
  }
  // Fall back to env variable or default
  const envProvider = process.env["COCO_PROVIDER"]?.toLowerCase();
  if (envProvider && ["anthropic", "openai", "codex", "gemini", "kimi", "lmstudio"].includes(envProvider)) {
    return envProvider as ProviderType;
  }
  return "anthropic";
}

/**
 * Get the last used model for a provider from preferences
 */
export function getLastUsedModel(provider: ProviderType): string | undefined {
  const prefs = loadUserPreferences();
  return prefs.models?.[provider];
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
