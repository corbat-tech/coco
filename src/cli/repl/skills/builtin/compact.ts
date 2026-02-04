/**
 * Compact Skill
 *
 * Manually triggers context compaction to reduce token usage
 * by summarizing older conversation history.
 */

import chalk from "chalk";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import {
  checkAndCompactContext,
  getContextUsagePercent,
  getContextUsageFormatted,
} from "../../session.js";

/**
 * Compact skill for manually triggering context compaction
 */
export const compactSkill: Skill = {
  name: "compact",
  description: "Compact conversation context to reduce token usage",
  usage: "/compact [--force]",
  aliases: [],
  category: "model",

  async execute(args: string, context: SkillContext): Promise<SkillResult> {
    const force = args.includes("--force") || args.includes("-f");

    // Check if provider is available
    if (!context.provider) {
      return {
        success: false,
        error: "No provider available for context compaction",
      };
    }

    // Get current usage
    const usageBefore = getContextUsagePercent(context.session);
    const usageStrBefore = getContextUsageFormatted(context.session);

    // Check if compaction is needed
    if (!force && usageBefore < 50) {
      return {
        success: true,
        output: chalk.dim(
          `Context usage is ${usageStrBefore} (${usageBefore.toFixed(0)}%). ` +
            `No compaction needed.\n` +
            `Use /compact --force to compact anyway.\n`
        ),
      };
    }

    // Perform compaction
    try {
      const result = await checkAndCompactContext(
        context.session,
        context.provider
      );

      if (!result || !result.wasCompacted) {
        return {
          success: true,
          output: chalk.dim(
            `Context is already optimized. No compaction performed.\n`
          ),
        };
      }

      const usageStrAfter = getContextUsageFormatted(context.session);
      const savedTokens = result.originalTokens - result.compactedTokens;
      const savedPercent =
        ((result.originalTokens - result.compactedTokens) /
          result.originalTokens) *
        100;

      const lines: string[] = [
        chalk.green("Context compacted successfully!\n"),
        "",
        chalk.dim("Before: ") + usageStrBefore,
        chalk.dim("After:  ") + usageStrAfter,
        "",
        chalk.dim(
          `Saved ${savedTokens.toLocaleString()} tokens (${savedPercent.toFixed(0)}%)`
        ),
        chalk.dim(
          `Messages: ${result.messages.length} in compacted context`
        ),
        "",
      ];

      return {
        success: true,
        output: lines.join("\n"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to compact context: ${message}`,
      };
    }
  },
};
