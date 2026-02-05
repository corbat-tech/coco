/**
 * REPL Onboarding v2
 *
 * Sistema de configuración inspirado en OpenCode/Crush
 * - Providers flexibles con modelos actualizados
 * - Soporte para modelos personalizados
 * - Mejor manejo de errores
 */

import * as p from "@clack/prompts";
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
  formatModelInfo,
  type ProviderDefinition,
} from "./providers-config.js";
import { runOAuthFlow, supportsOAuth, isADCConfigured, isGcloudInstalled, getADCAccessToken, isOAuthConfigured, getOrRefreshOAuthToken } from "../../auth/index.js";
import { CONFIG_PATHS } from "../../config/paths.js";
import { saveProviderPreference, getAuthMethod, type AuthMethod } from "../../config/env.js";

/**
 * Resultado del onboarding
 */
export interface OnboardingResult {
  type: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Ejecutar flujo de onboarding completo
 */
export async function runOnboardingV2(): Promise<OnboardingResult | null> {
  console.clear();

  // Paso 1: Detectar providers ya configurados
  const configuredProviders = getConfiguredProviders();

  // Banner de bienvenida - diferente si es primera vez
  if (configuredProviders.length === 0) {
    // Primera vez - mostrar banner compacto con branding morado
    console.log();
    console.log(chalk.magenta("  ╭───────────────────────────────────────────────────────────╮"));
    console.log(chalk.magenta("  │ ") + chalk.bold.white("🥥 Welcome to CORBAT-COCO") + chalk.magenta(` v${VERSION}`.padStart(32)) + chalk.magenta(" │"));
    console.log(chalk.magenta("  │ ") + chalk.dim("The AI Coding Agent That Ships Production Code") + chalk.magenta("          │"));
    console.log(chalk.magenta("  ╰───────────────────────────────────────────────────────────╯"));
    console.log();
    console.log(chalk.dim("  🌐 Open source project • corbat.tech"));
    console.log();

    // Elegir proveedor directamente (sin lista redundante)
    const providers = getAllProviders();

    const providerChoice = await p.select({
      message: "Choose a provider to get started:",
      options: [
        ...providers.map((prov) => ({
          value: prov.id,
          label: `${prov.emoji} ${prov.name}`,
          hint: prov.requiresApiKey === false ? "Free, runs locally" : prov.description,
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
    });

    if (p.isCancel(providerChoice) || providerChoice === "exit") {
      p.log.message(chalk.dim("\n👋 No worries! Run `coco` again when you're ready.\n"));
      return null;
    }

    if (providerChoice === "help") {
      await showApiKeyHelp();
      return runOnboardingV2(); // Volver al inicio
    }

    const selectedProvider = getProviderDefinition(providerChoice as ProviderType);

    // Si es LM Studio, ir directo al setup local
    if (selectedProvider.requiresApiKey === false) {
      return await setupLMStudioProvider();
    }

    // Para cloud providers, elegir método de autenticación
    return await setupProviderWithAuth(selectedProvider);
  }

  // Ya tiene providers configurados - banner compacto
  console.log();
  console.log(chalk.magenta("  ╭───────────────────────────────────────╮"));
  console.log(chalk.magenta("  │ ") + chalk.bold.white("🥥 CORBAT-COCO") + chalk.magenta(` v${VERSION}`.padStart(22)) + chalk.magenta(" │"));
  console.log(chalk.magenta("  ╰───────────────────────────────────────╯"));
  console.log();

  p.log.info(
    `Found ${configuredProviders.length} configured provider(s): ${configuredProviders
      .map((p) => p.emoji + " " + p.name)
      .join(", ")}`,
  );

  const useExisting = await p.confirm({
    message: "Use an existing provider?",
    initialValue: true,
  });

  if (p.isCancel(useExisting)) return null;

  if (useExisting) {
    const selected = await selectExistingProvider(configuredProviders);
    if (selected) return selected;
  }

  // Configurar nuevo provider
  return await setupNewProvider();
}

/**
 * Mostrar ayuda detallada para obtener API keys
 */
async function showApiKeyHelp(): Promise<void> {
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
    console.log(`   ${chalk.cyan("→")} ${provider.apiKeyUrl}`);
    console.log(chalk.dim(`   Env var: ${provider.envVar}`));
  }

  console.log(chalk.bold("\n\n📝 Quick Setup Options:\n"));
  console.log(chalk.dim("   1. Set environment variable:"));
  console.log(chalk.white("      export ANTHROPIC_API_KEY=\"sk-ant-...\"\n"));
  console.log(chalk.dim("   2. Or let Coco save it for you during setup\n"));

  console.log(chalk.yellow("\n💡 Tip: Anthropic Claude gives the best coding results.\n"));

  await p.confirm({
    message: "Press Enter to continue...",
    initialValue: true,
  });
}

/**
 * Setup provider with auth method selection (OAuth, gcloud ADC, or API key)
 */
async function setupProviderWithAuth(provider: ProviderDefinition): Promise<OnboardingResult | null> {
  // Check available auth methods
  const hasOAuth = supportsOAuth(provider.id);
  const hasGcloudADC = provider.supportsGcloudADC;

  let authMethod: "oauth" | "apikey" | "gcloud" = "apikey";

  // Build auth options based on provider capabilities
  const authOptions: Array<{ value: string; label: string; hint: string }> = [];

  if (hasOAuth) {
    authOptions.push({
      value: "oauth",
      label: "🔐 Sign in with ChatGPT account",
      hint: "Use your Plus/Pro subscription (recommended)",
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
    const choice = await p.select({
      message: `How would you like to authenticate with ${provider.name}?`,
      options: authOptions,
    });

    if (p.isCancel(choice)) return null;
    authMethod = choice as "oauth" | "apikey" | "gcloud";
  }

  if (authMethod === "oauth") {
    // OAuth flow
    const result = await runOAuthFlow(provider.id);
    if (!result) return null;

    // When using OAuth for OpenAI, we need to use the "codex" provider
    // because OAuth tokens only work with the Codex API endpoint (chatgpt.com/backend-api)
    // not with the standard OpenAI API (api.openai.com)
    const codexProvider = getProviderDefinition("codex");

    // Select model from codex provider (which has the correct models for OAuth)
    const model = await selectModel(codexProvider);
    if (!model) return null;

    return {
      type: "codex" as ProviderType, // Use codex provider for OAuth tokens
      model,
      apiKey: result.accessToken,
    };
  }

  if (authMethod === "gcloud") {
    // gcloud ADC flow
    return await setupGcloudADC(provider);
  }

  // API key flow
  showProviderInfo(provider);

  const apiKey = await requestApiKey(provider);
  if (!apiKey) return null;

  // Ask for custom URL if provider supports it
  let baseUrl: string | undefined;
  if (provider.askForCustomUrl) {
    const wantsCustomUrl = await p.confirm({
      message: `Use default API URL? (${provider.baseUrl})`,
      initialValue: true,
    });

    if (p.isCancel(wantsCustomUrl)) return null;

    if (!wantsCustomUrl) {
      const url = await p.text({
        message: "Enter custom API URL:",
        placeholder: provider.baseUrl,
        validate: (v) => {
          if (!v) return "URL is required";
          if (!v.startsWith("http")) return "Must start with http:// or https://";
          return;
        },
      });

      if (p.isCancel(url)) return null;
      baseUrl = url;
    }
  }

  // Select model
  const model = await selectModel(provider);
  if (!model) return null;

  // Test connection
  const valid = await testConnection(provider, apiKey, model, baseUrl);
  if (!valid) {
    const retry = await p.confirm({
      message: "Would you like to try again?",
      initialValue: true,
    });

    if (retry && !p.isCancel(retry)) {
      return setupProviderWithAuth(provider);
    }
    return null;
  }

  return {
    type: provider.id,
    model,
    apiKey,
    baseUrl,
  };
}

/**
 * Setup provider with gcloud Application Default Credentials
 * Guides user through gcloud auth application-default login if needed
 */
async function setupGcloudADC(provider: ProviderDefinition): Promise<OnboardingResult | null> {
  console.log();
  console.log(chalk.magenta("   ┌─────────────────────────────────────────────────┐"));
  console.log(chalk.magenta("   │ ") + chalk.bold.white("☁️ Google Cloud ADC Authentication") + chalk.magenta("              │"));
  console.log(chalk.magenta("   └─────────────────────────────────────────────────┘"));
  console.log();

  // Check if gcloud CLI is installed
  const gcloudInstalled = await isGcloudInstalled();
  if (!gcloudInstalled) {
    p.log.error("gcloud CLI is not installed");
    console.log(chalk.dim("   Install it from: https://cloud.google.com/sdk/docs/install"));
    console.log();

    const useFallback = await p.confirm({
      message: "Use API key instead?",
      initialValue: true,
    });

    if (p.isCancel(useFallback) || !useFallback) return null;

    // Fall back to API key flow
    showProviderInfo(provider);
    const apiKey = await requestApiKey(provider);
    if (!apiKey) return null;

    const model = await selectModel(provider);
    if (!model) return null;

    const valid = await testConnection(provider, apiKey, model);
    if (!valid) return null;

    return { type: provider.id, model, apiKey };
  }

  // Check if ADC is already configured
  const adcConfigured = await isADCConfigured();

  if (adcConfigured) {
    console.log(chalk.green("   ✓ gcloud ADC is already configured!"));
    console.log();

    // Verify we can get a token
    const token = await getADCAccessToken();
    if (token) {
      p.log.success("Authentication verified");

      // Select model
      const model = await selectModel(provider);
      if (!model) return null;

      // Test connection (apiKey will be empty, Gemini provider will use ADC)
      // We pass a special marker to indicate ADC mode
      return {
        type: provider.id,
        model,
        apiKey: "__gcloud_adc__", // Special marker for ADC
      };
    }
  }

  // Need to run gcloud auth
  console.log(chalk.dim("   To authenticate with Google Cloud, you'll need to run:"));
  console.log();
  console.log(chalk.cyan("   $ gcloud auth application-default login"));
  console.log();
  console.log(chalk.dim("   This will open a browser for Google sign-in."));
  console.log(chalk.dim("   After signing in, the credentials will be stored locally."));
  console.log();

  const runNow = await p.confirm({
    message: "Run gcloud auth now?",
    initialValue: true,
  });

  if (p.isCancel(runNow)) return null;

  if (runNow) {
    console.log();
    console.log(chalk.dim("   Opening browser for Google sign-in..."));
    console.log(chalk.dim("   (Complete the sign-in in your browser, then return here)"));
    console.log();

    // Run gcloud auth command
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    try {
      // This will open a browser for authentication
      await execAsync("gcloud auth application-default login", {
        timeout: 120000, // 2 minute timeout
        stdio: "inherit", // Show output
      });

      // Verify authentication
      const token = await getADCAccessToken();
      if (token) {
        console.log(chalk.green("\n   ✓ Authentication successful!"));

        // Select model
        const model = await selectModel(provider);
        if (!model) return null;

        return {
          type: provider.id,
          model,
          apiKey: "__gcloud_adc__", // Special marker for ADC
        };
      } else {
        p.log.error("Failed to verify authentication");
        return null;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      p.log.error(`Authentication failed: ${errorMsg}`);

      const useFallback = await p.confirm({
        message: "Use API key instead?",
        initialValue: true,
      });

      if (p.isCancel(useFallback) || !useFallback) return null;

      // Fall back to API key flow
      showProviderInfo(provider);
      const apiKey = await requestApiKey(provider);
      if (!apiKey) return null;

      const model = await selectModel(provider);
      if (!model) return null;

      const valid = await testConnection(provider, apiKey, model);
      if (!valid) return null;

      return { type: provider.id, model, apiKey };
    }
  } else {
    // User doesn't want to run gcloud now
    console.log(chalk.dim("\n   Run this command when ready:"));
    console.log(chalk.cyan("   $ gcloud auth application-default login\n"));

    const useFallback = await p.confirm({
      message: "Use API key for now?",
      initialValue: true,
    });

    if (p.isCancel(useFallback) || !useFallback) return null;

    // Fall back to API key flow
    showProviderInfo(provider);
    const apiKey = await requestApiKey(provider);
    if (!apiKey) return null;

    const model = await selectModel(provider);
    if (!model) return null;

    const valid = await testConnection(provider, apiKey, model);
    if (!valid) return null;

    return { type: provider.id, model, apiKey };
  }
}

/**
 * Test LM Studio model with a realistic request
 * Uses a longer system prompt to detect context length issues early
 * This must simulate Coco's real system prompt size (~8000+ tokens)
 */
async function testLMStudioModel(
  port: number,
  model: string,
): Promise<{ success: boolean; error?: string }> {
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
    const response = await fetch(`http://localhost:${port}/v1/chat/completions`, {
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
      signal: AbortSignal.timeout(30000), // Longer timeout for slower models
    });

    if (response.ok) {
      return { success: true };
    }

    const errorData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    return {
      success: false,
      error: errorData.error?.message || `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

/**
 * Show context length error with fix instructions
 */
async function showContextLengthError(model: string): Promise<void> {
  p.log.message("");
  p.log.message(chalk.red("   ❌ Context length too small"));
  p.log.message("");
  p.log.message(chalk.yellow("   The model's context window is too small for Coco."));
  p.log.message(chalk.yellow("   To fix this in LM Studio:\n"));
  p.log.message(chalk.white("   1. Click on the model name in the top bar"));
  p.log.message(chalk.white("   2. Find 'Context Length' setting"));
  p.log.message(chalk.white("   3. Increase it (recommended: 8192 or higher)"));
  p.log.message(chalk.white("   4. Click 'Reload Model'\n"));
  p.log.message(chalk.dim(`   Model: ${model}`));
  p.log.message("");

  await p.confirm({
    message: "Press Enter after reloading the model...",
    initialValue: true,
  });
}

/**
 * Setup LM Studio (flujo simplificado - sin API key)
 * Exported for use by /provider command
 */
export async function setupLMStudioProvider(port = 1234): Promise<OnboardingResult | null> {
  const provider = getProviderDefinition("lmstudio");
  const baseUrl = `http://localhost:${port}/v1`;

  p.log.step(`${provider.emoji} LM Studio (free, local)`);

  // Loop hasta que el servidor esté conectado
  while (true) {
    const spinner = p.spinner();
    spinner.start(`Checking LM Studio server on port ${port}...`);

    let serverRunning = false;
    try {
      const response = await fetch(`http://localhost:${port}/v1/models`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      serverRunning = response.ok;
    } catch {
      // Server not running
    }

    if (serverRunning) {
      spinner.stop(chalk.green("✅ LM Studio server connected!"));

      // Try to get loaded models from LM Studio
      try {
        const modelsResponse = await fetch(`http://localhost:${port}/v1/models`, {
          method: "GET",
          signal: AbortSignal.timeout(3000),
        });
        if (modelsResponse.ok) {
          const modelsData = (await modelsResponse.json()) as { data?: Array<{ id: string }> };
          if (modelsData.data && modelsData.data.length > 0) {
            // Found loaded models - let user choose from them
            const loadedModels = modelsData.data.map((m) => m.id);

            if (loadedModels.length === 1 && loadedModels[0]) {
              // Only one model loaded - use it directly
              const model = loadedModels[0];
              p.log.message(chalk.green(`   📦 Using loaded model: ${model}`));

              // Test the model before returning
              const testResult = await testLMStudioModel(port, model);
              if (!testResult.success) {
                if (testResult.error?.includes("context length") || testResult.error?.includes("tokens to keep")) {
                  await showContextLengthError(model);
                  return setupLMStudioProvider(port);
                }
                p.log.message(chalk.yellow(`\n   ⚠️  Model test failed: ${testResult.error}\n`));
                return setupLMStudioProvider(port);
              }

              p.log.message(chalk.green("   ✅ Model ready!\n"));

              return {
                type: "lmstudio",
                model,
                apiKey: "lm-studio",
                baseUrl: port === 1234 ? undefined : `http://localhost:${port}/v1`,
              };
            } else {
              // Multiple models loaded - let user choose
              p.log.message(chalk.green(`   📦 Found ${loadedModels.length} loaded models\n`));

              const modelChoice = await p.select({
                message: "Choose a loaded model:",
                options: loadedModels.map((m) => ({
                  value: m,
                  label: m,
                })),
              });

              if (p.isCancel(modelChoice)) return null;

              // Test the selected model
              const testResult = await testLMStudioModel(port, modelChoice);
              if (!testResult.success) {
                if (testResult.error?.includes("context length") || testResult.error?.includes("tokens to keep")) {
                  await showContextLengthError(modelChoice);
                  return setupLMStudioProvider(port);
                }
                p.log.message(chalk.yellow(`\n   ⚠️  Model test failed: ${testResult.error}\n`));
                return setupLMStudioProvider(port);
              }

              p.log.message(chalk.green("   ✅ Model ready!\n"));

              return {
                type: "lmstudio",
                model: modelChoice,
                apiKey: "lm-studio",
                baseUrl: port === 1234 ? undefined : `http://localhost:${port}/v1`,
              };
            }
          }
        }
      } catch {
        // Could not get models, continue with manual selection
      }

      break;
    }

    spinner.stop(chalk.yellow("⚠️  Server not detected"));
    p.log.message("");
    p.log.message(chalk.yellow("   To connect LM Studio:"));
    p.log.message(chalk.dim("   1. Open LM Studio → https://lmstudio.ai"));
    p.log.message(chalk.dim("   2. Download a model (Discover → Search → Download)"));
    p.log.message(chalk.dim("   3. Load the model (double-click it)"));
    p.log.message(chalk.dim("   4. Start server: Menu → Developer → Start Server"));
    p.log.message("");

    const action = await p.select({
      message: `Is LM Studio server running on port ${port}?`,
      options: [
        { value: "retry", label: "🔄 Retry connection", hint: "Check again" },
        { value: "port", label: "🔧 Change port", hint: "Use different port" },
        { value: "exit", label: "👋 Exit", hint: "Come back later" },
      ],
    });

    if (p.isCancel(action) || action === "exit") {
      return null;
    }

    if (action === "port") {
      const newPort = await p.text({
        message: "Port:",
        placeholder: "1234",
        validate: (v) => {
          const num = parseInt(v, 10);
          if (isNaN(num) || num < 1 || num > 65535) return "Invalid port";
          return;
        },
      });
      if (p.isCancel(newPort)) return null;
      port = parseInt(newPort, 10);
    }
    // retry: just loop again
  }

  // Server connected but no models detected - need manual selection
  p.log.message("");
  p.log.message(chalk.yellow("   ⚠️  No loaded model detected"));
  p.log.message(chalk.dim("   Make sure you have a model loaded in LM Studio:"));
  p.log.message(chalk.dim("   1. In LM Studio: Discover → Search for a model"));
  p.log.message(chalk.dim("   2. Download it, then double-click to load"));
  p.log.message(chalk.dim("   3. The model name appears in the top bar of LM Studio\n"));

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "retry", label: "🔄 Retry (after loading a model)", hint: "Check again" },
      { value: "manual", label: "✏️  Enter model name manually", hint: "If you know the exact name" },
      { value: "exit", label: "👋 Exit", hint: "Come back later" },
    ],
  });

  if (p.isCancel(action) || action === "exit") {
    return null;
  }

  if (action === "retry") {
    return setupLMStudioProvider(port);
  }

  // Manual model entry
  const manualModel = await p.text({
    message: "Enter the model name (exactly as shown in LM Studio):",
    placeholder: "e.g. qwen2.5-coder-3b-instruct",
    validate: (v) => (!v || !v.trim() ? "Model name is required" : undefined),
  });

  if (p.isCancel(manualModel)) return null;

  // Test connection with manual model
  const testSpinner = p.spinner();
  testSpinner.start("Testing model connection...");

  const valid = await testConnectionQuiet(provider, "lm-studio", manualModel, port === 1234 ? undefined : baseUrl);

  if (!valid) {
    testSpinner.stop(chalk.yellow("⚠️  Model not responding"));
    p.log.message(chalk.dim("   The model name might not match what's loaded in LM Studio\n"));

    const retry = await p.confirm({
      message: "Try again?",
      initialValue: true,
    });
    if (retry && !p.isCancel(retry)) {
      return setupLMStudioProvider(port);
    }
    return null;
  }

  testSpinner.stop(chalk.green("✅ Model connected!"));

  return {
    type: "lmstudio",
    model: manualModel,
    apiKey: "lm-studio",
    baseUrl: port === 1234 ? undefined : `http://localhost:${port}/v1`,
  };
}

/**
 * Seleccionar provider existente
 */
async function selectExistingProvider(
  providers: ProviderDefinition[],
): Promise<OnboardingResult | null> {
  const options = providers.map((p) => ({
    value: p.id,
    label: `${p.emoji} ${p.name}`,
    hint: "Configured",
  }));

  options.push({ value: "__new__" as ProviderType, label: "➕ Setup new provider", hint: "" });

  const choice = await p.select({
    message: "Select provider:",
    options,
  });

  if (p.isCancel(choice)) return null;
  if (choice === ("__new__" as ProviderType)) return setupNewProvider();

  const provider = getProviderDefinition(choice as ProviderType);
  const apiKey = process.env[provider.envVar] || "";

  // Seleccionar modelo
  const model = await selectModel(provider);
  if (!model) return null;

  // Testear conexión
  const valid = await testConnection(provider, apiKey, model);
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
async function setupNewProvider(): Promise<OnboardingResult | null> {
  const providers = getAllProviders();

  const providerChoice = await p.select({
    message: "Choose an AI provider:",
    options: providers.map((prov) => ({
      value: prov.id,
      label: `${prov.emoji} ${prov.name}`,
      hint: prov.requiresApiKey === false ? "Free, local" : prov.description,
    })),
  });

  if (p.isCancel(providerChoice)) return null;

  const provider = getProviderDefinition(providerChoice as ProviderType);

  // LM Studio goes to its own flow
  if (provider.requiresApiKey === false) {
    return setupLMStudioProvider();
  }

  // Cloud providers use auth method selection
  return setupProviderWithAuth(provider);
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
async function requestApiKey(provider: ProviderDefinition): Promise<string | null> {
  const apiKey = await p.password({
    message: `Enter your ${provider.name} API key:`,
    validate: (value) => {
      if (!value || value.length < 10) {
        return "Please enter a valid API key (min 10 chars)";
      }
      return;
    },
  });

  if (p.isCancel(apiKey)) return null;
  return apiKey;
}

/**
 * Seleccionar modelo
 */
async function selectModel(provider: ProviderDefinition): Promise<string | null> {
  p.log.message("");
  p.log.step("Select a model");

  // Opciones de modelos
  const modelOptions = provider.models.map((m) => ({
    value: m.id,
    label: formatModelInfo(m),
  }));

  // Añadir opción de modelo personalizado
  if (provider.supportsCustomModels) {
    const customLabel =
      provider.id === "lmstudio"
        ? "✏️  Enter model name manually"
        : "✏️  Custom model (enter ID manually)";
    modelOptions.push({
      value: "__custom__",
      label: customLabel,
    });
  }

  const choice = await p.select({
    message: "Choose a model:",
    options: modelOptions,
  });

  if (p.isCancel(choice)) return null;

  // Manejar modelo personalizado
  if (choice === "__custom__") {
    const isLMStudio = provider.id === "lmstudio";
    const custom = await p.text({
      message: isLMStudio ? "Enter the model name (as shown in LM Studio):" : "Enter model ID:",
      placeholder: isLMStudio ? "e.g. qwen2.5-coder-7b-instruct" : provider.models[0]?.id || "model-name",
      validate: (v) => (!v || !v.trim() ? "Model name is required" : undefined),
    });

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
): Promise<boolean> {
  try {
    process.env[provider.envVar] = apiKey;
    if (baseUrl) {
      process.env[`${provider.id.toUpperCase()}_BASE_URL`] = baseUrl;
    }
    const testProvider = await createProvider(provider.id, { model });
    return await testProvider.isAvailable();
  } catch {
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
): Promise<boolean> {
  p.log.message("");
  const spinner = p.spinner();
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

    const testProvider = await createProvider(provider.id, { model });

    if (debug) {
      p.log.message(chalk.dim(`[Debug] Provider created: ${testProvider.id}`));
    }

    const available = await testProvider.isAvailable();

    if (!available) {
      spinner.stop("Connection failed");
      p.log.error(chalk.red(`\n❌ Could not connect to ${provider.name}`));
      p.log.message(chalk.dim("\nPossible causes:"));
      p.log.message(chalk.dim("  • Invalid API key"));
      p.log.message(chalk.dim("  • Invalid model name"));
      p.log.message(chalk.dim("  • Network connectivity issues"));
      p.log.message(chalk.dim("  • Provider service unavailable"));

      // Para Kimi, mostrar información específica
      if (provider.id === "kimi") {
        p.log.message(chalk.dim("\n🌙 Kimi/Moonshot specific:"));
        p.log.message(
          chalk.dim("  • Get your key from: https://platform.moonshot.cn/console/api-keys"),
        );
        p.log.message(chalk.dim("  • Ensure your account has credits"));
        p.log.message(chalk.dim("  • Try model: moonshot-v1-8k (most compatible)"));
      }

      return false;
    }

    spinner.stop(chalk.green("✅ Connected successfully!"));
    return true;
  } catch (error) {
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
export async function saveConfiguration(result: OnboardingResult): Promise<void> {
  const provider = getProviderDefinition(result.type);
  const isLocal = provider.requiresApiKey === false;
  const isGcloudADC = result.apiKey === "__gcloud_adc__";

  // gcloud ADC doesn't need to save API key - credentials are managed by gcloud
  if (isGcloudADC) {
    p.log.success("✅ Using gcloud ADC (credentials managed by gcloud CLI)");
    p.log.message(chalk.dim("   Run `gcloud auth application-default login` to refresh credentials"));
    // Still save provider/model preference to config.json
    await saveProviderPreference(result.type, result.model);
    return;
  }

  // API keys are user-level credentials — always saved globally in ~/.coco/.env
  const message = isLocal
    ? "Save your LM Studio configuration?"
    : "Save your API key?";

  const saveOptions = await p.select({
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
  });

  if (p.isCancel(saveOptions)) return;

  const envVarsToSave: Record<string, string> = {};

  if (isLocal) {
    // LM Studio: save config (no API key)
    envVarsToSave["COCO_PROVIDER"] = result.type;
    envVarsToSave["LMSTUDIO_MODEL"] = result.model;
    if (result.baseUrl) {
      envVarsToSave["LMSTUDIO_BASE_URL"] = result.baseUrl;
    }
  } else {
    // Cloud providers: save API key
    envVarsToSave[provider.envVar] = result.apiKey;
    if (result.baseUrl) {
      envVarsToSave[`${provider.envVar.replace("_API_KEY", "_BASE_URL")}`] = result.baseUrl;
    }
  }

  switch (saveOptions) {
    case "global":
      await saveEnvVars(CONFIG_PATHS.env, envVarsToSave, true);
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
  await saveProviderPreference(result.type, result.model);
}

/**
 * Guardar variables de entorno en un archivo .env
 */
async function saveEnvVars(
  filePath: string,
  vars: Record<string, string>,
  createDir = false,
): Promise<void> {
  // Crear directorio si es necesario (para ~/.coco/.env)
  if (createDir) {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    } catch {
      // Ya existe
    }
  }

  // Leer archivo existente
  let existingVars: Record<string, string> = {};
  try {
    const content = await fs.readFile(filePath, "utf-8");
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

  await fs.writeFile(filePath, lines.join("\n") + "\n", { mode: 0o600 });
}

/**
 * Asegurar configuración antes de iniciar REPL
 *
 * Smart flow:
 * 1. If preferred provider is configured and working → use it
 * 2. If any provider is configured → use it silently (no warnings)
 * 3. If no provider configured → run onboarding
 */
export async function ensureConfiguredV2(config: ReplConfig): Promise<ReplConfig | null> {
  const providers = getAllProviders();
  const authMethod = getAuthMethod(config.provider.type as ProviderType);

  // 1a. Check if preferred provider uses OAuth (e.g., openai with OAuth)
  // Also handle legacy "codex" provider which always uses OAuth
  const usesOAuth = authMethod === "oauth" || config.provider.type === "codex";

  if (usesOAuth) {
    // For OAuth, we always check openai tokens (codex maps to openai internally)
    const hasOAuthTokens = await isOAuthConfigured("openai");
    if (hasOAuthTokens) {
      try {
        const tokenResult = await getOrRefreshOAuthToken("openai");
        if (tokenResult) {
          // Set token in env for the session (codex provider reads from here)
          process.env["OPENAI_CODEX_TOKEN"] = tokenResult.accessToken;

          // Use codex provider internally for OAuth
          const provider = await createProvider("codex", {
            model: config.provider.model,
          });
          if (await provider.isAvailable()) {
            // Migrate legacy "codex" to "openai" with oauth authMethod
            if (config.provider.type === "codex") {
              const migratedConfig = {
                ...config,
                provider: {
                  ...config.provider,
                  type: "openai" as ProviderType,
                },
              };
              // Save the migration
              await saveProviderPreference("openai", config.provider.model || "gpt-4o", "oauth");
              return migratedConfig;
            }
            return config;
          }
        }
      } catch {
        // OAuth token failed, try other providers
      }
    }
  }

  // 1b. Check if preferred provider (from config) is available via API key
  const preferredProvider = providers.find(
    (p) => p.id === config.provider.type && process.env[p.envVar],
  );

  if (preferredProvider) {
    try {
      const provider = await createProvider(preferredProvider.id, {
        model: config.provider.model,
      });
      if (await provider.isAvailable()) {
        return config;
      }
    } catch {
      // Preferred provider failed, try others
    }
  }

  // 2. Find any configured provider (silently use the first available)
  const configuredProviders = providers.filter((p) => process.env[p.envVar]);

  for (const prov of configuredProviders) {
    try {
      const recommended = getRecommendedModel(prov.id);
      const model = recommended?.id || prov.models[0]?.id || "";

      const provider = await createProvider(prov.id, { model });
      if (await provider.isAvailable()) {
        // Silently use this provider - no warning needed
        return {
          ...config,
          provider: {
            ...config.provider,
            type: prov.id,
            model,
          },
        };
      }
    } catch {
      // This provider also failed, try next
      continue;
    }
  }

  // 2b. Check for OAuth-configured OpenAI (if not already the preferred provider)
  if (config.provider.type !== "openai" && config.provider.type !== "codex") {
    const hasOAuthTokens = await isOAuthConfigured("openai");
    if (hasOAuthTokens) {
      try {
        const tokenResult = await getOrRefreshOAuthToken("openai");
        if (tokenResult) {
          process.env["OPENAI_CODEX_TOKEN"] = tokenResult.accessToken;

          const openaiDef = getProviderDefinition("openai");
          const recommended = getRecommendedModel("openai");
          const model = recommended?.id || openaiDef.models[0]?.id || "";

          const provider = await createProvider("codex", { model });
          if (await provider.isAvailable()) {
            // Save as openai with oauth authMethod
            await saveProviderPreference("openai", model, "oauth");
            return {
              ...config,
              provider: {
                ...config.provider,
                type: "openai",
                model,
              },
            };
          }
        }
      } catch {
        // OAuth failed, continue to onboarding
      }
    }
  }

  // 3. No providers configured or all failed → run onboarding
  const result = await runOnboardingV2();
  if (!result) return null;

  // Save configuration
  await saveConfiguration(result);

  return {
    ...config,
    provider: {
      ...config.provider,
      type: result.type,
      model: result.model,
    },
  };
}
