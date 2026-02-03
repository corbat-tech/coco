/**
 * /cost command - Show token usage and estimated cost
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

// Token usage tracking
let sessionTokens = {
  input: 0,
  output: 0,
};

export function addTokenUsage(input: number, output: number): void {
  sessionTokens.input += input;
  sessionTokens.output += output;
}

export function resetTokenUsage(): void {
  sessionTokens = { input: 0, output: 0 };
}

export function getTokenUsage(): { input: number; output: number } {
  return { ...sessionTokens };
}

// Approximate pricing (USD per 1M tokens) - as of 2025
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  default: { input: 3, output: 15 },
};

export const costCommand: SlashCommand = {
  name: "cost",
  aliases: ["tokens", "usage"],
  description: "Show token usage and estimated cost",
  usage: "/cost",

  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    const model = session.config.provider.model;
    const pricing = PRICING[model] ?? PRICING["default"]!;

    const inputCost = (sessionTokens.input / 1_000_000) * pricing.input;
    const outputCost = (sessionTokens.output / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;

    console.log(chalk.cyan.bold("\n═══ Session Usage ═══\n"));

    console.log(chalk.dim("Model: ") + model);
    console.log();

    console.log(chalk.dim("Tokens:"));
    console.log(`  Input:  ${formatNumber(sessionTokens.input)}`);
    console.log(`  Output: ${formatNumber(sessionTokens.output)}`);
    console.log(`  Total:  ${formatNumber(sessionTokens.input + sessionTokens.output)}`);
    console.log();

    console.log(chalk.dim("Estimated cost:"));
    console.log(`  Input:  $${inputCost.toFixed(4)}`);
    console.log(`  Output: $${outputCost.toFixed(4)}`);
    console.log(chalk.bold(`  Total:  $${totalCost.toFixed(4)}`));
    console.log();

    return false;
  },
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}
