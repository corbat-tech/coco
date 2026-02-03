/**
 * /model command - Change or view current model
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

const MODELS_BY_PROVIDER: Record<string, Array<{ id: string; name: string; desc: string }>> = {
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", desc: "Fast & capable (default)" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4", desc: "Most capable" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", desc: "Previous gen" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", desc: "Fastest" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o", desc: "Most capable (default)" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", desc: "Fast & cheap" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo", desc: "Previous gen" },
    { id: "o1", name: "o1", desc: "Reasoning model" },
    { id: "o1-mini", name: "o1 Mini", desc: "Fast reasoning" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", desc: "Fast & capable (default)" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", desc: "Previous gen fast" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", desc: "Most capable" },
  ],
  kimi: [
    { id: "moonshot-v1-8k", name: "Moonshot v1 8K", desc: "Fast (default)" },
    { id: "moonshot-v1-32k", name: "Moonshot v1 32K", desc: "Medium context" },
    { id: "moonshot-v1-128k", name: "Moonshot v1 128K", desc: "Large context" },
  ],
};

export const modelCommand: SlashCommand = {
  name: "model",
  aliases: ["m"],
  description: "View or change the current model",
  usage: "/model [model-name]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const currentProvider = session.config.provider.type;

    if (args.length === 0) {
      // Show current model and available options
      console.log(chalk.cyan("\nCurrent provider: ") + chalk.bold(currentProvider));
      console.log(chalk.cyan("Current model: ") + chalk.bold(session.config.provider.model));

      const models = MODELS_BY_PROVIDER[currentProvider] ?? [];
      if (models.length > 0) {
        console.log(chalk.dim(`\nAvailable models for ${currentProvider}:`));

        for (const model of models) {
          const isCurrent = model.id === session.config.provider.model;
          const prefix = isCurrent ? chalk.green("● ") : "  ";
          console.log(`${prefix}${chalk.yellow(model.id)}`);
          console.log(`    ${chalk.dim(model.name)} - ${model.desc}`);
        }
      }

      console.log(chalk.dim("\nUsage: /model <model-id>"));
      console.log(chalk.dim("To change provider, restart with: coco --provider <name>\n"));
      return false;
    }

    const newModel = args[0];

    // Find model in current provider or any provider
    let foundInProvider: string | null = null;
    for (const [provider, models] of Object.entries(MODELS_BY_PROVIDER)) {
      if (models.some((m) => m.id === newModel)) {
        foundInProvider = provider;
        break;
      }
    }

    if (!foundInProvider || !newModel) {
      // Allow custom model names (for fine-tunes, etc.)
      console.log(chalk.yellow(`Model "${newModel}" not in known list, setting anyway...`));
      session.config.provider.model = newModel ?? session.config.provider.model;
      console.log(chalk.green(`✓ Model set to: ${newModel}\n`));
      return false;
    }

    if (foundInProvider !== currentProvider) {
      console.log(chalk.yellow(`Note: "${newModel}" is a ${foundInProvider} model.`));
      console.log(chalk.yellow(`Current provider is ${currentProvider}.`));
      console.log(chalk.dim(`Restart with: coco --provider ${foundInProvider}\n`));
      return false;
    }

    session.config.provider.model = newModel as string;
    const modelInfo = MODELS_BY_PROVIDER[currentProvider]?.find((m) => m.id === newModel);
    console.log(chalk.green(`✓ Switched to ${modelInfo?.name ?? newModel}\n`));

    return false;
  },
};
