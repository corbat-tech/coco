/**
 * /copy command - Copy last response to clipboard
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";
import { getRawMarkdown } from "../output/renderer.js";
import { copyToClipboard, isClipboardAvailable } from "../output/clipboard.js";

export const copyCommand: SlashCommand = {
  name: "copy",
  aliases: ["cp"],
  description: "Copy last response to clipboard",
  usage: "/copy",

  async execute(): Promise<boolean> {
    const clipboardAvailable = await isClipboardAvailable();

    if (!clipboardAvailable) {
      console.log(chalk.red("  ✗ Clipboard not available on this system"));
      console.log(chalk.dim("    macOS: pbcopy, Linux: xclip or xsel, Windows: clip"));
      return false;
    }

    const rawMarkdown = getRawMarkdown();

    if (!rawMarkdown.trim()) {
      console.log(chalk.yellow("  ⚠ No response to copy"));
      console.log(chalk.dim("    Ask a question first, then use /copy"));
      return false;
    }

    // Extract markdown code block if present, otherwise use full response
    let contentToCopy = rawMarkdown;
    const markdownBlockMatch = rawMarkdown.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
    if (markdownBlockMatch && markdownBlockMatch[1]) {
      contentToCopy = markdownBlockMatch[1].trim();
    }

    const lines = contentToCopy.split("\n").length;
    const chars = contentToCopy.length;

    const success = await copyToClipboard(contentToCopy);

    if (success) {
      console.log(chalk.green(`  ✓ Copied to clipboard`));
      console.log(chalk.dim(`    ${lines} lines, ${chars} characters`));
    } else {
      console.log(chalk.red("  ✗ Failed to copy to clipboard"));
      console.log(chalk.dim(`    Content: ${chars} chars, ${lines} lines`));
    }

    return false;
  },
};
