/**
 * /model command - Change or view current model
 * Interactive selection with arrow keys
 */

import chalk from "chalk";
import ansiEscapes from "ansi-escapes";
import type { SlashCommand, ReplSession } from "../types.js";
import { getProviderDefinition, getAllProviders } from "../providers-config.js";
import type { ProviderType } from "../../../providers/index.js";

/**
 * Interactive model selector using arrow keys
 */
async function selectModelInteractively(
  models: Array<{ id: string; name?: string; recommended?: boolean; contextWindow?: number }>,
  currentModelId: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIndex = models.findIndex((m) => m.id === currentModelId);
    if (selectedIndex === -1) selectedIndex = 0;

    const renderMenu = () => {
      // Clear previous render and redraw
      process.stdout.write(ansiEscapes.eraseDown);

      for (let i = 0; i < models.length; i++) {
        const model = models[i]!;
        const isCurrent = model.id === currentModelId;
        const isSelected = i === selectedIndex;

        let line = "";

        if (isSelected) {
          line += chalk.bgBlue.white(" ▶ ");
          line += chalk.bgBlue.white(model.id.padEnd(40));
        } else {
          const marker = isCurrent ? chalk.green(" ● ") : chalk.dim(" ○ ");
          line += marker;
          line += isCurrent ? chalk.green(model.id.padEnd(40)) : model.id.padEnd(40);
        }

        const star = model.recommended ? chalk.magenta(" ⭐") : "";
        const ctx = model.contextWindow ? chalk.dim(` ${Math.round(model.contextWindow / 1000)}K`) : "";
        line += star + ctx;

        console.log(line);
      }

      console.log(chalk.dim("\n↑/↓ navigate • Enter select • Esc cancel"));

      // Move cursor back up to top of menu
      process.stdout.write(ansiEscapes.cursorUp(models.length + 2));
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      // Clear the menu
      process.stdout.write(ansiEscapes.eraseDown);
    };

    const onKeyPress = (data: Buffer) => {
      const key = data.toString();

      // Escape - cancel
      if (key === "\x1b" && data.length === 1) {
        cleanup();
        resolve(null);
        return;
      }

      // Ctrl+C - cancel
      if (key === "\x03") {
        cleanup();
        resolve(null);
        return;
      }

      // Enter - select
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(models[selectedIndex]!.id);
        return;
      }

      // Up arrow
      if (key === "\x1b[A") {
        selectedIndex = (selectedIndex - 1 + models.length) % models.length;
        process.stdout.write(ansiEscapes.eraseDown);
        renderMenu();
        return;
      }

      // Down arrow
      if (key === "\x1b[B") {
        selectedIndex = (selectedIndex + 1) % models.length;
        process.stdout.write(ansiEscapes.eraseDown);
        renderMenu();
        return;
      }
    };

    // Enable raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", onKeyPress);

    // Initial render
    renderMenu();
  });
}

export const modelCommand: SlashCommand = {
  name: "model",
  aliases: ["m"],
  description: "View or change the current model",
  usage: "/model [model-name]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const currentProvider = session.config.provider.type as ProviderType;
    const providerDef = getProviderDefinition(currentProvider);

    if (args.length === 0) {
      // Interactive model selection
      console.log(chalk.cyan("\n═══ Model Selection ═══"));
      console.log(chalk.dim(`Provider: ${providerDef.emoji} ${providerDef.name}`));
      console.log(chalk.dim(`Current: ${session.config.provider.model}\n`));

      if (providerDef.models.length === 0) {
        console.log(chalk.dim("No predefined models. Use: /model <model-name>\n"));
        return false;
      }

      const selectedModel = await selectModelInteractively(
        providerDef.models,
        session.config.provider.model
      );

      if (!selectedModel) {
        console.log(chalk.dim("Cancelled\n"));
        return false;
      }

      if (selectedModel === session.config.provider.model) {
        console.log(chalk.dim(`Already using ${selectedModel}\n`));
        return false;
      }

      session.config.provider.model = selectedModel;
      const modelInfo = providerDef.models.find((m) => m.id === selectedModel);
      console.log(chalk.green(`✓ Switched to ${modelInfo?.name ?? selectedModel}\n`));

      return false;
    }

    // Direct model specification via argument
    const newModel = args[0]!;

    // Check if already using this model
    if (newModel === session.config.provider.model) {
      console.log(chalk.dim(`Already using ${newModel}\n`));
      return false;
    }

    // Find model in current provider or any provider
    let foundInProvider: string | null = null;
    for (const provider of getAllProviders()) {
      if (provider.models.some((m) => m.id === newModel)) {
        foundInProvider = provider.id;
        break;
      }
    }

    if (!foundInProvider) {
      // Allow custom model names (for fine-tunes, etc.)
      console.log(chalk.yellow(`Model "${newModel}" not in known list, setting anyway...`));
      session.config.provider.model = newModel;
      console.log(chalk.green(`✓ Model set to: ${newModel}\n`));
      return false;
    }

    if (foundInProvider !== currentProvider) {
      const otherProvider = getProviderDefinition(foundInProvider as ProviderType);
      console.log(chalk.yellow(`\n⚠ "${newModel}" is a ${otherProvider.name} model.`));
      console.log(chalk.dim(`Current provider is ${providerDef.name}.`));
      console.log(chalk.dim(`Use /provider ${foundInProvider} first.\n`));
      return false;
    }

    session.config.provider.model = newModel;
    const modelInfo = providerDef.models.find((m) => m.id === newModel);
    console.log(chalk.green(`✓ Switched to ${modelInfo?.name ?? newModel}\n`));

    return false;
  },
};
