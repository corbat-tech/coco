/**
 * /image command - Paste image from clipboard and send to LLM
 *
 * Usage:
 *   /image              — Paste clipboard image with default prompt
 *   /image describe UI  — Paste clipboard image with custom prompt
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";
import { readClipboardImage, isClipboardImageAvailable } from "../output/clipboard.js";

/**
 * Shared state: stores pending images for the next agent turn.
 * Each Ctrl+V or /image call appends to this array.
 * The REPL main loop consumes all pending images at once via consumePendingImages().
 */
type PendingImage = { data: string; media_type: string; prompt: string };
let pendingImages: PendingImage[] = [];

/**
 * Get and clear all pending images (consumed by the REPL loop).
 * Returns the full array and resets state.
 */
export function consumePendingImages(): PendingImage[] {
  const imgs = pendingImages;
  pendingImages = [];
  return imgs;
}

/**
 * Check if there are any pending images
 */
export function hasPendingImage(): boolean {
  return pendingImages.length > 0;
}

/**
 * Get the number of pending images (used by prompt indicator)
 */
export function getPendingImageCount(): number {
  return pendingImages.length;
}

/**
 * Append a pending image (used by Ctrl+V keybinding and /image command).
 * Multiple calls accumulate images — all sent together on the next agent turn.
 */
export function setPendingImage(data: string, media_type: string, prompt: string): void {
  pendingImages.push({ data, media_type, prompt });
}

export const imageCommand: SlashCommand = {
  name: "image",
  aliases: ["img", "paste-image"],
  description: "Paste image from clipboard and send to LLM",
  usage: "/image [prompt]  (e.g. /image describe this UI)",

  async execute(args): Promise<boolean> {
    const available = isClipboardImageAvailable();

    if (!available) {
      console.log(chalk.red("  ✗ Clipboard image reading not available on this platform"));
      console.log(chalk.dim("    macOS: built-in, Linux: requires xclip, Windows: built-in"));
      return false;
    }

    console.log(chalk.dim("  📋 Reading clipboard image…"));

    const imageData = await readClipboardImage();

    if (!imageData) {
      console.log(chalk.yellow("  ⚠ No image found in clipboard"));
      console.log(
        chalk.dim("    Copy an image first (screenshot, browser image, etc.), then use /image"),
      );
      return false;
    }

    // Calculate approximate original image size from base64
    const sizeKB = Math.round((imageData.data.length * 3) / 4 / 1024);

    const prompt =
      args.length > 0
        ? args.join(" ")
        : "Describe this image in detail. If it's code or a UI, identify the key elements.";

    console.log(
      chalk.green("  ✓ Image captured from clipboard") +
        chalk.dim(` (${sizeKB} KB, ${imageData.media_type})`),
    );
    console.log(chalk.dim(`  Prompt: "${prompt}"`));

    // Store the pending image for the REPL loop to consume
    setPendingImage(imageData.data, imageData.media_type, prompt);

    // Return false = don't exit REPL
    // The REPL main loop checks hasPendingImage() after command execution
    return false;
  },
};
