/**
 * /stats command — lightweight session observability dashboard.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { getProviderRuntimeCapability } from "../../../providers/runtime-capabilities.js";

export const statsCommand: SlashCommand = {
  name: "stats",
  aliases: [],
  description: "Show session observability stats",
  usage: "/stats",

  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    let userMessages = 0;
    let assistantMessages = 0;
    let toolUseMessages = 0;
    let toolResultMessages = 0;

    for (const message of session.messages) {
      if (message.role === "user") {
        if (
          Array.isArray(message.content) &&
          message.content.some((block) => block.type === "tool_result")
        ) {
          toolResultMessages++;
        } else {
          userMessages++;
        }
      }
      if (message.role === "assistant") {
        if (
          Array.isArray(message.content) &&
          message.content.some((block) => block.type === "tool_use")
        ) {
          toolUseMessages++;
        } else {
          assistantMessages++;
        }
      }
    }

    const runtime = getProviderRuntimeCapability(
      session.config.provider.type,
      session.config.provider.model,
    );

    console.log(chalk.cyan.bold("\n═══ Session Stats ═══\n"));
    console.log(`  Provider: ${chalk.cyan(session.config.provider.type)}`);
    console.log(`  Model: ${chalk.cyan(session.config.provider.model)}`);
    console.log(`  Endpoint: ${chalk.yellow(runtime.endpoint)}`);
    console.log(`  Mode: ${session.agentMode ?? (session.planMode ? "plan" : "build")}`);
    console.log();
    console.log(chalk.dim("  Messages:"));
    console.log(chalk.dim(`    user:          ${userMessages}`));
    console.log(chalk.dim(`    assistant:     ${assistantMessages}`));
    console.log(chalk.dim(`    tool calls:    ${toolUseMessages}`));
    console.log(chalk.dim(`    tool results:  ${toolResultMessages}`));
    console.log();
    return false;
  },
};
