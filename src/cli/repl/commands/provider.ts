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
} from "../providers-config.js";
import type { ProviderType } from "../../../providers/index.js";
import { createProvider } from "../../../providers/index.js";

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
  currentProviderId: string
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
          line += isCurrent ? chalk.green(provider.id.padEnd(12)) : chalk.yellow(provider.id.padEnd(12));
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

      const selectedProviderId = await selectProviderInteractively(providerOptions, currentProvider);

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
  newProvider: ReturnType<typeof getAllProviders>[number],
  session: ReplSession
): Promise<boolean> {
  // Check if provider is configured
  const apiKey = process.env[newProvider.envVar];
  if (!apiKey) {
    console.log(chalk.yellow(`\n${newProvider.emoji} ${newProvider.name} is not configured.`));
    console.log(chalk.dim(`\nTo configure, set the ${newProvider.envVar} environment variable.`));
    console.log(chalk.dim(`Get your API key from: ${newProvider.apiKeyUrl}\n`));

    const configure = await p.confirm({
      message: "Would you like to enter an API key now?",
      initialValue: true,
    });

    if (p.isCancel(configure) || !configure) {
      return false;
    }

    const key = await p.password({
      message: `Enter your ${newProvider.name} API key:`,
      validate: (v) => (!v || v.length < 10 ? "API key too short" : undefined),
    });

    if (p.isCancel(key)) {
      return false;
    }

    // Set env var for this session
    process.env[newProvider.envVar] = key;
  }

  // Get recommended model for new provider
  const recommendedModel = getRecommendedModel(newProvider.id as ProviderType);
  const newModel = recommendedModel?.id || newProvider.models[0]?.id || "";

  // Test connection
  const spinner = p.spinner();
  spinner.start(`Connecting to ${newProvider.name}...`);

  try {
    const testProvider = await createProvider(newProvider.id as ProviderType, { model: newModel });
    const available = await testProvider.isAvailable();

    if (!available) {
      spinner.stop(chalk.red("Connection failed"));
      console.log(chalk.red(`\n❌ Could not connect to ${newProvider.name}`));
      console.log(chalk.dim("Check your API key and try again.\n"));
      return false;
    }

    spinner.stop(chalk.green("Connected!"));

    // Update session
    session.config.provider.type = newProvider.id as ProviderType;
    session.config.provider.model = newModel;

    console.log(chalk.green(`\n✓ Switched to ${newProvider.emoji} ${newProvider.name}`));
    console.log(chalk.dim(`  Model: ${newModel}`));
    console.log(chalk.dim(`  Use /model to change models\n`));
  } catch (error) {
    spinner.stop(chalk.red("Error"));
    console.log(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`));
  }

  return false;
}
