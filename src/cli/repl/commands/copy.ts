/**
 * /copy [N] — Copy a code block to clipboard.
 *
 * - /copy or /cp       → copies the last rendered code block
 * - /copy N or /cp N   → copies block #N by its sequential ID
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";
import { getBlock, getLastBlock, getBlockCount } from "../output/block-store.js";
import { copyToClipboard, isClipboardAvailable } from "../output/clipboard.js";

export const copyCommand: SlashCommand = {
  name: "copy",
  aliases: ["cp"],
  description: "Copy code block to clipboard (last or #N)",
  usage: "/copy [N]",

  async execute(args: string[]): Promise<boolean> {
    const clipboardAvailable = await isClipboardAvailable();

    if (!clipboardAvailable) {
      console.log(chalk.red("  ✗ Clipboard not available on this system"));
      console.log(chalk.dim("    macOS: pbcopy, Linux: xclip or xsel, Windows: clip"));
      return false;
    }

    const rawArg = args[0];
    const hasArg = rawArg !== undefined && rawArg !== "";
    const blockNum = hasArg ? Number(rawArg) : NaN;
    const isValidId = hasArg && Number.isInteger(blockNum) && blockNum > 0;

    if (hasArg && !isValidId) {
      console.log(chalk.yellow(`  ⚠ Invalid block number "${rawArg}"`));
      console.log(
        chalk.dim("    Use /copy N where N is a positive integer, or /copy for the last block"),
      );
      return false;
    }

    // Resolve which block to copy
    const block = isValidId ? getBlock(blockNum) : getLastBlock();

    if (!block) {
      if (isValidId) {
        const count = getBlockCount();
        console.log(
          chalk.yellow(`  ⚠ Block #${blockNum} not found`) +
            chalk.dim(` (${count} block${count === 1 ? "" : "s"} available)`),
        );
      } else {
        console.log(chalk.yellow("  ⚠ No code blocks to copy"));
        console.log(chalk.dim("    Code blocks appear as you chat — then use /copy or Option+C"));
      }
      return false;
    }

    const success = await copyToClipboard(block.content);

    if (success) {
      const lang = block.lang || "code";
      console.log(chalk.green(`  ✓ ${lang} #${block.id} copied`));
    } else {
      console.log(chalk.red("  ✗ Failed to copy to clipboard"));
    }

    return false;
  },
};
