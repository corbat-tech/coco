/**
 * /provider command - Change or view current provider
 * Interactive selection with arrow keys
 */

import chalk from "chalk";
import ansiEscapes from "ansi-escapes";
import * as p from "@clack/prompts";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  getAllProviders,
  getProviderDefinition,
  getConfiguredProviders,
  getRecommendedModel,
  type ProviderDefinition,
} from "../providers-config.js";
import type { ProviderType } from "../../../providers/index.js";
import { createProvider } from "../../../providers/index.js";
import { setupLMStudioProvider, saveConfiguration } from "../onboarding-v2.js";
import {
  runOAuthFlow,
  supportsOAuth,
  isADCConfigured,
  isGcloudInstalled,
  getADCAccessToken,
  isOAuthConfigured,
  getOrRefreshOAuthToken,
  deleteTokens,
} from "../../../auth/index.js";
import { saveProviderPreference, clearAuthMethod, type AuthMethod } from "../../../config/env.js";

interface ProviderOption {
  id: string;
  name: string;
  emoji: string;
  description: string;
  isConfigured: boolean;
}

/**
 * Interactive provider selector using arrow keys
 */
async function selectProviderInteractively(
  providers: ProviderOption[],
  currentProviderId: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIndex = providers.findIndex((p) => p.id === currentProviderId);
    if (selectedIndex === -1) selectedIndex = 0;

    const renderMenu = () => {
      process.stdout.write(ansiEscapes.eraseDown);

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i]!;
        const isCurrent = provider.id === currentProviderId;
        const isSelected = i === selectedIndex;

        let line = "";

        if (isSelected) {
          line += chalk.bgBlue.white(` ▶ ${provider.emoji} ${provider.id.padEnd(12)} `);
          line += chalk.bgBlue.white(provider.description.slice(0, 40));
        } else {
          const marker = isCurrent ? chalk.green(" ● ") : chalk.dim(" ○ ");
          const status = provider.isConfigured ? chalk.green("✓") : chalk.dim("○");
          line += marker;
          line += `${status} ${provider.emoji} `;
          line += isCurrent
            ? chalk.green(provider.id.padEnd(12))
            : chalk.yellow(provider.id.padEnd(12));
          line += chalk.dim(provider.description.slice(0, 40));
        }

        console.log(line);
      }

      console.log(chalk.dim("\n↑/↓ navigate • Enter select • Esc cancel"));
      console.log(chalk.dim("✓ = API key configured"));

      // Move cursor back up
      process.stdout.write(ansiEscapes.cursorUp(providers.length + 3));
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdout.write(ansiEscapes.eraseDown);
    };

    const onKeyPress = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x1b" && data.length === 1) {
        cleanup();
        resolve(null);
        return;
      }

      if (key === "\x03") {
        cleanup();
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(providers[selectedIndex]!.id);
        return;
      }

      if (key === "\x1b[A") {
        selectedIndex = (selectedIndex - 1 + providers.length) % providers.length;
        process.stdout.write(ansiEscapes.eraseDown);
        renderMenu();
        return;
      }

      if (key === "\x1b[B") {
        selectedIndex = (selectedIndex + 1) % providers.length;
        process.stdout.write(ansiEscapes.eraseDown);
        renderMenu();
        return;
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", onKeyPress);

    renderMenu();
  });
}

export const providerCommand: SlashCommand = {
  name: "provider",
  aliases: ["p"],
  description: "View or change the current provider",
  usage: "/provider [provider-name]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const currentProvider = session.config.provider.type as ProviderType;
    const providerDef = getProviderDefinition(currentProvider);

    if (args.length === 0) {
      // Interactive provider selection
      console.log(chalk.cyan("\n═══ Provider Selection ═══"));
      console.log(chalk.dim(`Current: ${providerDef.emoji} ${providerDef.name}`));
      console.log(chalk.dim(`Model: ${session.config.provider.model}\n`));

      const allProviders = getAllProviders();
      const configuredProviders = getConfiguredProviders();

      const providerOptions: ProviderOption[] = allProviders.map((p) => ({
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        description: p.description,
        isConfigured: configuredProviders.some((cp) => cp.id === p.id),
      }));

      const selectedProviderId = await selectProviderInteractively(
        providerOptions,
        currentProvider,
      );

      if (!selectedProviderId) {
        console.log(chalk.dim("Cancelled\n"));
        return false;
      }

      if (selectedProviderId === currentProvider) {
        console.log(chalk.dim(`Already using ${providerDef.name}\n`));
        return false;
      }

      // Continue with provider switch logic
      const newProvider = allProviders.find((p) => p.id === selectedProviderId)!;
      return await switchProvider(newProvider, session);
    }

    // Direct provider specification via argument
    const newProviderId = args[0]?.toLowerCase() as ProviderType;
    const allProviders = getAllProviders();
    const newProvider = allProviders.find((p) => p.id === newProviderId);

    if (!newProvider) {
      console.log(chalk.red(`Unknown provider: ${newProviderId}`));
      console.log(chalk.dim(`Available: ${allProviders.map((p) => p.id).join(", ")}\n`));
      return false;
    }

    if (newProviderId === currentProvider) {
      console.log(chalk.yellow(`Already using ${newProvider.name}\n`));
      return false;
    }

    return await switchProvider(newProvider, session);
  },
};

/**
 * Switch to a new provider, handling API key setup if needed
 */
async function switchProvider(
  initialProvider: ProviderDefinition,
  session: ReplSession,
): Promise<boolean> {
  // Track the provider names and auth method
  const newProvider = initialProvider;
  const userFacingProviderId = initialProvider.id; // What user sees (e.g., "openai")
  let internalProviderId = initialProvider.id; // What we use internally (e.g., "codex" for OAuth)
  let selectedAuthMethod: AuthMethod = "apikey"; // Default to API key

  // LM Studio uses special setup flow (auto-detect models, no API key)
  if (newProvider.requiresApiKey === false) {
    const result = await setupLMStudioProvider();
    if (!result) {
      console.log(chalk.dim("Cancelled\n"));
      return false;
    }

    // Save configuration
    await saveConfiguration(result);

    // Update session
    session.config.provider.type = result.type;
    session.config.provider.model = result.model;

    console.log(chalk.green(`\n✓ Switched to ${newProvider.emoji} ${newProvider.name}`));
    console.log(chalk.dim(`  Model: ${result.model}`));
    console.log(chalk.dim(`  Use /model to change models\n`));
    return false;
  }

  // Cloud providers: Check current configuration status
  const apiKey = process.env[newProvider.envVar];
  // Check OAuth support from both auth module (for OpenAI) and provider config (for Gemini)
  const hasOAuth = supportsOAuth(newProvider.id) || newProvider.supportsOAuth;
  const hasGcloudADC = newProvider.supportsGcloudADC;

  // Determine which OAuth provider to check (openai for OpenAI/codex, gemini for Gemini)
  const oauthProviderName = newProvider.id === "gemini" ? "gemini" : "openai";

  // Check if OAuth is already configured for this provider
  let oauthConnected = false;
  if (hasOAuth) {
    try {
      oauthConnected = await isOAuthConfigured(oauthProviderName);
    } catch {
      // Ignore errors checking OAuth status
    }
  }

  // Always show auth menu for cloud providers (they require some form of auth)
  // This allows: selecting auth method, entering new credentials, or removing existing ones
  {
    // Build auth options based on provider capabilities
    const authOptions: Array<{ value: string; label: string; hint: string }> = [];

    if (hasOAuth) {
      // Determine OAuth labels based on provider
      const oauthLabels =
        newProvider.id === "gemini"
          ? {
              connected: "🔐 Google account (connected ✓)",
              signIn: "🔐 Sign in with Google account",
              hint: "Same as Gemini CLI",
            }
          : {
              connected: "🔐 ChatGPT account (connected ✓)",
              signIn: "🔐 Sign in with ChatGPT account",
              hint: "Use your Plus/Pro subscription",
            };

      if (oauthConnected) {
        authOptions.push({
          value: "oauth",
          label: oauthLabels.connected,
          hint: "Use your existing session",
        });
      } else {
        authOptions.push({
          value: "oauth",
          label: oauthLabels.signIn,
          hint: oauthLabels.hint,
        });
      }
    }

    if (hasGcloudADC) {
      authOptions.push({
        value: "gcloud",
        label: "☁️ Use gcloud ADC",
        hint: "Authenticate via gcloud CLI",
      });
    }

    if (apiKey) {
      authOptions.push({
        value: "apikey",
        label: "🔑 API key (configured ✓)",
        hint: "Use your existing API key",
      });
    } else {
      authOptions.push({
        value: "apikey",
        label: "🔑 Enter API key",
        hint: `Get from ${newProvider.apiKeyUrl}`,
      });
    }

    // Add option to remove credentials if any are configured
    if (oauthConnected || apiKey) {
      authOptions.push({
        value: "remove",
        label: "🗑️  Remove saved credentials",
        hint: "Clear stored API key or OAuth session",
      });
    }

    authOptions.push({
      value: "cancel",
      label: "❌ Cancel",
      hint: "",
    });

    // Only show selection if there's actually a choice to make
    if (authOptions.length > 2) {
      // More than just one option + cancel
      const authChoice = await p.select({
        message: `How would you like to authenticate with ${newProvider.name}?`,
        options: authOptions,
      });

      if (p.isCancel(authChoice) || authChoice === "cancel") {
        return false;
      }

      // Handle OAuth flow
      if (authChoice === "oauth") {
        // Determine token env var and internal provider based on provider type
        const isGemini = newProvider.id === "gemini";
        const tokenEnvVar = isGemini ? "GEMINI_OAUTH_TOKEN" : "OPENAI_CODEX_TOKEN";

        if (oauthConnected) {
          // Use existing OAuth session
          try {
            const tokenResult = await getOrRefreshOAuthToken(oauthProviderName);
            if (tokenResult) {
              process.env[tokenEnvVar] = tokenResult.accessToken;
              selectedAuthMethod = "oauth";
              if (!isGemini) internalProviderId = "codex";
              console.log(chalk.dim(`\nUsing existing OAuth session...`));
            } else {
              // Token refresh failed, need to re-authenticate
              const result = await runOAuthFlow(newProvider.id);
              if (!result) return false;
              process.env[tokenEnvVar] = result.accessToken;
              selectedAuthMethod = "oauth";
              if (!isGemini) internalProviderId = "codex";
            }
          } catch {
            // Token expired, need to re-authenticate
            const result = await runOAuthFlow(newProvider.id);
            if (!result) return false;
            process.env[tokenEnvVar] = result.accessToken;
            selectedAuthMethod = "oauth";
            if (!isGemini) internalProviderId = "codex";
          }
        } else {
          // New OAuth flow
          const result = await runOAuthFlow(newProvider.id);
          if (!result) return false;
          process.env[tokenEnvVar] = result.accessToken;
          selectedAuthMethod = "oauth";
          if (!isGemini) internalProviderId = "codex";
        }
      }
      // Handle gcloud ADC flow
      else if (authChoice === "gcloud") {
        const adcResult = await setupGcloudADCForProvider(newProvider);
        if (!adcResult) return false;
        selectedAuthMethod = "gcloud";
      }
      // Handle API key flow
      else if (authChoice === "apikey") {
        if (apiKey) {
          // Use existing API key
          selectedAuthMethod = "apikey";
          console.log(chalk.dim(`\nUsing existing API key...`));
        } else {
          // Need to enter new API key
          const key = await p.password({
            message: `Enter your ${newProvider.name} API key:`,
            validate: (v) => (!v || v.length < 10 ? "API key too short" : undefined),
          });

          if (p.isCancel(key)) {
            return false;
          }

          process.env[newProvider.envVar] = key;
          selectedAuthMethod = "apikey";
        }
      }
      // Handle remove credentials
      else if (authChoice === "remove") {
        const removeOptions: Array<{ value: string; label: string }> = [];

        if (oauthConnected) {
          removeOptions.push({
            value: "oauth",
            label: "🔐 Remove OAuth session",
          });
        }

        if (apiKey) {
          removeOptions.push({
            value: "apikey",
            label: "🔑 Remove API key",
          });
        }

        if (oauthConnected && apiKey) {
          removeOptions.push({
            value: "all",
            label: "🗑️  Remove all credentials",
          });
        }

        removeOptions.push({
          value: "cancel",
          label: "❌ Cancel",
        });

        const removeChoice = await p.select({
          message: "What would you like to remove?",
          options: removeOptions,
        });

        if (p.isCancel(removeChoice) || removeChoice === "cancel") {
          return false;
        }

        if (removeChoice === "oauth" || removeChoice === "all") {
          await deleteTokens(oauthProviderName);
          await clearAuthMethod(newProvider.id as ProviderType);
          console.log(chalk.green("✓ OAuth session removed"));
        }

        if (removeChoice === "apikey" || removeChoice === "all") {
          // Clear API key from env (it will need to be re-entered)
          delete process.env[newProvider.envVar];
          console.log(chalk.green("✓ API key removed from session"));
          console.log(chalk.dim(`  Note: If key is in ~/.coco/.env, remove it there too`));
        }

        console.log("");
        return false;
      }
    } else {
      // Only one auth option (API key) and nothing configured - prompt directly
      console.log(chalk.yellow(`\n${newProvider.emoji} ${newProvider.name} is not configured.`));

      const key = await p.password({
        message: `Enter your ${newProvider.name} API key:`,
        validate: (v) => (!v || v.length < 10 ? "API key too short" : undefined),
      });

      if (p.isCancel(key)) {
        return false;
      }

      process.env[newProvider.envVar] = key;
      selectedAuthMethod = "apikey";
    }
  }

  // Get recommended model for new provider
  const recommendedModel = getRecommendedModel(newProvider.id as ProviderType);
  const newModel = recommendedModel?.id || newProvider.models[0]?.id || "";

  // Test connection (use internal provider ID for OAuth)
  const spinner = p.spinner();
  spinner.start(`Connecting to ${newProvider.name}...`);

  try {
    const testProvider = await createProvider(internalProviderId as ProviderType, {
      model: newModel,
    });
    const available = await testProvider.isAvailable();

    if (!available) {
      spinner.stop(chalk.red("Connection failed"));
      console.log(chalk.red(`\n❌ Could not connect to ${newProvider.name}`));
      console.log(chalk.dim("Check your API key and try again.\n"));
      return false;
    }

    spinner.stop(chalk.green("Connected!"));

    // Update session - use user-facing provider name, not internal ID
    session.config.provider.type = userFacingProviderId as ProviderType;
    session.config.provider.model = newModel;

    // Save preferences with auth method
    await saveProviderPreference(
      userFacingProviderId as ProviderType,
      newModel,
      selectedAuthMethod,
    );

    console.log(chalk.green(`\n✓ Switched to ${newProvider.emoji} ${newProvider.name}`));
    console.log(chalk.dim(`  Model: ${newModel}`));
    if (selectedAuthMethod === "oauth") {
      console.log(chalk.dim(`  Auth: ChatGPT subscription (OAuth)`));
    }
    console.log(chalk.dim(`  Use /model to change models\n`));
  } catch (error) {
    spinner.stop(chalk.red("Error"));
    console.log(
      chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`),
    );
  }

  return false;
}

/**
 * Setup gcloud ADC for a provider (simplified version for /provider command)
 */
async function setupGcloudADCForProvider(_provider: ProviderDefinition): Promise<boolean> {
  // Check if gcloud is installed
  const gcloudInstalled = await isGcloudInstalled();
  if (!gcloudInstalled) {
    p.log.error("gcloud CLI is not installed");
    console.log(chalk.dim("   Install it from: https://cloud.google.com/sdk/docs/install\n"));
    return false;
  }

  // Check if ADC is already configured
  const adcConfigured = await isADCConfigured();
  if (adcConfigured) {
    const token = await getADCAccessToken();
    if (token) {
      console.log(chalk.green("   ✓ gcloud ADC is already configured!\n"));
      return true;
    }
  }

  // Need to run gcloud auth
  console.log(chalk.dim("\n   To authenticate, run:"));
  console.log(chalk.cyan("   $ gcloud auth application-default login\n"));

  const runNow = await p.confirm({
    message: "Run gcloud auth now?",
    initialValue: true,
  });

  if (p.isCancel(runNow) || !runNow) {
    return false;
  }

  // Run gcloud auth
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  try {
    await execAsync("gcloud auth application-default login", { timeout: 120000 });
    const token = await getADCAccessToken();
    if (token) {
      console.log(chalk.green("\n   ✓ Authentication successful!\n"));
      return true;
    }
  } catch (error) {
    p.log.error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return false;
}
