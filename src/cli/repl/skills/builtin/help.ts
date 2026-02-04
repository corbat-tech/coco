/**
 * Help Skill
 *
 * Displays available skills/commands grouped by category.
 */

import chalk from "chalk";
import type { Skill, SkillContext, SkillResult, SkillCategory } from "../types.js";
import type { SkillRegistry } from "../registry.js";

/**
 * Create the help skill
 * @param registry - Skill registry to get skills from
 */
export function createHelpSkill(registry: SkillRegistry): Skill {
  return {
    name: "help",
    description: "Show available commands",
    usage: "/help [command]",
    aliases: ["h", "?"],
    category: "general",

    async execute(args: string, _context: SkillContext): Promise<SkillResult> {
      const targetCommand = args.trim();

      // If a specific command is requested, show its help
      if (targetCommand) {
        const skill = registry.get(targetCommand);
        if (!skill) {
          return {
            success: false,
            error: `Unknown command: /${targetCommand}`,
          };
        }

        const lines: string[] = [
          "",
          chalk.cyan.bold(`/${skill.name}`),
          "",
          skill.description,
          "",
          chalk.dim("Usage:"),
          `  ${skill.usage ?? `/${skill.name}`}`,
        ];

        if (skill.aliases && skill.aliases.length > 0) {
          lines.push("");
          lines.push(chalk.dim("Aliases:"));
          lines.push(`  ${skill.aliases.map((a) => `/${a}`).join(", ")}`);
        }

        lines.push("");

        return {
          success: true,
          output: lines.join("\n"),
        };
      }

      // Show all skills grouped by category
      const byCategory = registry.getByCategory();
      const lines: string[] = [chalk.cyan.bold("\n=== Coco Commands ===\n")];

      // Define category display order and labels
      const categoryOrder: Array<{
        key: string;
        label: string;
      }> = [
        { key: "coco", label: "COCO Phases" },
        { key: "general", label: "General" },
        { key: "model", label: "Model & Settings" },
        { key: "git", label: "Git" },
        { key: "debug", label: "Debug" },
        { key: "custom", label: "Custom" },
      ];

      for (const { key, label } of categoryOrder) {
        const skills = byCategory.get(key as SkillCategory);
        if (!skills || skills.length === 0) continue;

        lines.push(chalk.bold(label));

        for (const skill of skills) {
          const names = [skill.name, ...(skill.aliases ?? [])];
          const nameStr = names.map((n) => `/${n}`).join(", ");
          lines.push(
            `  ${chalk.yellow(nameStr.padEnd(22))} ${chalk.dim(skill.description)}`
          );
        }

        lines.push("");
      }

      lines.push(chalk.dim("Tips:"));
      lines.push(chalk.dim("  - Type naturally to interact with the agent"));
      lines.push(
        chalk.dim("  - The agent can read/write files, run commands, and more")
      );
      lines.push(chalk.dim("  - Use Ctrl+D or /exit to quit"));
      lines.push("");

      return {
        success: true,
        output: lines.join("\n"),
      };
    },
  };
}
