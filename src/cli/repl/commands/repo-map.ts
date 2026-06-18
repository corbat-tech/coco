/**
 * /repo-map command — ranked repository context from the repo intelligence graph.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { getRepoContext } from "../../../tools/repo-intelligence.js";

function modeFromSession(session: ReplSession) {
  if (session.planMode) return "plan" as const;
  return undefined;
}

export const repoMapCommand: SlashCommand = {
  name: "repo-map",
  aliases: ["repomap", "repo-context"],
  description: "Show ranked repository context for a query",
  usage: "/repo-map [refresh] [query]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const refresh = args[0]?.toLowerCase() === "refresh";
    const query = (refresh ? args.slice(1) : args).join(" ").trim() || "project architecture";

    const result = await getRepoContext({
      path: session.projectPath,
      query,
      mode: modeFromSession(session),
      refresh,
      budget: 12,
    });

    console.log(chalk.cyan.bold("\n═══ Repo Map ═══\n"));
    console.log(chalk.dim(`  Root: ${result.graph.root}`));
    console.log(chalk.dim(`  Indexed: ${result.graph.totalFiles} files`));
    console.log(chalk.dim(`  Definitions: ${result.graph.totalDefinitions}`));
    console.log(chalk.dim(`  Cache: ${result.graph.generatedAt}`));
    console.log(`  Query: ${chalk.cyan(result.query)}\n`);

    if (result.items.length === 0) {
      console.log(chalk.yellow("  No ranked files matched this query.\n"));
      return false;
    }

    for (const item of result.items) {
      const reasons = item.reasons.length > 0 ? chalk.dim(`  ${item.reasons.join(", ")}`) : "";
      console.log(
        `  ${chalk.green(item.score.toFixed(1).padStart(5))}  ` +
          `${chalk.cyan(item.path)} ${reasons}`,
      );
      const symbols = item.definitions
        .slice(0, 4)
        .map((def) => `${def.name}:${def.type}`)
        .join(", ");
      if (symbols) {
        console.log(chalk.dim(`         ${symbols}`));
      }
    }

    console.log();
    return false;
  },
};
