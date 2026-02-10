/**
 * /model command - Change or view current model
 * Interactive selection with arrow keys
 *
 * For local providers (Ollama, LM Studio), queries the running server
 * to show downloaded models as selectable, and recommended-but-not-downloaded
 * models as visible but grayed out with install instructions.
 */

import chalk from "chalk";
import ansiEscapes from "ansi-escapes";
import type { SlashCommand, ReplSession } from "../types.js";
import { getProviderDefinition, getAllProviders } from "../providers-config.js";
import type { ProviderType } from "../../../providers/index.js";
import { getBaseUrl, saveProviderPreference } from "../../../config/env.js";

/**
 * Model item for interactive selection
 */
interface SelectableModel {
  id: string;
  name?: string;
  description?: string;
  recommended?: boolean;
  contextWindow?: number;
  disabled?: boolean;
  hint?: string;
}

/**
 * Fetch models from a local provider's /v1/models endpoint.
 * Returns an array of model ID strings, or empty array on failure.
 */
export async function fetchLocalModels(providerType: ProviderType): Promise<string[]> {
  try {
    const baseUrl = getBaseUrl(providerType);
    if (!baseUrl) return [];

    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return data.data?.map((m) => m.id) ?? [];
  } catch {
    return [];
  }
}

/**
 * Normalize a model ID for fuzzy comparison.
 * Strips colons (Ollama uses "model:size") and lowercases.
 * e.g. "qwen2.5-coder:14b" → "qwen2.5-coder-14b"
 */
function normalizeModelId(id: string): string {
  return id.toLowerCase().replace(/:/g, "-");
}

/**
 * Find a static model definition that matches a downloaded model ID.
 * Uses exact match first, then fuzzy match for LM Studio (which returns
 * IDs like "lmstudio-community/qwen3-coder-3b-instruct-GGUF").
 */
function findStaticModel(
  downloadedId: string,
  staticModels: Array<{
    id: string;
    name?: string;
    description?: string;
    recommended?: boolean;
    contextWindow?: number;
  }>,
): (typeof staticModels)[number] | undefined {
  // Exact match first (Ollama usually matches)
  const exact = staticModels.find((m) => m.id === downloadedId);
  if (exact) return exact;

  // Fuzzy match: normalize colons to dashes for comparison
  const normalizedDownloaded = normalizeModelId(downloadedId);
  return staticModels.find((m) => normalizedDownloaded.includes(normalizeModelId(m.id)));
}

/**
 * Check if a downloaded model ID matches a static model ID
 */
function isModelDownloaded(staticId: string, downloadedIds: string[]): boolean {
  const normalizedStatic = normalizeModelId(staticId);
  return downloadedIds.some(
    (d) => d === staticId || normalizeModelId(d).includes(normalizedStatic),
  );
}

/**
 * Build merged model list for local providers:
 * - Downloaded models first (selectable)
 * - Recommended but not downloaded models after separator (disabled)
 */
export function buildLocalModelList(
  downloadedIds: string[],
  staticModels: Array<{
    id: string;
    name?: string;
    description?: string;
    recommended?: boolean;
    contextWindow?: number;
  }>,
  providerType: "ollama" | "lmstudio",
): SelectableModel[] {
  // Section 1: Downloaded models (selectable)
  const downloaded: SelectableModel[] = downloadedIds.map((id) => {
    const staticDef = findStaticModel(id, staticModels);
    return {
      id,
      name: staticDef?.name,
      description: staticDef?.description,
      recommended: staticDef?.recommended,
      contextWindow: staticDef?.contextWindow,
      disabled: false,
    };
  });

  // Section 2: Recommended models NOT downloaded (disabled, with hint)
  const notDownloaded: SelectableModel[] = staticModels
    .filter((m) => !isModelDownloaded(m.id, downloadedIds))
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      recommended: m.recommended,
      contextWindow: m.contextWindow,
      disabled: true,
      hint: providerType === "ollama" ? `ollama pull ${m.id}` : `search '${m.id}' in LM Studio`,
    }));

  return [...downloaded, ...notDownloaded];
}

/**
 * Interactive model selector using arrow keys
 * Supports disabled items (visible but not selectable) with separator
 */
async function selectModelInteractively(
  models: SelectableModel[],
  currentModelId: string,
): Promise<string | null> {
  const enabledModels = models.filter((m) => !m.disabled);
  if (enabledModels.length === 0 && models.length === 0) return null;

  return new Promise((resolve) => {
    // Find initial selection — must land on an enabled item
    let selectedIndex = models.findIndex((m) => m.id === currentModelId && !m.disabled);
    if (selectedIndex === -1) {
      // Find first enabled item
      selectedIndex = models.findIndex((m) => !m.disabled);
      if (selectedIndex === -1) selectedIndex = 0;
    }

    const hasDisabled = models.some((m) => m.disabled);
    const hasEnabled = models.some((m) => !m.disabled);

    /** Skip to next enabled model in a given direction */
    const skipToEnabled = (from: number, direction: 1 | -1): number => {
      if (!hasEnabled) return from;
      let idx = from;
      do {
        idx = (idx + direction + models.length) % models.length;
      } while (models[idx]?.disabled);
      return idx;
    };

    const renderMenu = () => {
      process.stdout.write(ansiEscapes.eraseDown);
      let totalLines = 0;
      let separatorPrinted = false;

      for (let i = 0; i < models.length; i++) {
        const model = models[i]!;
        const isCurrent = model.id === currentModelId;
        const isSelected = i === selectedIndex;

        // Print separator before first disabled item
        if (model.disabled && !separatorPrinted) {
          console.log(chalk.dim("  ── not downloaded (install to use) ──"));
          separatorPrinted = true;
          totalLines++;
        }

        if (model.disabled) {
          // Disabled item — grayed out with description (RAM info) and hint
          let line = chalk.dim("   ○ ");
          line += chalk.dim(model.id.padEnd(30));
          const star = model.recommended ? chalk.dim(" ⭐") : "   ";
          const ctx = model.contextWindow
            ? chalk.dim(` ${Math.round(model.contextWindow / 1000)}K`)
            : "";
          line += star + ctx;
          // Show description (contains RAM requirements) + install hint
          if (model.description) {
            line += chalk.dim(`  ${model.description}`);
          }
          if (model.hint) {
            line += chalk.dim.italic(`  → ${model.hint}`);
          }
          console.log(line);
          totalLines++;
          continue;
        }

        // Enabled item — normal rendering
        let line = "";
        if (isSelected) {
          line += chalk.bgBlue.white(" ▶ ");
          line += chalk.bgBlue.white(model.id.padEnd(30));
        } else {
          const marker = isCurrent ? chalk.green(" ● ") : chalk.dim(" ○ ");
          line += marker;
          line += isCurrent ? chalk.green(model.id.padEnd(30)) : model.id.padEnd(30);
        }

        const star = model.recommended ? chalk.magenta(" ⭐") : "";
        const ctx = model.contextWindow
          ? chalk.dim(` ${Math.round(model.contextWindow / 1000)}K`)
          : "";
        line += star + ctx;

        // Show description (RAM info, etc.) for all items
        if (model.description) {
          line += chalk.dim(`  ${model.description}`);
        }

        console.log(line);
        totalLines++;
      }

      const footer = hasDisabled
        ? "↑/↓ navigate • Enter select • Esc cancel"
        : "↑/↓ navigate • Enter select • Esc cancel";
      console.log(chalk.dim(`\n${footer}`));
      totalLines += 2; // blank line + footer

      process.stdout.write(ansiEscapes.cursorUp(totalLines));
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

      // Enter - select (only if not disabled)
      if (key === "\r" || key === "\n") {
        if (!models[selectedIndex]?.disabled) {
          cleanup();
          resolve(models[selectedIndex]!.id);
        }
        return;
      }

      // Up arrow — skip disabled items
      if (key === "\x1b[A") {
        selectedIndex = skipToEnabled(selectedIndex, -1);
        process.stdout.write(ansiEscapes.eraseDown);
        renderMenu();
        return;
      }

      // Down arrow — skip disabled items
      if (key === "\x1b[B") {
        selectedIndex = skipToEnabled(selectedIndex, 1);
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

      // Build model list — for local providers, query server for downloaded models
      const isLocalProvider = currentProvider === "ollama" || currentProvider === "lmstudio";
      let modelsForSelection: SelectableModel[];

      if (isLocalProvider) {
        const downloadedIds = await fetchLocalModels(currentProvider);

        if (downloadedIds.length > 0) {
          modelsForSelection = buildLocalModelList(
            downloadedIds,
            providerDef.models,
            currentProvider,
          );
        } else {
          // Server not running or no models — fall back to static list
          console.log(chalk.dim("(Could not reach local server — showing recommended models)\n"));
          modelsForSelection = providerDef.models;
        }
      } else {
        modelsForSelection = providerDef.models;
      }

      if (modelsForSelection.length === 0) {
        console.log(chalk.dim("No predefined models. Use: /model <model-name>\n"));
        return false;
      }

      const selectedModel = await selectModelInteractively(
        modelsForSelection,
        session.config.provider.model,
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

      // Save preference for next session
      await saveProviderPreference(currentProvider, selectedModel);

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

      // Save preference for next session
      await saveProviderPreference(currentProvider, newModel);

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

    // Save preference for next session
    await saveProviderPreference(currentProvider, newModel);

    const modelInfo = providerDef.models.find((m) => m.id === newModel);
    console.log(chalk.green(`✓ Switched to ${modelInfo?.name ?? newModel}\n`));

    return false;
  },
};
