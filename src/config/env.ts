/**
 * Environment configuration for Corbat-Coco
 *
 * SECRETS (API keys) - stored in ~/.coco/.env:
 * - API keys are user-level credentials, NOT project-level
 * - They are stored only in ~/.coco/.env to avoid accidental commits
 * - Environment variables override .env values
 *
 * PREFERENCES (provider/model) - stored in ~/.coco/config.json:
 * - Provider and model preferences are stored in the global config
 * - This provides a single source of truth for user preferences
 * - Uses the same system as project configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, saveConfig } from "./loader.js";
import { CONFIG_PATHS } from "./paths.js";
import type { CocoConfig } from "./schema.js";

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
export type ProviderType =
  | "anthropic"
  | "openai"
  | "codex"
  | "copilot"
  | "gemini"
  | "kimi"
  | "kimi-code"
  | "lmstudio"
  | "ollama"
  | "groq"
  | "openrouter"
  | "mistral"
  | "deepseek"
  | "together"
  | "huggingface"
  | "qwen";

const VALID_PROVIDERS: ProviderType[] = [
  "anthropic",
  "openai",
  "codex",
  "copilot",
  "gemini",
  "kimi",
  "kimi-code",
  "lmstudio",
  "ollama",
  "groq",
  "openrouter",
  "mistral",
  "deepseek",
  "together",
  "huggingface",
  "qwen",
];

/**
 * Authentication method types
 */
export type AuthMethod = "apikey" | "oauth" | "gcloud" | "none";

/**
 * Get the internal provider ID (maps aliases to canonical IDs)
 */
export function getInternalProviderId(provider: ProviderType): ProviderType {
  // Map openai to codex when using OAuth (ChatGPT subscription)
  // This ensures the correct provider is used for OAuth authentication
  if (provider === "openai") {
    // Check if OAuth token is configured
    const hasOAuthToken = process.env.OPENAI_CODEX_TOKEN || process.env.OPENAI_ACCESS_TOKEN;
    if (hasOAuthToken) {
      return "codex";
    }
  }
  return provider;
}

/**
 * Check if a provider uses OAuth authentication
 */
export function isOAuthProvider(provider: ProviderType): boolean {
  if (provider === "codex" || provider === "copilot") return true;
  // openai uses OAuth when OPENAI_CODEX_TOKEN is set
  if (provider === "openai" && process.env.OPENAI_CODEX_TOKEN) return true;
  return false;
}

/**
 * Get the authentication method for a provider
 */
export function getAuthMethod(provider: ProviderType): AuthMethod | undefined {
  switch (provider) {
    case "codex":
    case "copilot":
      return "oauth";
    case "openai":
      // OpenAI can use API keys or ChatGPT OAuth tokens
      if (process.env["OPENAI_CODEX_TOKEN"] || process.env["OPENAI_ACCESS_TOKEN"]) {
        return "oauth";
      }
      return "apikey";
    case "lmstudio":
    case "ollama":
      return "none";
    default:
      return "apikey";
  }
}

/**
 * Clear the authentication method for a provider
 * Used when logging out or resetting authentication
 */
export async function clearAuthMethod(provider: ProviderType): Promise<void> {
  // For OAuth providers, clear any stored tokens
  if (isOAuthProvider(provider)) {
    // Token clearing is handled by the auth module
    const { deleteTokens } = await import("../auth/index.js");
    await deleteTokens(provider);
  }
}

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
    case "kimi-code":
      return process.env["KIMI_CODE_API_KEY"];
    case "lmstudio":
      // LM Studio doesn't require API key, but we use a placeholder to mark it as configured
      return process.env["LMSTUDIO_API_KEY"] ?? "lm-studio";
    case "ollama":
      // Ollama doesn't require API key
      return process.env["OLLAMA_API_KEY"] ?? "ollama";
    case "codex":
      // Codex uses OAuth tokens, not API keys - return undefined to trigger OAuth flow
      return undefined;
    case "copilot":
      // Copilot uses GitHub device flow - env vars as optional override
      return process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
    case "groq":
      return process.env["GROQ_API_KEY"];
    case "openrouter":
      return process.env["OPENROUTER_API_KEY"];
    case "mistral":
      return process.env["MISTRAL_API_KEY"];
    case "deepseek":
      return process.env["DEEPSEEK_API_KEY"];
    case "together":
      return process.env["TOGETHER_API_KEY"];
    case "huggingface":
      return process.env["HF_TOKEN"] ?? process.env["HUGGINGFACE_API_KEY"];
    case "qwen":
      return process.env["DASHSCOPE_API_KEY"] ?? process.env["QWEN_API_KEY"];
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
    case "kimi-code":
      // Anthropic SDK appends /v1/messages — do NOT include /v1 here
      return process.env["KIMI_CODE_BASE_URL"] ?? "https://api.kimi.com/coding";
    case "lmstudio":
      return process.env["LMSTUDIO_BASE_URL"] ?? "http://localhost:1234/v1";
    case "ollama":
      return process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1";
    case "codex":
      return "https://chatgpt.com/backend-api/codex/responses";
    case "copilot":
      return process.env["COPILOT_BASE_URL"] ?? "https://api.githubcopilot.com";
    case "groq":
      return process.env["GROQ_BASE_URL"] ?? "https://api.groq.com/openai/v1";
    case "openrouter":
      return process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";
    case "mistral":
      return process.env["MISTRAL_BASE_URL"] ?? "https://api.mistral.ai/v1";
    case "deepseek":
      return process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com/v1";
    case "together":
      return process.env["TOGETHER_BASE_URL"] ?? "https://api.together.xyz/v1";
    case "huggingface":
      return process.env["HF_BASE_URL"] ?? "https://api-inference.huggingface.co/v1";
    case "qwen":
      // Default: international endpoint (modelstudio.console.alibabacloud.com)
      // China domestic users override with: DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
      return (
        process.env["DASHSCOPE_BASE_URL"] ??
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
      );
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
      return process.env["ANTHROPIC_MODEL"] ?? "claude-opus-4-6";
    case "openai":
      return process.env["OPENAI_MODEL"] ?? "gpt-5.4-codex";
    case "gemini":
      return process.env["GEMINI_MODEL"] ?? "gemini-3.1-pro-preview";
    case "kimi":
      return process.env["KIMI_MODEL"] ?? "kimi-k2.5";
    case "kimi-code":
      return process.env["KIMI_CODE_MODEL"] ?? "kimi-for-coding";
    case "lmstudio":
      // LM Studio model is selected in the app, we use a placeholder
      return process.env["LMSTUDIO_MODEL"] ?? "local-model";
    case "ollama":
      return process.env["OLLAMA_MODEL"] ?? "llama3.2";
    case "codex":
      return process.env["CODEX_MODEL"] ?? "codex-mini-latest";
    case "copilot":
      return process.env["COPILOT_MODEL"] ?? "claude-sonnet-4.6";
    case "groq":
      return process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile";
    case "openrouter":
      return process.env["OPENROUTER_MODEL"] ?? "anthropic/claude-3.5-sonnet";
    case "mistral":
      return process.env["MISTRAL_MODEL"] ?? "mistral-large-latest";
    case "deepseek":
      return process.env["DEEPSEEK_MODEL"] ?? "deepseek-chat";
    case "together":
      return process.env["TOGETHER_MODEL"] ?? "meta-llama/Llama-3.3-70B-Instruct-Turbo";
    case "huggingface":
      return process.env["HF_MODEL"] ?? "meta-llama/Llama-3.1-70B-Instruct";
    case "qwen":
      return process.env["QWEN_MODEL"] ?? "qwen-max";
    default:
      return "claude-sonnet-4-6";
  }
}

function normalizeConfiguredModel(model: string | undefined): string | undefined {
  if (typeof model !== "string") return undefined;
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Get the default provider from environment or fallback
 */
export function getDefaultProvider(): ProviderType {
  const envProvider = process.env["COCO_PROVIDER"]?.toLowerCase();
  if (envProvider && VALID_PROVIDERS.includes(envProvider as ProviderType)) {
    return envProvider as ProviderType;
  }
  return "anthropic";
}

// ============================================================================
// USER PREFERENCES - Stored in global config (~/.coco/config.json)
// ============================================================================

/**
 * Get the last used provider from global config
 * Priority: global config > env var > default
 */
export async function getLastUsedProvider(): Promise<ProviderType> {
  try {
    // Read global preferences only (do not let project config override user defaults)
    const config = await loadConfig(CONFIG_PATHS.config);
    const provider = config.provider.type;
    if (VALID_PROVIDERS.includes(provider as ProviderType)) {
      return provider as ProviderType;
    }
  } catch {
    // Fall through to env/default
  }
  return getDefaultProvider();
}

/**
 * Get the last used model for a provider from global config
 */
export async function getLastUsedModel(provider: ProviderType): Promise<string | undefined> {
  try {
    // Read global preferences only (do not let project config override user defaults)
    const config = await loadConfig(CONFIG_PATHS.config);
    const perProviderModel = normalizeConfiguredModel(config.providerModels?.[provider]);
    if (perProviderModel) {
      return perProviderModel;
    }
    // If the current provider matches, return its model
    if (config.provider.type === provider) {
      return normalizeConfiguredModel(config.provider.model);
    }
  } catch {
    // Fall through to default
  }
  return undefined;
}

/**
 * Save provider and model preference to global config
 * This is the single source of truth for user preferences
 */
export async function saveProviderPreference(
  provider: ProviderType,
  model?: string,
): Promise<void> {
  // Load current global config
  let config: CocoConfig;
  try {
    // Load global config only to avoid merging any project-level provider values
    config = await loadConfig(CONFIG_PATHS.config);
  } catch {
    // If no config exists, create a minimal one
    config = {
      project: { name: "global", version: "0.1.0" },
      provider: {
        type: "anthropic",
        model: "claude-sonnet-4-6",
        maxTokens: 8192,
        temperature: 0,
        timeout: 120000,
      },
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minIterations: 2,
        convergenceThreshold: 2,
        securityThreshold: 100,
      },
      persistence: {
        checkpointInterval: 300000,
        maxCheckpoints: 50,
        retentionDays: 7,
        compressOldCheckpoints: true,
      },
    };
  }

  // Update provider and model
  config.provider.type = provider;
  const normalizedModel = normalizeConfiguredModel(model);
  const persistedModel = normalizedModel ?? getDefaultModel(provider);
  config.providerModels = {
    ...config.providerModels,
    [provider]: persistedModel,
  };
  if (normalizedModel) {
    config.provider.model = normalizedModel;
  } else {
    config.provider.model = getDefaultModel(provider);
  }

  // Save to global config
  await saveConfig(config, undefined, true);

  // Also update COCO_PROVIDER in .env for backward compatibility
  // but only if it exists (don't create it for new setups)
  await updateEnvProvider(provider);
}

/**
 * Update COCO_PROVIDER in .env file if it exists
 * This maintains backward compatibility with external tools
 */
async function updateEnvProvider(provider: ProviderType): Promise<void> {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return;

    const envPath = path.join(home, ".coco", ".env");
    let content: string;

    try {
      content = await fs.promises.readFile(envPath, "utf-8");
    } catch {
      // File doesn't exist, don't create it
      return;
    }

    // Check if COCO_PROVIDER is already set
    const lines = content.split("\n");
    let found = false;
    const newLines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("COCO_PROVIDER=")) {
        found = true;
        return `COCO_PROVIDER=${provider}`;
      }
      return line;
    });

    if (found) {
      await fs.promises.writeFile(envPath, newLines.join("\n"), "utf-8");
    }
    // If not found, don't add it (preferences are now in config.json)
  } catch {
    // Ignore errors
  }
}

/**
 * Remove COCO_PROVIDER from .env file
 * Call this once to migrate from old preferences system
 */
export async function removeEnvProvider(): Promise<void> {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return;

    const envPath = path.join(home, ".coco", ".env");
    let content: string;

    try {
      content = await fs.promises.readFile(envPath, "utf-8");
    } catch {
      return;
    }

    // Remove COCO_PROVIDER line
    const lines = content.split("\n");
    const newLines = lines.filter((line) => !line.trim().startsWith("COCO_PROVIDER="));

    if (newLines.length !== lines.length) {
      await fs.promises.writeFile(envPath, newLines.join("\n"), "utf-8");
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Migrate old preferences.json to global config.json
 * This is called once on startup to migrate from the old system
 */
export async function migrateOldPreferences(): Promise<void> {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return;

    const oldPrefsPath = path.join(home, ".coco", "preferences.json");

    // Check if old preferences exist
    let oldPrefs: { provider?: string; models?: Record<string, string> } | null = null;
    try {
      const content = await fs.promises.readFile(oldPrefsPath, "utf-8");
      oldPrefs = JSON.parse(content);
    } catch {
      // No old preferences, nothing to migrate
      return;
    }

    if (!oldPrefs) return;

    // Load current global config
    let config: CocoConfig;
    try {
      config = await loadConfig();
    } catch {
      // Create default config if none exists
      config = {
        project: { name: "global", version: "0.1.0" },
        provider: {
          type: "anthropic",
          model: "claude-sonnet-4-6",
          maxTokens: 8192,
          temperature: 0,
          timeout: 120000,
        },
        quality: {
          minScore: 85,
          minCoverage: 80,
          maxIterations: 10,
          minIterations: 2,
          convergenceThreshold: 2,
          securityThreshold: 100,
        },
        persistence: {
          checkpointInterval: 300000,
          maxCheckpoints: 50,
          retentionDays: 7,
          compressOldCheckpoints: true,
        },
      };
    }

    // Migrate provider preference
    if (oldPrefs.provider && VALID_PROVIDERS.includes(oldPrefs.provider as ProviderType)) {
      config.provider.type = oldPrefs.provider as ProviderType;
      config.providerModels = {
        ...config.providerModels,
      };

      for (const [providerName, modelName] of Object.entries(oldPrefs.models ?? {})) {
        if (VALID_PROVIDERS.includes(providerName as ProviderType)) {
          const normalized = normalizeConfiguredModel(modelName);
          if (normalized) {
            config.providerModels[providerName] = normalized;
          }
        }
      }

      // Migrate model preference for this provider
      const modelForProvider = oldPrefs.provider ? oldPrefs.models?.[oldPrefs.provider] : undefined;
      const normalizedMigratedModel = normalizeConfiguredModel(modelForProvider);
      if (normalizedMigratedModel) {
        config.provider.model = normalizedMigratedModel;
        config.providerModels[oldPrefs.provider] = normalizedMigratedModel;
      } else {
        config.provider.model = getDefaultModel(oldPrefs.provider as ProviderType);
        config.providerModels[oldPrefs.provider] = config.provider.model;
      }

      // Save to global config
      await saveConfig(config, undefined, true);
    }

    // Delete old preferences file
    try {
      await fs.promises.unlink(oldPrefsPath);
    } catch {
      // Ignore errors
    }
  } catch {
    // Ignore migration errors
  }
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
