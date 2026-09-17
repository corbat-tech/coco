/**
 * REPL Onboarding v2
 *
 * Sistema de configuración inspirado en OpenCode/Crush
 * - Providers flexibles con modelos actualizados
 * - Soporte para modelos personalizados
 * - Mejor manejo de errores
 */

import * as p from "@clack/prompts";
import {
  cancellationCheckpoint,
  withInteractiveCancellation,
} from "../../utils/interactive-cancellation.js";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createProvider, type ProviderType } from "../../providers/index.js";
import type { ReplConfig } from "./types.js";
import { VERSION } from "../../version.js";
import {
  getAllProviders,
  getProviderDefinition,
  getRecommendedModel,
  getConfiguredProviders,
  isProviderConfigured,
  formatModelInfo,
  type ProviderDefinition,
  type ProviderPaymentType,
} from "./providers-config.js";
import {
  runOAuthFlow,
  supportsOAuth,
  isGcloudInstalled,
  inspectADC,
  runGcloudADCLogin,
  runGcloudADCRevoke,
  isOAuthConfigured,
  getOrRefreshOAuthToken,
} from "../../auth/index.js";
import { CONFIG_PATHS } from "../../config/paths.js";
import { getLastUsedModel, saveProviderPreference } from "../../config/env.js";

/**
 * Resultado del onboarding
 */
export interface OnboardingResult {
  authMethod?: "apikey" | "oauth" | "gcloud" | "none";
  type: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
  project?: string;
  location?: string;
}

/**
 * Ejecutar flujo de onboarding completo
 */
async function runOnboardingV2Internal(signal?: AbortSignal): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  console.clear();

  // Paso 1: Detectar providers ya configurados
  const configuredProviders = getConfiguredProviders();

  // Banner de bienvenida - diferente si es primera vez
  if (configuredProviders.length === 0) {
    // Primera vez - mostrar banner compacto con branding morado
    console.log();
    console.log(chalk.magenta("  ╭───────────────────────────────────────────────────────────╮"));
    console.log(
      chalk.magenta("  │ ") +
        chalk.bold.white("🥥 Welcome to CORBAT-COCO") +
        chalk.magenta(` v${VERSION}`.padStart(32)) +
        chalk.magenta(" │"),
    );
    console.log(
      chalk.magenta("  │ ") +
        chalk.dim("The AI Coding Agent That Ships Production Code") +
        chalk.magenta("          │"),
    );
    console.log(chalk.magenta("  ╰───────────────────────────────────────────────────────────╯"));
    console.log();
    console.log(chalk.dim("  🌐 Open source project • corbat.tech"));
    console.log(
      chalk.dim(
        "  💡 Quick start: choose a provider now, then use /provider later to add or switch.",
      ),
    );
    console.log(chalk.dim("     You can run /tutorial inside Coco for a 1-minute guide."));
    console.log();

    // Elegir proveedor directamente (sin lista redundante)
    const providers = getAllProviders();

    const providerChoice = await cancellationCheckpoint(
      p.select({
        signal,
        message: "Choose a provider to get started:",
        options: [
          ...providers.map((prov) => ({
            value: prov.id,
            label: `${prov.emoji} ${prov.name}`,
            hint: `${formatPaymentBadge(prov.paymentType)} ${prov.requiresApiKey === false ? "Free, runs locally" : prov.description}`,
          })),
          {
            value: "help",
            label: "❓ How do I get an API key?",
            hint: "Show provider URLs",
          },
          {
            value: "exit",
            label: "👋 Exit for now",
          },
        ],
      }),
      signal,
    );

    if (p.isCancel(providerChoice) || providerChoice === "exit") {
      p.log.message(chalk.dim("\n👋 No worries! Run `coco` again when you're ready.\n"));
      return null;
    }

    if (providerChoice === "help") {
      await cancellationCheckpoint(showApiKeyHelp(signal), signal);
      return runOnboardingV2(signal); // Volver al inicio
    }

    const selectedProvider = getProviderDefinition(providerChoice as ProviderType);

    // Local providers (LM Studio, Ollama) go to their own setup flow
    if (selectedProvider.id === "lmstudio" || selectedProvider.id === "ollama") {
      return await cancellationCheckpoint(
        setupLocalProvider(selectedProvider.id, undefined, signal),
        signal,
      );
    }

    // Para cloud providers, elegir método de autenticación
    return await cancellationCheckpoint(setupProviderWithAuth(selectedProvider, signal), signal);
  }

  // Ya tiene providers configurados - banner compacto
  console.log();
  console.log(chalk.magenta("  ╭───────────────────────────────────────╮"));
  console.log(
    chalk.magenta("  │ ") +
      chalk.bold.white("🥥 CORBAT-COCO") +
      chalk.magenta(` v${VERSION}`.padStart(22)) +
      chalk.magenta(" │"),
  );
  console.log(chalk.magenta("  ╰───────────────────────────────────────╯"));
  console.log();

  p.log.info(
    `Found ${configuredProviders.length} configured provider(s): ${configuredProviders
      .map((p) => p.emoji + " " + p.name)
      .join(", ")}`,
  );

  const useExisting = await cancellationCheckpoint(
    p.confirm({ signal, message: "Use an existing provider?", initialValue: true }),
    signal,
  );

  if (p.isCancel(useExisting)) return null;

  if (useExisting) {
    const selected = await cancellationCheckpoint(
      selectExistingProvider(configuredProviders, signal),
      signal,
    );
    if (selected) return selected;
  }

  // Configurar nuevo provider
  return await cancellationCheckpoint(setupNewProvider(signal), signal);
}

/**
 * Mostrar ayuda detallada para obtener API keys
 */
async function showApiKeyHelp(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  console.clear();
  console.log(
    chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════╗
║   🔑 How to Get an API Key                               ║
╚══════════════════════════════════════════════════════════╝
`),
  );

  const providers = getAllProviders();

  for (const provider of providers) {
    console.log(chalk.bold(`\n${provider.emoji} ${provider.name}`));
    console.log(chalk.dim(`   ${provider.description}`));
    // Log URL without any query parameters to avoid leaking sensitive info
    try {
      const parsedUrl = new URL(provider.apiKeyUrl);
      parsedUrl.search = "";
      console.log(`   ${chalk.cyan("→")} ${parsedUrl.toString()}`);
    } catch {
      signal?.throwIfAborted();
      console.log(`   ${chalk.cyan("→")} [API keys page]`);
    }
    console.log(chalk.dim(`   Env var: ${provider.envVar}`));
  }

  console.log(chalk.bold("\n\n📝 Quick Setup Options:\n"));
  console.log(chalk.dim("   1. Set environment variable:"));
  console.log(chalk.white('      export ANTHROPIC_API_KEY="sk-ant-..."\n'));
  console.log(chalk.dim("   2. Or let Coco save it for you during setup\n"));

  console.log(chalk.yellow("\n💡 Tip: Anthropic Claude gives the best coding results.\n"));

  await cancellationCheckpoint(
    p.confirm({ signal, message: "Press Enter to continue...", initialValue: true }),
    signal,
  );
}

/**
 * Setup provider with auth method selection (OAuth, gcloud ADC, or API key)
 */
async function setupProviderWithAuth(
  provider: ProviderDefinition,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  // Check available auth methods
  const hasOAuth = supportsOAuth(provider.id);
  const hasGcloudADC = provider.supportsGcloudADC;

  let authMethod: "oauth" | "apikey" | "gcloud" = "apikey";

  // Build auth options based on provider capabilities
  const authOptions: Array<{ value: string; label: string; hint: string }> = [];

  if (hasOAuth) {
    const isGitHubCopilot = provider.id === "copilot";
    authOptions.push({
      value: "oauth",
      label: isGitHubCopilot ? "🐙 Sign in with GitHub account" : "🔐 Sign in with ChatGPT account",
      hint: isGitHubCopilot
        ? "Use your Copilot subscription (recommended)"
        : "Use your Plus/Pro subscription (recommended)",
    });
  }

  if (hasGcloudADC) {
    authOptions.push({
      value: "gcloud",
      label: "☁️ Use gcloud ADC",
      hint: "Authenticate via gcloud CLI (recommended for GCP users)",
    });
  }

  authOptions.push({
    value: "apikey",
    label: "🔑 Use API key",
    hint: `Get one at ${provider.apiKeyUrl}`,
  });

  // Only show selection if there are multiple options
  if (authOptions.length > 1) {
    const choice = await cancellationCheckpoint(
      p.select({
        signal,
        message: `How would you like to authenticate with ${provider.name}?`,
        options: authOptions,
      }),
      signal,
    );

    if (p.isCancel(choice)) return null;
    authMethod = choice as "oauth" | "apikey" | "gcloud";
  }

  if (authMethod === "oauth") {
    // OAuth flow
    const oauthSpinner = p.spinner({ signal });
    oauthSpinner.start("Starting OAuth sign-in flow...");
    const result = await cancellationCheckpoint(runOAuthFlow(provider.id, signal), signal);
    oauthSpinner.stop(result ? "OAuth sign-in completed" : "OAuth sign-in cancelled");
    if (!result) return null;

    if (provider.id === "copilot") {
      // Copilot: select from copilot models directly
      const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
      if (!model) return null;

      return {
        type: "copilot" as ProviderType,
        model,
        apiKey: result.accessToken,
      };
    }

    // When using OAuth for OpenAI, we need to use the "codex" provider
    // because OAuth tokens only work with the Codex API endpoint (chatgpt.com/backend-api)
    // not with the standard OpenAI API (api.openai.com)
    const codexProvider = getProviderDefinition("codex");

    // Select model from codex provider (which has the correct models for OAuth)
    const model = await cancellationCheckpoint(selectModel(codexProvider, signal), signal);
    if (!model) return null;

    return {
      type: "codex" as ProviderType, // Use codex provider for OAuth tokens
      model,
      apiKey: result.accessToken,
    };
  }

  if (authMethod === "gcloud") {
    // gcloud ADC flow
    return await cancellationCheckpoint(setupGcloudADC(provider, signal), signal);
  }

  // API key flow
  showProviderInfo(provider);

  const apiKey = await cancellationCheckpoint(requestApiKey(provider, signal), signal);
  if (!apiKey) return null;
  let vertexSettings: { project: string; location: string } | undefined;
  if (provider.id === "vertex") {
    const settings = await cancellationCheckpoint(promptVertexSettings(signal), signal);
    if (!settings) return null;
    vertexSettings = settings;
  }

  // Ask for custom URL if provider supports it
  let baseUrl: string | undefined;
  if (provider.askForCustomUrl) {
    const wantsCustomUrl = await cancellationCheckpoint(
      p.confirm({
        signal,
        message: `Use default API URL? (${provider.baseUrl})`,
        initialValue: true,
      }),
      signal,
    );

    if (p.isCancel(wantsCustomUrl)) return null;

    if (!wantsCustomUrl) {
      const url = await cancellationCheckpoint(
        p.text({
          signal,
          message: "Enter custom API URL:",
          placeholder: provider.baseUrl,
          validate: (v) => {
            if (!v) return "URL is required";
            if (!v.startsWith("http")) return "Must start with http:// or https://";
            return;
          },
        }),
        signal,
      );

      if (p.isCancel(url)) return null;
      baseUrl = url;
    }
  }

  // Select model
  const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
  if (!model) return null;

  // Test connection
  const valid = await cancellationCheckpoint(
    testConnection(provider, apiKey, model, baseUrl, vertexSettings, signal),
    signal,
  );
  if (!valid) {
    const retry = await cancellationCheckpoint(
      p.confirm({ signal, message: "Would you like to try again?", initialValue: true }),
      signal,
    );

    if (retry && !p.isCancel(retry)) {
      return setupProviderWithAuth(provider, signal);
    }
    return null;
  }

  return {
    type: provider.id,
    model,
    apiKey,
    baseUrl,
    project: vertexSettings?.project,
    location: vertexSettings?.location,
  };
}

/**
 * Setup provider with gcloud Application Default Credentials
 * Reuses existing local ADC and points users to manual setup when needed
 */
async function setupGcloudADC(
  provider: ProviderDefinition,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  console.log();
  console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
  console.log(
    chalk.magenta("   │ ") +
      chalk.bold.white("☁️ Google Cloud ADC Authentication") +
      chalk.magenta("              │"),
  );
  console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
  console.log();

  // Check if gcloud CLI is installed
  const gcloudCheckSpinner = p.spinner({ signal });
  gcloudCheckSpinner.start("Checking gcloud CLI...");
  const gcloudInstalled = await cancellationCheckpoint(isGcloudInstalled(signal), signal);
  gcloudCheckSpinner.stop(gcloudInstalled ? "gcloud CLI detected" : "gcloud CLI not detected");
  if (!gcloudInstalled) {
    p.log.error("gcloud CLI is not installed");
    console.log(chalk.dim("   Install it from: https://cloud.google.com/sdk/docs/install"));
    console.log();

    const useFallback = await cancellationCheckpoint(
      p.confirm({ signal, message: "Use API key instead?", initialValue: true }),
      signal,
    );

    if (p.isCancel(useFallback) || !useFallback) return null;

    // Fall back to API key flow
    showProviderInfo(provider);
    const apiKey = await cancellationCheckpoint(requestApiKey(provider, signal), signal);
    if (!apiKey) return null;

    const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
    if (!model) return null;

    let vertexSettings: { project: string; location: string } | undefined;
    if (provider.id === "vertex") {
      const settings = await cancellationCheckpoint(promptVertexSettings(signal), signal);
      if (!settings) return null;
      vertexSettings = settings;
    }

    const valid = await cancellationCheckpoint(
      testConnection(provider, apiKey, model, undefined, vertexSettings, signal),
      signal,
    );
    if (!valid) return null;

    return {
      type: provider.id,
      model,
      apiKey,
      project: vertexSettings?.project,
      location: vertexSettings?.location,
    };
  }

  const adcInspectSpinner = p.spinner({ signal });
  adcInspectSpinner.start("Checking existing ADC credentials...");
  let adc = await cancellationCheckpoint(inspectADC(signal), signal);
  adcInspectSpinner.stop(
    adc.status === "ok" && adc.token
      ? "ADC credentials found"
      : "No reusable ADC credentials found",
  );

  if (adc.status === "ok" && adc.token) {
    console.log(chalk.green("   ✓ gcloud ADC is already configured!"));
    console.log();
    const adcChoice = await cancellationCheckpoint(
      p.select({
        signal,
        message: "ADC session detected. What do you want to do?",
        options: [
          { value: "use", label: "Use current ADC session" },
          { value: "switch", label: "Switch Google account (revoke and re-login)" },
          { value: "cancel", label: "Cancel" },
        ],
      }),
      signal,
    );
    if (p.isCancel(adcChoice) || adcChoice === "cancel") return null;
    if (adcChoice === "switch") {
      const revokeSpinner = p.spinner({ signal });
      revokeSpinner.start("Revoking current gcloud ADC session...");
      const revoked = await cancellationCheckpoint(runGcloudADCRevoke(signal), signal);
      revokeSpinner.stop(
        revoked ? "Current ADC session revoked" : "Could not revoke current ADC session",
      );
      if (!revoked) {
        p.log.error("Could not revoke gcloud ADC from Coco.");
        console.log(chalk.dim("   Try manually: gcloud auth application-default revoke"));
        console.log();
        return null;
      }
      const loginSpinner = p.spinner({ signal });
      loginSpinner.start("Running `gcloud auth application-default login`...");
      const loginOk = await cancellationCheckpoint(runGcloudADCLogin(signal), signal);
      loginSpinner.stop(loginOk ? "gcloud login flow completed" : "gcloud login flow failed");
      if (!loginOk) return null;
      const recheckSpinner = p.spinner({ signal });
      recheckSpinner.start("Verifying ADC credentials after re-login...");
      adc = await cancellationCheckpoint(inspectADC(signal), signal);
      recheckSpinner.stop(
        adc.status === "ok" && adc.token
          ? "ADC credentials verified"
          : "ADC verification failed after re-login",
      );
      if (!(adc.status === "ok" && adc.token)) return null;
    }
    p.log.success("Authentication verified");

    const vertexSettings =
      provider.id === "vertex"
        ? await cancellationCheckpoint(promptVertexSettings(signal), signal)
        : undefined;
    if (provider.id === "vertex" && !vertexSettings) return null;

    const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
    if (!model) return null;

    return {
      type: provider.id,
      model,
      apiKey: "__gcloud_adc__",
      project: vertexSettings?.project,
      location: vertexSettings?.location,
    };
  }

  console.log(chalk.yellow("   No reusable gcloud ADC session was found for Coco."));
  console.log();
  if (adc.message) {
    console.log(chalk.dim(`   ${adc.message}`));
    console.log();
  }
  const runLoginNow = await cancellationCheckpoint(
    p.confirm({ signal, message: "Authenticate with gcloud now from Coco?", initialValue: true }),
    signal,
  );
  if (p.isCancel(runLoginNow)) return null;

  if (runLoginNow) {
    p.log.step("Running `gcloud auth application-default login`...");
    const loginSpinner = p.spinner({ signal });
    loginSpinner.start("Launching gcloud login flow (browser may open)...");
    const loginOk = await cancellationCheckpoint(runGcloudADCLogin(signal), signal);
    loginSpinner.stop(loginOk ? "gcloud login flow completed" : "gcloud login flow failed");
    if (loginOk) {
      const recheckSpinner = p.spinner({ signal });
      recheckSpinner.start("Verifying ADC credentials after login...");
      adc = await cancellationCheckpoint(inspectADC(signal), signal);
      recheckSpinner.stop(
        adc.status === "ok" && adc.token
          ? "ADC credentials verified"
          : "ADC verification failed after login",
      );
      if (adc.status === "ok" && adc.token) {
        console.log(chalk.green("   ✓ gcloud ADC is now configured."));
        console.log();
        p.log.success("Authentication verified");

        const vertexSettings =
          provider.id === "vertex"
            ? await cancellationCheckpoint(promptVertexSettings(signal), signal)
            : undefined;
        if (provider.id === "vertex" && !vertexSettings) return null;

        const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
        if (!model) return null;

        return {
          type: provider.id,
          model,
          apiKey: "__gcloud_adc__",
          project: vertexSettings?.project,
          location: vertexSettings?.location,
        };
      }
    }

    p.log.error("Could not complete gcloud ADC login from Coco.");
    console.log();
  }

  console.log(chalk.dim("   Check the current machine-wide ADC state with:"));
  console.log(chalk.cyan("   $ gcloud auth application-default print-access-token"));
  console.log();
  console.log(chalk.dim("   If you want to authenticate manually, run in your terminal:"));
  console.log(chalk.cyan("   $ gcloud auth application-default login"));
  console.log();
  if (adc.suggestion) {
    console.log(chalk.dim(`   ${adc.suggestion}`));
    console.log();
  }
  console.log(chalk.dim("   Coco will reuse the login on the next attempt if ADC is valid."));
  console.log();

  const useFallback = await cancellationCheckpoint(
    p.confirm({ signal, message: "Use API key for now?", initialValue: true }),
    signal,
  );

  if (p.isCancel(useFallback) || !useFallback) return null;

  showProviderInfo(provider);
  const apiKey = await cancellationCheckpoint(requestApiKey(provider, signal), signal);
  if (!apiKey) return null;

  const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
  if (!model) return null;

  let vertexSettings: { project: string; location: string } | undefined;
  if (provider.id === "vertex") {
    const settings = await cancellationCheckpoint(promptVertexSettings(signal), signal);
    if (!settings) return null;
    vertexSettings = settings;
  }

  const valid = await cancellationCheckpoint(
    testConnection(provider, apiKey, model, undefined, vertexSettings, signal),
    signal,
  );
  if (!valid) return null;

  return {
    type: provider.id,
    model,
    apiKey,
    project: vertexSettings?.project,
    location: vertexSettings?.location,
  };
}

async function promptVertexSettings(
  signal?: AbortSignal,
): Promise<{ project: string; location: string } | null> {
  signal?.throwIfAborted();
  const projectDefault =
    process.env["VERTEX_PROJECT"] ??
    process.env["GOOGLE_CLOUD_PROJECT"] ??
    process.env["GCLOUD_PROJECT"] ??
    "";
  const locationDefault =
    process.env["VERTEX_LOCATION"] ?? process.env["GOOGLE_CLOUD_LOCATION"] ?? "global";

  console.log(chalk.dim("\n   Need help finding these values?"));
  console.log(chalk.cyan("   $ gcloud projects list"));
  console.log(chalk.cyan("   $ gcloud config set project <PROJECT_ID>"));
  console.log(chalk.cyan("   $ gcloud config get-value project"));
  console.log(chalk.cyan("   $ gcloud config get-value compute/region"));
  console.log(
    chalk.cyan("   $ gcloud config set compute/region <LOCATION>    # e.g. global, europe-west1"),
  );
  console.log(
    chalk.dim(
      "   (If compute/region is unset, set it as above, then use that value for Vertex location)\n",
    ),
  );

  const project = await cancellationCheckpoint(
    p.text({
      signal,
      message: "Google Cloud project ID:",
      placeholder: projectDefault || "my-gcp-project",
      initialValue: projectDefault,
      validate: (v) => (!v?.trim() ? "Project ID is required for Vertex AI" : undefined),
    }),
    signal,
  );
  if (p.isCancel(project)) return null;

  const location = await cancellationCheckpoint(
    p.text({
      signal,
      message: "Vertex AI location:",
      placeholder: locationDefault,
      initialValue: locationDefault,
      validate: (v) => (!v?.trim() ? "Location is required for Vertex AI" : undefined),
    }),
    signal,
  );
  if (p.isCancel(location)) return null;

  return {
    project: project.trim(),
    location: location.trim(),
  };
}

/**
 * Configuration for local providers (LM Studio, Ollama)
 */
const LOCAL_PROVIDER_CONFIG = {
  lmstudio: {
    defaultPort: 1234,
    apiKeyPlaceholder: "lm-studio",
    displayName: "LM Studio",
    setupUrl: "https://lmstudio.ai",
    setupInstructions: [
      "1. Open LM Studio → https://lmstudio.ai",
      "2. Download a model (Discover → Search → Download)",
      "3. Load the model (double-click it)",
      "4. Start server: Menu → Developer → Start Server",
    ],
    noModelInstructions: [
      "Make sure you have a model loaded in LM Studio:",
      "1. In LM Studio: Discover → Search for a model",
      "2. Download it, then double-click to load",
      "3. The model name appears in the top bar of LM Studio",
    ],
    modelPlaceholder: "e.g. qwen2.5-coder-3b-instruct",
    envKeyModel: "LMSTUDIO_MODEL",
    envKeyBaseUrl: "LMSTUDIO_BASE_URL",
    contextLengthFix: [
      "1. Click on the model name in the top bar",
      "2. Find 'Context Length' setting",
      "3. Increase it (recommended: 8192 or higher)",
      "4. Click 'Reload Model'",
    ],
  },
  ollama: {
    defaultPort: 11434,
    apiKeyPlaceholder: "ollama",
    displayName: "Ollama",
    setupUrl: "https://ollama.com",
    setupInstructions: [
      "1. Install Ollama → https://ollama.com",
      "2. Pull a model: ollama pull qwen3:8b",
      "3. Start server: ollama serve (runs on port 11434)",
    ],
    noModelInstructions: [
      "Make sure you have a model available in Ollama:",
      "1. Pull a model: ollama pull qwen3:8b",
      "2. List models: ollama list",
      "3. The model name is in the NAME column",
    ],
    modelPlaceholder: "e.g. qwen3:8b",
    envKeyModel: "OLLAMA_MODEL",
    envKeyBaseUrl: "OLLAMA_BASE_URL",
    contextLengthFix: [
      "1. Check model parameters: ollama show <model>",
      "2. Use a model with larger context (e.g. qwen3:8b supports 128K)",
      "3. Or set context: ollama run <model> /set parameter num_ctx 8192",
    ],
  },
} as const;

type LocalProviderType = keyof typeof LOCAL_PROVIDER_CONFIG;

/**
 * Test local model with a realistic request
 * Uses a longer system prompt to detect context length issues early
 * This must simulate Coco's real system prompt size (~8000+ tokens)
 */
async function testLocalModel(
  port: number,
  model: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  signal?.throwIfAborted();
  // Use a system prompt similar in size to what Coco uses in production
  // Coco uses: COCO_SYSTEM_PROMPT (~500 tokens) + CLAUDE.md content (~2000-6000 tokens)
  // Plus conversation context. Total can easily reach 8000+ tokens.
  const basePrompt = `You are Corbat-Coco, an autonomous coding assistant.

You have access to tools for:
- Reading and writing files (read_file, write_file, edit_file, glob, list_dir)
- Executing bash commands (bash_exec, command_exists)
- Git operations (git_status, git_diff, git_add, git_commit, git_log, git_branch, git_checkout, git_push, git_pull)
- Running tests (run_tests, get_coverage, run_test_file)
- Analyzing code quality (run_linter, analyze_complexity, calculate_quality)

When the user asks you to do something:
1. Understand their intent
2. Use the appropriate tools to accomplish the task
3. Explain what you did concisely

Be helpful and direct. If a task requires multiple steps, execute them one by one.
Always verify your work by reading files after editing or running tests after changes.

# Project Instructions

## Coding Style
- Language: TypeScript with strict mode
- Modules: ESM only (no CommonJS)
- Imports: Use .js extension in imports
- Types: Prefer explicit types, avoid any
- Formatting: oxfmt (similar to prettier)
- Linting: oxlint (fast, minimal config)

## Key Patterns
Use Zod for configuration schemas. Use Commander for CLI. Use Clack for prompts.
`;
  // Repeat to simulate real context size (~8000 tokens)
  const testSystemPrompt = basePrompt.repeat(8);

  try {
    const response = await cancellationCheckpoint(
      fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: testSystemPrompt },
            { role: "user", content: "Say OK if you can read this." },
          ],
          max_tokens: 10,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000), // Longer timeout for slower models
      }),
      signal,
    );

    if (response.ok) {
      return { success: true };
    }

    const errorData = (await cancellationCheckpoint(
      response.json().catch(() => ({})),
      signal,
    )) as { error?: { message?: string } };
    return {
      success: false,
      error: errorData.error?.message || `HTTP ${response.status}`,
    };
  } catch (err) {
    signal?.throwIfAborted();
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/**
 * Show context length error with fix instructions
 */
async function showContextLengthError(
  model: string,
  providerType: LocalProviderType = "lmstudio",
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const cfg = LOCAL_PROVIDER_CONFIG[providerType];
  p.log.message("");
  p.log.message(chalk.red("   ❌ Context length too small"));
  p.log.message("");
  p.log.message(chalk.yellow("   The model's context window is too small for Coco."));
  p.log.message(chalk.yellow(`   To fix this in ${cfg.displayName}:\n`));
  for (const line of cfg.contextLengthFix) {
    p.log.message(chalk.white(`   ${line}`));
  }
  p.log.message("");
  p.log.message(chalk.dim(`   Model: ${model}`));
  p.log.message("");

  await cancellationCheckpoint(
    p.confirm({ signal, message: "Press Enter after reloading the model...", initialValue: true }),
    signal,
  );
}

/**
 * Setup a local provider (LM Studio or Ollama)
 */
async function setupLocalProvider(
  providerType: LocalProviderType,
  port?: number,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  const cfg = LOCAL_PROVIDER_CONFIG[providerType];
  const effectivePort = port ?? cfg.defaultPort;
  const provider = getProviderDefinition(providerType);
  const baseUrl = `http://localhost:${effectivePort}/v1`;

  p.log.step(`${provider.emoji} ${cfg.displayName} (free, local)`);

  // Loop hasta que el servidor esté conectado
  while (true) {
    const spinner = p.spinner({ signal });
    spinner.start(`Checking ${cfg.displayName} server on port ${effectivePort}...`);

    let serverRunning = false;
    try {
      const response = await cancellationCheckpoint(
        fetch(`http://localhost:${effectivePort}/v1/models`, {
          method: "GET",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
            : AbortSignal.timeout(3000),
        }),
        signal,
      );
      serverRunning = response.ok;
    } catch {
      signal?.throwIfAborted();
      // Server not running
    }

    if (serverRunning) {
      spinner.stop(chalk.green(`✅ ${cfg.displayName} server connected!`));

      // Try to get loaded models from local server
      try {
        const modelsResponse = await cancellationCheckpoint(
          fetch(`http://localhost:${effectivePort}/v1/models`, {
            method: "GET",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
              : AbortSignal.timeout(3000),
          }),
          signal,
        );
        if (modelsResponse.ok) {
          const modelsData = (await cancellationCheckpoint(modelsResponse.json(), signal)) as {
            data?: Array<{ id: string }>;
          };
          if (modelsData.data && modelsData.data.length > 0) {
            // Found loaded models - let user choose from them
            const loadedModels = modelsData.data.map((m) => m.id);

            if (loadedModels.length === 1 && loadedModels[0]) {
              // Only one model loaded - use it directly
              const model = loadedModels[0];
              p.log.message(chalk.green(`   📦 Using loaded model: ${model}`));

              // Test the model before returning
              const testSpinner = p.spinner({ signal });
              testSpinner.start(`Testing model ${model}...`);
              const testResult = await cancellationCheckpoint(
                testLocalModel(effectivePort, model, signal),
                signal,
              );
              if (!testResult.success) {
                testSpinner.stop(`Model test failed`);
                if (
                  testResult.error?.includes("context length") ||
                  testResult.error?.includes("tokens to keep")
                ) {
                  await cancellationCheckpoint(
                    showContextLengthError(model, providerType, signal),
                    signal,
                  );
                  return setupLocalProvider(providerType, effectivePort, signal);
                }
                p.log.message(chalk.yellow(`\n   ⚠️  Model test failed: ${testResult.error}\n`));
                return setupLocalProvider(providerType, effectivePort, signal);
              }

              testSpinner.stop(`Model ready!`);

              return {
                type: providerType,
                model,
                apiKey: cfg.apiKeyPlaceholder,
                baseUrl:
                  effectivePort === cfg.defaultPort
                    ? undefined
                    : `http://localhost:${effectivePort}/v1`,
              };
            } else {
              // Multiple models loaded - let user choose
              p.log.message(chalk.green(`   📦 Found ${loadedModels.length} loaded models\n`));

              // Enrich loaded models with descriptions from providers-config
              const providerModels = getProviderDefinition(providerType).models;

              // Show recommended models not yet downloaded as suggestions
              const notDownloaded = providerModels.filter(
                (pm) =>
                  !loadedModels.some(
                    (m) =>
                      m === pm.id ||
                      m.toLowerCase().includes(pm.id.toLowerCase().replace(/:/g, "-")),
                  ),
              );
              if (notDownloaded.length > 0) {
                const suggestions = formatLocalModelSuggestions(notDownloaded, providerType);
                p.log.message(chalk.dim(suggestions));
              }
              const modelChoice = await cancellationCheckpoint(
                p.select({
                  signal,
                  message: "Choose a loaded model:",
                  options: loadedModels.map((m) => {
                    const staticDef = providerModels.find(
                      (pm) =>
                        pm.id === m ||
                        m.toLowerCase().includes(pm.id.toLowerCase().replace(/:/g, "-")),
                    );
                    const hint = staticDef ? ` — ${staticDef.description}` : "";
                    const star = staticDef?.recommended ? "⭐ " : "";
                    return {
                      value: m,
                      label: `${star}${m}${hint}`,
                    };
                  }),
                }),
                signal,
              );

              if (p.isCancel(modelChoice)) return null;

              // Test the selected model
              const testSpinner2 = p.spinner({ signal });
              testSpinner2.start(`Testing model ${modelChoice}...`);
              const testResult = await cancellationCheckpoint(
                testLocalModel(effectivePort, modelChoice, signal),
                signal,
              );
              if (!testResult.success) {
                testSpinner2.stop(`Model test failed`);
                if (
                  testResult.error?.includes("context length") ||
                  testResult.error?.includes("tokens to keep")
                ) {
                  await cancellationCheckpoint(
                    showContextLengthError(modelChoice, undefined, signal),
                    signal,
                  );
                  return setupLocalProvider(providerType, effectivePort, signal);
                }
                p.log.message(chalk.yellow(`\n   ⚠️  Model test failed: ${testResult.error}\n`));
                return setupLocalProvider(providerType, effectivePort, signal);
              }

              testSpinner2.stop(`Model ready!`);

              return {
                type: providerType,
                model: modelChoice,
                apiKey: cfg.apiKeyPlaceholder,
                baseUrl:
                  effectivePort === cfg.defaultPort
                    ? undefined
                    : `http://localhost:${effectivePort}/v1`,
              };
            }
          }
        }
      } catch {
        signal?.throwIfAborted();
        // Could not get models, continue with manual selection
      }

      break;
    }

    spinner.stop(chalk.yellow("⚠️  Server not detected"));
    p.log.message("");
    p.log.message(chalk.yellow(`   To connect ${cfg.displayName}:`));
    for (const line of cfg.setupInstructions) {
      p.log.message(chalk.dim(`   ${line}`));
    }
    p.log.message("");

    const action = await cancellationCheckpoint(
      p.select({
        signal,
        message: `Is ${cfg.displayName} server running on port ${effectivePort}?`,
        options: [
          { value: "retry", label: "🔄 Retry connection", hint: "Check again" },
          { value: "port", label: "🔧 Change port", hint: "Use different port" },
          { value: "exit", label: "👋 Exit", hint: "Come back later" },
        ],
      }),
      signal,
    );

    if (p.isCancel(action) || action === "exit") {
      return null;
    }

    if (action === "port") {
      const newPort = await cancellationCheckpoint(
        p.text({
          signal,
          message: "Port:",
          placeholder: String(cfg.defaultPort),
          validate: (v) => {
            const num = parseInt(v ?? "", 10);
            if (isNaN(num) || num < 1 || num > 65535) return "Invalid port";
            return;
          },
        }),
        signal,
      );
      if (p.isCancel(newPort) || !newPort) return null;
      return setupLocalProvider(providerType, parseInt(newPort, 10), signal);
    }
    // retry: just loop again
  }

  // Server connected but no models detected - need manual selection
  p.log.message("");
  p.log.message(chalk.yellow("   ⚠️  No loaded model detected"));
  for (const line of cfg.noModelInstructions) {
    p.log.message(chalk.dim(`   ${line}`));
  }
  p.log.message("");

  const action = await cancellationCheckpoint(
    p.select({
      signal,
      message: "What would you like to do?",
      options: [
        { value: "retry", label: "🔄 Retry (after loading a model)", hint: "Check again" },
        {
          value: "manual",
          label: "✏️  Enter model name manually",
          hint: "If you know the exact name",
        },
        { value: "exit", label: "👋 Exit", hint: "Come back later" },
      ],
    }),
    signal,
  );

  if (p.isCancel(action) || action === "exit") {
    return null;
  }

  if (action === "retry") {
    return setupLocalProvider(providerType, effectivePort, signal);
  }

  // Manual model entry
  const manualModel = await cancellationCheckpoint(
    p.text({
      signal,
      message: `Enter the model name (exactly as shown in ${cfg.displayName}):`,
      placeholder: cfg.modelPlaceholder,
      validate: (v) => (!v || !v.trim() ? "Model name is required" : undefined),
    }),
    signal,
  );

  if (p.isCancel(manualModel)) return null;

  // Test connection with manual model
  const testSpinner = p.spinner({ signal });
  testSpinner.start("Testing model connection...");

  const valid = await cancellationCheckpoint(
    testConnectionQuiet(
      provider,
      cfg.apiKeyPlaceholder,
      manualModel,
      effectivePort === cfg.defaultPort ? undefined : baseUrl,
      signal,
    ),
    signal,
  );

  if (!valid) {
    testSpinner.stop(chalk.yellow("⚠️  Model not responding"));
    p.log.message(
      chalk.dim(`   The model name might not match what's loaded in ${cfg.displayName}\n`),
    );

    const retry = await cancellationCheckpoint(
      p.confirm({ signal, message: "Try again?", initialValue: true }),
      signal,
    );
    if (retry && !p.isCancel(retry)) {
      return setupLocalProvider(providerType, effectivePort, signal);
    }
    return null;
  }

  testSpinner.stop(chalk.green("✅ Model connected!"));

  return {
    type: providerType,
    model: manualModel,
    apiKey: cfg.apiKeyPlaceholder,
    baseUrl: effectivePort === cfg.defaultPort ? undefined : `http://localhost:${effectivePort}/v1`,
  };
}

/**
 * Format payment type badge for display in provider selection
 * - [API]      → pay per token
 * - [SUB]      → subscription required
 * - [FREE]     → completely free
 * - [FREE/API] → free tier + paid tiers
 */
function formatPaymentBadge(paymentType: ProviderPaymentType): string {
  switch (paymentType) {
    case "api":
      return "[API]";
    case "sub":
      return "[SUB]";
    case "free":
      return "[FREE]";
    case "freemium":
      return "[FREE/API]";
  }
}

/**
 * Format local model suggestions in a readable multi-line block format.
 * Each model gets its own block with name, description, RAM, and install command.
 * No emojis inside the blocks to avoid terminal width issues.
 */
function formatLocalModelSuggestions(
  models: import("./providers-config.js").ModelDefinition[],
  providerType: LocalProviderType,
): string {
  const lines: string[] = ["", "  Recommended models you can install:", ""];

  models.forEach((m, i) => {
    const num = i + 1;
    const label = m.recommended ? `${m.id} (RECOMMENDED)` : m.id;
    const cmd = providerType === "ollama" ? `ollama pull ${m.id}` : `search '${m.id}' in LM Studio`;

    // Extract RAM from description if present (e.g., "... (16GB RAM)")
    const ramMatch = m.description?.match(/\((\d+GB)\s*RAM\)/i);
    const ramInfo = ramMatch ? ramMatch[1] : null;
    const ctxInfo = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K ctx` : null;

    // Clean description: remove RAM part since we show it separately
    const cleanDesc = m.description ? m.description.replace(/\s*\(\d+GB\s*RAM\)/i, "").trim() : "";

    lines.push(`  ${num}. ${label}`);
    if (cleanDesc) lines.push(`     ${cleanDesc}`);
    if (ramInfo || ctxInfo) {
      const meta = [ramInfo ? `RAM: ${ramInfo}` : null, ctxInfo ? `Context: ${ctxInfo}` : null]
        .filter(Boolean)
        .join(" | ");
      lines.push(`     ${meta}`);
    }
    lines.push(`     ${cmd}`);
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Setup LM Studio (convenience wrapper)
 * Exported for use by /provider command
 */
async function setupLMStudioProviderInternal(
  port?: number,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  return setupLocalProvider("lmstudio", port, signal);
}

/**
 * Setup Ollama (convenience wrapper)
 * Exported for use by /provider command
 */
async function setupOllamaProviderInternal(
  port?: number,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  return setupLocalProvider("ollama", port, signal);
}

/**
 * Seleccionar provider existente
 */
async function selectExistingProvider(
  providers: ProviderDefinition[],
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  const options = providers.map((p) => ({
    value: p.id,
    label: `${p.emoji} ${p.name}`,
    hint: "Configured",
  }));

  options.push({ value: "__new__" as ProviderType, label: "➕ Setup new provider", hint: "" });

  const choice = await cancellationCheckpoint(
    p.select({ signal, message: "Select provider:", options }),
    signal,
  );

  if (p.isCancel(choice)) return null;
  if (choice === ("__new__" as ProviderType)) return setupNewProvider(signal);

  const provider = getProviderDefinition(choice as ProviderType);
  const apiKey = process.env[provider.envVar] || "";

  // Seleccionar modelo
  const model = await cancellationCheckpoint(selectModel(provider, signal), signal);
  if (!model) return null;

  // Testear conexión
  const valid = await cancellationCheckpoint(
    testConnection(provider, apiKey, model, undefined, undefined, signal),
    signal,
  );
  if (!valid) return null;

  return {
    type: provider.id,
    model,
    apiKey,
  };
}

/**
 * Configurar nuevo provider (unified flow)
 */
async function setupNewProvider(signal?: AbortSignal): Promise<OnboardingResult | null> {
  signal?.throwIfAborted();
  const providers = getAllProviders();

  const providerChoice = await cancellationCheckpoint(
    p.select({
      signal,
      message: "Choose an AI provider:",
      options: providers.map((prov) => ({
        value: prov.id,
        label: `${prov.emoji} ${prov.name}`,
        hint: prov.requiresApiKey === false ? "Free, local" : prov.description,
      })),
    }),
    signal,
  );

  if (p.isCancel(providerChoice)) return null;

  const provider = getProviderDefinition(providerChoice as ProviderType);

  // Local providers go to their own flow
  if (provider.id === "lmstudio" || provider.id === "ollama") {
    return setupLocalProvider(provider.id, undefined, signal);
  }

  // Cloud providers use auth method selection
  return setupProviderWithAuth(provider, signal);
}

/**
 * Mostrar información del provider (usa p.log para mantener la barra vertical)
 */
function showProviderInfo(provider: ProviderDefinition): void {
  p.log.step(`${provider.emoji} Setting up ${provider.name}`);

  // Solo mostrar link de API key si el provider lo requiere
  if (provider.requiresApiKey !== false) {
    p.log.message(chalk.yellow("🔑 Get your API key here:"));
    p.log.message(chalk.cyan.bold(`   ${provider.apiKeyUrl}`));
  }

  // Features
  if (provider.features) {
    const features = [];
    if (provider.features.streaming) features.push("streaming");
    if (provider.features.functionCalling) features.push("tools");
    if (provider.features.vision) features.push("vision");
    p.log.message(chalk.dim(`✨ Features: ${features.join(", ")}`));
  }

  p.log.message(chalk.dim(`📖 Docs: ${provider.docsUrl}\n`));
}

/**
 * Solicitar API key
 */
async function requestApiKey(
  provider: ProviderDefinition,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  const apiKey = await cancellationCheckpoint(
    p.password({
      signal,
      message: `Enter your ${provider.name} API key:`,
      validate: (value) => {
        if (!value || value.length < 10) {
          return "Please enter a valid API key (min 10 chars)";
        }
        return;
      },
    }),
    signal,
  );

  if (p.isCancel(apiKey)) return null;
  return apiKey;
}

/**
 * Seleccionar modelo
 */
async function selectModel(
  provider: ProviderDefinition,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  p.log.message("");
  p.log.step("Select a model");

  // Opciones de modelos
  const modelOptions = provider.models.map((m) => ({
    value: m.id,
    label: formatModelInfo(m),
  }));

  // Añadir opción de modelo personalizado
  if (provider.supportsCustomModels) {
    const isLocal = provider.id === "lmstudio" || provider.id === "ollama";
    const customLabel = isLocal
      ? "✏️  Enter model name manually"
      : "✏️  Custom model (enter ID manually)";
    modelOptions.push({
      value: "__custom__",
      label: customLabel,
    });
  }

  const choice = await cancellationCheckpoint(
    p.select({ signal, message: "Choose a model:", options: modelOptions }),
    signal,
  );

  if (p.isCancel(choice)) return null;

  // Manejar modelo personalizado
  if (choice === "__custom__") {
    const isLocalProv = provider.id === "lmstudio" || provider.id === "ollama";
    const localCfg = isLocalProv ? LOCAL_PROVIDER_CONFIG[provider.id as LocalProviderType] : null;
    const custom = await cancellationCheckpoint(
      p.text({
        signal,
        message: isLocalProv
          ? `Enter the model name (as shown in ${localCfg!.displayName}):`
          : "Enter model ID:",
        placeholder: localCfg ? localCfg.modelPlaceholder : provider.models[0]?.id || "model-name",
        validate: (v) => (!v || !v.trim() ? "Model name is required" : undefined),
      }),
      signal,
    );

    if (p.isCancel(custom)) return null;
    return custom;
  }

  return choice;
}

/**
 * Testear conexión silenciosamente (sin spinner ni logs)
 */
async function testConnectionQuiet(
  provider: ProviderDefinition,
  apiKey: string,
  model: string,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    process.env[provider.envVar] = apiKey;
    if (baseUrl) {
      process.env[`${provider.id.toUpperCase()}_BASE_URL`] = baseUrl;
    }
    const testProvider = await cancellationCheckpoint(
      createProvider(provider.id, { model }),
      signal,
    );
    return await cancellationCheckpoint(testProvider.isAvailable({ signal }), signal);
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

/**
 * Testear conexión con el provider
 */
async function testConnection(
  provider: ProviderDefinition,
  apiKey: string,
  model: string,
  baseUrl?: string,
  vertexSettings?: { project?: string; location?: string },
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  p.log.message("");
  const spinner = p.spinner({ signal });
  spinner.start(`Testing connection to ${provider.name}...`);

  // Debug info (solo en desarrollo)
  const debug = process.env.DEBUG === "true";
  if (debug) {
    p.log.message(chalk.dim(`\n[Debug] Provider: ${provider.id}`));
    p.log.message(chalk.dim(`[Debug] Model: ${model}`));
    p.log.message(chalk.dim(`[Debug] Base URL: ${baseUrl || provider.baseUrl}`));
    p.log.message(chalk.dim(`[Debug] API Key: ${apiKey.substring(0, 10)}...`));
  }

  try {
    // Set env var temporalmente
    process.env[provider.envVar] = apiKey;
    if (baseUrl) {
      process.env[`${provider.id.toUpperCase()}_BASE_URL`] = baseUrl;
    }
    if (provider.id === "vertex") {
      if (vertexSettings?.project) process.env["VERTEX_PROJECT"] = vertexSettings.project;
      if (vertexSettings?.location) process.env["VERTEX_LOCATION"] = vertexSettings.location;
    }

    const testProvider = await cancellationCheckpoint(
      createProvider(provider.id, {
        model,
        project: vertexSettings?.project,
        location: vertexSettings?.location,
      }),
      signal,
    );

    if (debug) {
      p.log.message(chalk.dim(`[Debug] Provider created: ${testProvider.id}`));
    }

    const available = await cancellationCheckpoint(testProvider.isAvailable({ signal }), signal);

    if (!available) {
      spinner.stop("Connection failed");
      p.log.error(chalk.red(`\n❌ Could not connect to ${provider.name}`));
      p.log.message(chalk.dim("\nPossible causes:"));
      p.log.message(chalk.dim("  • Invalid API key"));
      p.log.message(chalk.dim("  • Invalid model name"));
      p.log.message(chalk.dim("  • Network connectivity issues"));
      p.log.message(chalk.dim("  • Provider service unavailable"));

      // Kimi-specific troubleshooting hints
      if (provider.id === "kimi") {
        p.log.message(chalk.dim("\n🌙 Kimi/Moonshot specific:"));
        p.log.message(
          chalk.dim("  • Get your key from: https://platform.moonshot.cn/console/api-keys"),
        );
        p.log.message(chalk.dim("  • Ensure your account has credits"));
        p.log.message(chalk.dim("  • Try model: moonshot-v1-8k (most compatible)"));
      }

      // Qwen-specific troubleshooting hints
      if (provider.id === "qwen") {
        p.log.message(chalk.dim("\n🟦 Alibaba Qwen specific:"));
        p.log.message(chalk.dim("  • International console: modelstudio.console.alibabacloud.com"));
        p.log.message(chalk.dim("  • International API endpoint: dashscope-intl.aliyuncs.com"));
        p.log.message(chalk.dim("  • China domestic endpoint: dashscope.aliyuncs.com"));
        p.log.message(
          chalk.dim(
            "  • If using China endpoint, set: DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
          ),
        );
        p.log.message(chalk.dim("  • Ensure your account has API access enabled"));
      }

      return false;
    }

    spinner.stop(chalk.green("✅ Connected successfully!"));
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    spinner.stop("Connection failed");
    const errorMsg = error instanceof Error ? error.message : String(error);
    p.log.error(chalk.red(`\n❌ Error: ${errorMsg}`));

    if (debug) {
      if (error instanceof Error && error.stack) {
        p.log.message(chalk.dim(`\n[Debug] Stack: ${error.stack}`));
      }
    }

    return false;
  }
}

/**
 * Guardar configuración
 */
async function saveConfigurationInternal(
  result: OnboardingResult,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  const provider = getProviderDefinition(result.type);
  const isGcloudADC = result.apiKey === "__gcloud_adc__";

  // gcloud ADC doesn't need to save API key - credentials are managed by gcloud
  if (isGcloudADC) {
    p.log.success("✅ Using gcloud ADC (credentials managed by gcloud CLI)");
    p.log.message(
      chalk.dim("   Run `gcloud auth application-default login` to refresh credentials"),
    );
    if (result.type === "vertex" && result.project) {
      await cancellationCheckpoint(
        saveEnvVars(
          CONFIG_PATHS.env,
          {
            VERTEX_PROJECT: result.project,
            VERTEX_LOCATION: result.location ?? "global",
          },
          true,
          signal,
        ),
        signal,
      );
    }
    await cancellationCheckpoint(
      saveProviderPreference(result.type, result.model, {
        project: result.project,
        location: result.location,
        authMethod: result.authMethod,
      }),
      signal,
    );
    return true;
  }

  // Copilot credentials are already saved by the device flow (copilot.json)
  // Just save the provider/model preference to config.json
  if (result.type === "copilot") {
    await cancellationCheckpoint(saveProviderPreference("copilot", result.model), signal);
    p.log.success("✅ GitHub Copilot configured");
    p.log.message(chalk.dim("   Credentials stored in ~/.coco/tokens/copilot.json"));
    return true;
  }

  // API keys are user-level credentials — always saved globally in ~/.coco/.env
  const isLocalProvider = result.type === "lmstudio" || result.type === "ollama";
  const message = isLocalProvider
    ? `Save your ${result.type === "ollama" ? "Ollama" : "LM Studio"} configuration?`
    : result.type === "codex"
      ? "Save your configuration?"
      : "Save your API key?";

  const saveOptions = await cancellationCheckpoint(
    p.select({
      signal,
      message,
      options: [
        {
          value: "global",
          label: "✓ Save to ~/.coco/.env",
          hint: "Recommended — available in all projects",
        },
        {
          value: "session",
          label: "💨 Don't save",
          hint: "You'll need to configure again next time",
        },
      ],
    }),
    signal,
  );

  if (p.isCancel(saveOptions)) return false;

  const envVarsToSave: Record<string, string> = {};

  if (isLocalProvider) {
    // Local providers: save config (no API key)
    const localCfg = LOCAL_PROVIDER_CONFIG[result.type as LocalProviderType];
    envVarsToSave["COCO_PROVIDER"] = result.type;
    envVarsToSave[localCfg.envKeyModel] = result.model;
    if (result.baseUrl) {
      envVarsToSave[localCfg.envKeyBaseUrl] = result.baseUrl;
    }
  } else if (result.type === "codex") {
    // Codex/ChatGPT OAuth: save provider and model (token managed by OAuth flow)
    envVarsToSave["COCO_PROVIDER"] = result.type;
    envVarsToSave["CODEX_MODEL"] = result.model;
  } else {
    // Cloud providers: save API key
    envVarsToSave[provider.envVar] = result.apiKey;
    if (result.baseUrl) {
      envVarsToSave[`${provider.envVar.replace("_API_KEY", "_BASE_URL")}`] = result.baseUrl;
    }
    if (result.type === "vertex" && result.project) {
      envVarsToSave["VERTEX_PROJECT"] = result.project;
      envVarsToSave["VERTEX_LOCATION"] = result.location ?? "global";
    }
  }

  switch (saveOptions) {
    case "global":
      await cancellationCheckpoint(
        saveEnvVars(CONFIG_PATHS.env, envVarsToSave, true, signal),
        signal,
      );
      p.log.success(`✅ Saved to ~/.coco/.env`);
      break;
    case "session":
      // Set env vars for this session only
      for (const [key, value] of Object.entries(envVarsToSave)) {
        process.env[key] = value;
      }
      p.log.message(chalk.dim("\n💨 Configuration active for this session only."));
      break;
  }

  // Always save provider/model preference to config.json for next session
  await cancellationCheckpoint(
    saveProviderPreference(result.type, result.model, {
      project: result.project,
      location: result.location,
      authMethod: result.authMethod,
    }),
    signal,
  );
  return true;
}

/**
 * Guardar variables de entorno en un archivo .env
 */
async function saveEnvVars(
  filePath: string,
  vars: Record<string, string>,
  createDir = false,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  // Crear directorio si es necesario (para ~/.coco/.env)
  if (createDir) {
    const dir = path.dirname(filePath);
    try {
      await cancellationCheckpoint(fs.mkdir(dir, { recursive: true, mode: 0o700 }), signal);
    } catch {
      signal?.throwIfAborted();
      // Ya existe
    }
  }

  // Leer archivo existente
  let existingVars: Record<string, string> = {};
  try {
    const content = await cancellationCheckpoint(fs.readFile(filePath, "utf-8"), signal);
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex);
          const value = trimmed.substring(eqIndex + 1);
          existingVars[key] = value;
        }
      }
    }
  } catch {
    signal?.throwIfAborted();
    // Archivo no existe
  }

  // Merge: nuevas variables sobrescriben las existentes
  const allVars = { ...existingVars, ...vars };

  // Escribir archivo
  const lines = [
    "# Corbat-Coco Configuration",
    "# Auto-generated. Do not share or commit to version control.",
    "",
  ];

  for (const [key, value] of Object.entries(allVars)) {
    lines.push(`${key}=${value}`);
  }

  await cancellationCheckpoint(
    fs.writeFile(filePath, lines.join("\n") + "\n", { mode: 0o600 }),
    signal,
  );
}

/**
 * Handle the case where a saved local provider (Ollama/LM Studio) is unreachable.
 * Shows a Retry / Choose another provider / Exit dialog.
 * Returns: updated ReplConfig on success, null if user chose exit or switch provider.
 *
 * CRITICAL: We NEVER auto-switch to a paid provider without explicit user consent.
 */
async function handleLocalProviderUnavailable(
  providerType: LocalProviderType,
  config: ReplConfig,
  signal?: AbortSignal,
): Promise<ReplConfig | null> {
  signal?.throwIfAborted();
  const cfg = LOCAL_PROVIDER_CONFIG[providerType];
  const displayName = cfg.displayName;

  p.log.message("");
  p.log.warn(chalk.yellow(`  ${displayName} is not running or not reachable.`));
  p.log.message(
    chalk.dim(
      `  URL: ${providerType === "ollama" ? "http://localhost:11434" : "http://localhost:1234"}`,
    ),
  );
  p.log.message("");

  const choice = await cancellationCheckpoint(
    p.select({
      signal,
      message: `What would you like to do?`,
      options: [
        {
          value: "retry",
          label: `Retry connecting to ${displayName}`,
          hint: `Make sure ${displayName} is running`,
        },
        {
          value: "choose",
          label: "Choose a different provider",
          hint: "Opens provider selection",
        },
        {
          value: "exit",
          label: "Exit for now",
        },
      ],
    }),
    signal,
  );

  if (p.isCancel(choice) || choice === "exit") {
    return null;
  }

  if (choice === "retry") {
    // Try to connect again
    try {
      const { createProvider } = await cancellationCheckpoint(
        import("../../providers/index.js"),
        signal,
      );
      const provider = await cancellationCheckpoint(
        createProvider(providerType, {
          model: config.provider.model,
        }),
        signal,
      );
      if (await cancellationCheckpoint(provider.isAvailable({ signal }), signal)) {
        p.log.success(`  Connected to ${displayName}!`);
        return config;
      }
    } catch {
      signal?.throwIfAborted();
      // Still failed
    }
    p.log.error(`  Still can't reach ${displayName}.`);
    p.log.message(chalk.dim(`  Make sure ${displayName} is running, then try again.`));
    return null; // Fall through to onboarding
  }

  // "choose" - fall through to onboarding (returns null to trigger it)
  return null;
}

/**
 * Asegurar configuración antes de iniciar REPL
 *
 * Smart flow:
 * 1. If preferred provider is configured and working → use it
 * 2. If any provider is configured → use it silently (no warnings)
 * 3. If no provider configured → run onboarding
 */
async function ensureConfiguredV2Internal(
  config: ReplConfig,
  signal?: AbortSignal,
): Promise<ReplConfig | null> {
  signal?.throwIfAborted();
  const providers = getAllProviders();
  const hasOpenAIOAuthTokens = await cancellationCheckpoint(
    isOAuthConfigured("openai").catch(() => false),
    signal,
  );

  // 1a. Check if preferred provider uses OAuth (e.g., openai with OAuth)
  // Also handle legacy "codex" provider which always uses OAuth
  // NOTE: Copilot is excluded — it manages its own tokens via CopilotProvider.initialize()
  const preferredWantsOpenAIOAuth =
    config.provider.type === "codex" ||
    (config.provider.type === "openai" &&
      (config.provider.authMethod === "oauth" ||
        (config.provider.authMethod === undefined && hasOpenAIOAuthTokens)));

  if (preferredWantsOpenAIOAuth) {
    // For OpenAI OAuth, check openai tokens (codex maps to openai internally)
    try {
      const tokenResult = await cancellationCheckpoint(
        getOrRefreshOAuthToken("openai", signal),
        signal,
      );
      if (tokenResult) {
        // Set token in env for the session (codex provider reads from here)
        process.env["OPENAI_CODEX_TOKEN"] = tokenResult.accessToken;

        // Use codex provider internally for OAuth
        const provider = await cancellationCheckpoint(
          createProvider("codex", {
            model: config.provider.model,
          }),
          signal,
        );
        if (await cancellationCheckpoint(provider.isAvailable({ signal }), signal)) {
          // Migrate legacy "codex" to "openai" with oauth authMethod
          if (config.provider.type === "codex") {
            const migratedConfig = {
              ...config,
              provider: {
                ...config.provider,
                type: "openai" as ProviderType,
                authMethod: "oauth" as const,
              },
            };
            // Save the migration
            await cancellationCheckpoint(
              saveProviderPreference("openai", config.provider.model || "gpt-4o", {
                authMethod: "oauth",
              }),
              signal,
            );
            return migratedConfig;
          }
          return config;
        }
      }
    } catch {
      signal?.throwIfAborted();
      // OAuth token failed, try other providers
    }
  }

  // 1b. Check if preferred provider (from config) is available
  // For local providers (requiresApiKey: false), don't require an env var —
  // they use a local server that may or may not be running.
  const preferredProviderDef = providers.find((p) => p.id === config.provider.type);
  // Local providers (lmstudio, ollama) don't need API keys — but copilot
  // uses device flow auth, not a local server, so it's not "local"
  const preferredIsLocal =
    preferredProviderDef?.requiresApiKey === false && preferredProviderDef?.id !== "copilot";
  const preferredHasApiKey = preferredProviderDef
    ? !preferredWantsOpenAIOAuth && !!process.env[preferredProviderDef.envVar]
    : false;
  const preferredHasOpenAIOAuth =
    preferredProviderDef?.id === "openai" && preferredWantsOpenAIOAuth;
  const preferredHasCopilotCreds =
    preferredProviderDef?.id === "copilot" && isProviderConfigured("copilot");
  const preferredIsConfigured =
    preferredIsLocal || preferredHasApiKey || preferredHasOpenAIOAuth || preferredHasCopilotCreds;
  // True when the user's preferred provider had credentials at startup.
  // Used to prevent silent fallbacks from overwriting the user's persisted preference.
  const preferredWasConfigured = Boolean(preferredProviderDef && preferredIsConfigured);
  let preferredWasConfiguredButUnavailable = false;
  let preferredUnavailableWasLocal = false;

  if (preferredProviderDef && preferredIsConfigured) {
    try {
      const preferredInternalProviderId =
        preferredProviderDef.id === "openai" && preferredHasOpenAIOAuth
          ? "codex"
          : preferredProviderDef.id;
      const provider = await cancellationCheckpoint(
        createProvider(preferredInternalProviderId, {
          model: config.provider.model,
        }),
        signal,
      );
      if (await cancellationCheckpoint(provider.isAvailable({ signal }), signal)) {
        return config;
      }
    } catch {
      signal?.throwIfAborted();
      // Preferred provider failed
    }

    // Preferred local provider failed to connect — show retry dialog
    if (preferredIsLocal) {
      const retryResult = await cancellationCheckpoint(
        handleLocalProviderUnavailable(
          preferredProviderDef.id as LocalProviderType,
          config,
          signal,
        ),
        signal,
      );
      if (retryResult !== null) return retryResult;
      // User chose to exit or switch provider — fall through to onboarding
    }

    preferredWasConfiguredButUnavailable = true;
    preferredUnavailableWasLocal = preferredIsLocal;
  }

  // 2. Find any configured provider (silently use the first available)
  // Only do this when the preferred provider was not configured.
  // If the preferred provider was configured but failed, avoid silent provider switches.
  // Include local providers (requiresApiKey: false) even without env vars,
  // but copilot requires device flow credentials, not just requiresApiKey === false
  if (!preferredWasConfiguredButUnavailable || !preferredUnavailableWasLocal) {
    const configuredProviders = providers.filter((p) => {
      if (p.id === "copilot") return isProviderConfigured("copilot");
      if (p.id === "openai") {
        return hasOpenAIOAuthTokens || !!process.env[p.envVar];
      }
      return p.requiresApiKey === false || !!process.env[p.envVar];
    });

    for (const prov of configuredProviders) {
      // Already checked using its selected authentication method. Do not silently
      // retry this same provider using a different ambient credential.
      if (
        prov.id === config.provider.type ||
        (prov.id === "openai" && config.provider.type === "codex")
      )
        continue;
      try {
        const rememberedModel = await cancellationCheckpoint(getLastUsedModel(prov.id), signal);
        const recommended = getRecommendedModel(prov.id);
        const model = rememberedModel || recommended?.id || prov.models[0]?.id || "";
        let providerId = prov.id;

        if (prov.id === "openai" && hasOpenAIOAuthTokens && !process.env[prov.envVar]) {
          // OpenAI OAuth path: materialize a fresh token in env so later startup
          // resolves openai -> codex consistently and doesn't demand OPENAI_API_KEY.
          const tokenResult = await cancellationCheckpoint(
            getOrRefreshOAuthToken("openai", signal),
            signal,
          );
          if (!tokenResult) continue;
          process.env["OPENAI_CODEX_TOKEN"] = tokenResult.accessToken;
          providerId = "codex";
        }

        const provider = await cancellationCheckpoint(
          createProvider(providerId, { model }),
          signal,
        );
        if (await cancellationCheckpoint(provider.isAvailable({ signal }), signal)) {
          // Only persist when the preferred provider was never configured.
          // If it was configured but temporarily unavailable (e.g. expired token,
          // network blip), do the in-session switch but keep the disk preference
          // intact so the next startup retries the user's actual choice.
          if (!preferredWasConfigured) {
            await cancellationCheckpoint(saveProviderPreference(prov.id, model), signal);
          }
          // Silently use this provider - no warning needed
          return {
            ...config,
            provider: {
              ...config.provider,
              type: prov.id,
              model,
              authMethod:
                providerId === "codex"
                  ? "oauth"
                  : prov.requiresApiKey === false
                    ? undefined
                    : "apikey",
            },
          };
        }
      } catch {
        signal?.throwIfAborted();
        // This provider also failed, try next
        continue;
      }
    }
  }

  // 2b. Check for OAuth-configured OpenAI (if not already the preferred provider)
  if (
    config.provider.type !== "openai" &&
    config.provider.type !== "codex" &&
    hasOpenAIOAuthTokens &&
    (!preferredWasConfiguredButUnavailable || !preferredUnavailableWasLocal)
  ) {
    try {
      const tokenResult = await cancellationCheckpoint(
        getOrRefreshOAuthToken("openai", signal),
        signal,
      );
      if (tokenResult) {
        process.env["OPENAI_CODEX_TOKEN"] = tokenResult.accessToken;

        const openaiDef = getProviderDefinition("openai");
        const recommended = getRecommendedModel("openai");
        const model = recommended?.id || openaiDef.models[0]?.id || "";

        const provider = await cancellationCheckpoint(createProvider("codex", { model }), signal);
        if (await cancellationCheckpoint(provider.isAvailable({ signal }), signal)) {
          // Same guard as section 2: only persist when preferred was never configured.
          if (!preferredWasConfigured) {
            await cancellationCheckpoint(saveProviderPreference("openai", model), signal);
          }
          return {
            ...config,
            provider: {
              ...config.provider,
              type: "openai",
              model,
              authMethod: "oauth",
            },
          };
        }
      }
    } catch {
      signal?.throwIfAborted();
      // OAuth failed, continue to onboarding
    }
  }

  // 3. No providers configured or all failed → run onboarding
  const result = await cancellationCheckpoint(runOnboardingV2(signal), signal);
  if (!result) return null;

  // Save configuration
  if (!(await cancellationCheckpoint(saveConfiguration(result, signal), signal))) return null;

  return {
    ...config,
    provider: {
      ...config.provider,
      type: result.type,
      model: result.model,
      authMethod: result.authMethod,
    },
  };
}

export async function runOnboardingV2(signal?: AbortSignal): Promise<OnboardingResult | null> {
  return withInteractiveCancellation(signal, (ownedSignal) => runOnboardingV2Internal(ownedSignal));
}

export async function setupLMStudioProvider(
  port?: number,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  return withInteractiveCancellation(signal, (ownedSignal) =>
    setupLMStudioProviderInternal(port, ownedSignal),
  );
}

export async function setupOllamaProvider(
  port?: number,
  signal?: AbortSignal,
): Promise<OnboardingResult | null> {
  return withInteractiveCancellation(signal, (ownedSignal) =>
    setupOllamaProviderInternal(port, ownedSignal),
  );
}

export async function saveConfiguration(
  result: OnboardingResult,
  signal?: AbortSignal,
): Promise<boolean> {
  return withInteractiveCancellation(signal, (ownedSignal) =>
    saveConfigurationInternal(result, ownedSignal),
  );
}

export async function ensureConfiguredV2(
  config: ReplConfig,
  signal?: AbortSignal,
): Promise<ReplConfig | null> {
  return withInteractiveCancellation(signal, (ownedSignal) =>
    ensureConfiguredV2Internal(config, ownedSignal),
  );
}
