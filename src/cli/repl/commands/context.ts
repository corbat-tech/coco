/**
 * /context command — Show context window usage metrics
 *
 * Displays current token usage, context limit, and recommendations.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { getRepoContext } from "../../../tools/repo-intelligence.js";

export const contextCommand: SlashCommand = {
  name: "context",
  aliases: ["ctx"],
  description: "Show context window usage metrics",
  usage: "/context [why|add <file>|remove <file>]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === "why") {
      const query =
        args.slice(1).join(" ").trim() ||
        [...session.messages]
          .reverse()
          .find((message) => message.role === "user" && typeof message.content === "string")
          ?.content.toString() ||
        "current task";

      const result = await getRepoContext({
        path: session.projectPath,
        query,
        budget: 8,
        refresh: false,
      });

      console.log(chalk.cyan.bold("\n Context Selection\n"));
      console.log(chalk.dim(`  Query: ${result.query}`));
      console.log(chalk.dim(`  Repo index: ${result.graph.generatedAt}\n`));

      for (const item of result.items) {
        console.log(`${chalk.green(item.score.toFixed(1).padStart(5))}  ${chalk.cyan(item.path)}`);
        console.log(chalk.dim(`       ${item.reasons.join(", ") || "ranked context"}`));
      }
      console.log();
      return false;
    }

    if (subcommand === "add" || subcommand === "remove") {
      const file = args.slice(1).join(" ").trim();
      if (!file) {
        console.log(chalk.red(`Usage: /context ${subcommand} <file>\n`));
        return false;
      }

      const action = subcommand === "add" ? "include" : "exclude";
      session.messages.push({
        role: "user",
        content: `[context directive] ${action} ${file} when selecting task context.`,
      });
      console.log(chalk.green(`Context directive recorded: ${action} ${file}\n`));
      return false;
    }

    const cm = session.contextManager;

    if (!cm) {
      console.log(chalk.yellow("Context manager not initialized.\n"));
      return false;
    }

    // Get context stats from context manager
    const stats = (cm as any).getStats?.();
    const msgCount = session.messages.length;

    // Count messages by type
    let userMsgs = 0;
    let assistantMsgs = 0;
    let toolUseMsgs = 0;
    let toolResultMsgs = 0;

    for (const msg of session.messages) {
      if (msg.role === "user") {
        if (Array.isArray(msg.content) && msg.content.some((b: any) => b.type === "tool_result")) {
          toolResultMsgs++;
        } else {
          userMsgs++;
        }
      } else if (msg.role === "assistant") {
        if (Array.isArray(msg.content) && msg.content.some((b: any) => b.type === "tool_use")) {
          toolUseMsgs++;
        } else {
          assistantMsgs++;
        }
      }
    }

    console.log(chalk.cyan.bold("\n Context Window Usage\n"));

    if (stats) {
      const used = stats.tokensUsed ?? 0;
      const limit = stats.contextLimit ?? 200000;
      const pct = Math.round((used / limit) * 100);
      const bar = buildProgressBar(pct);

      console.log(`  ${bar} ${pct}% used`);
      console.log(chalk.dim(`  ${used.toLocaleString()} / ${limit.toLocaleString()} tokens`));
      console.log();

      if (pct > 70) {
        console.log(chalk.yellow("  Recommendation: Run /compact to free up context space"));
      }
    }

    console.log(chalk.dim("  Messages breakdown:"));
    console.log(chalk.dim(`    Total:        ${msgCount}`));
    console.log(chalk.dim(`    User:         ${userMsgs}`));
    console.log(chalk.dim(`    Assistant:    ${assistantMsgs}`));
    console.log(chalk.dim(`    Tool calls:   ${toolUseMsgs}`));
    console.log(chalk.dim(`    Tool results: ${toolResultMsgs}`));
    console.log();

    return false;
  },
};

/**
 * Build a simple text progress bar
 */
function buildProgressBar(pct: number): string {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;

  const color = pct > 80 ? chalk.red : pct > 60 ? chalk.yellow : chalk.green;
  const filledStr = color("█".repeat(filled));
  const emptyStr = chalk.dim("░".repeat(empty));

  return `[${filledStr}${emptyStr}]`;
}
