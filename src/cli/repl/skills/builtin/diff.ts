/**
 * Diff Skill
 *
 * Visual diff rendering from the REPL. Replaces the legacy /diff command
 * with box-style formatting, syntax highlighting, and branch comparison.
 *
 * Usage:
 *   /diff                        Unstaged changes
 *   /diff --staged               Staged changes
 *   /diff main                   Current branch vs main
 *   /diff main feature           Compare two refs
 *   /diff --file src/app.ts      Diff a specific file
 */

import chalk from "chalk";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import { showDiffTool } from "../../../../tools/diff.js";

function parseArgs(args: string): {
  staged: boolean;
  base?: string;
  ref?: string;
  files: string[];
  compact: boolean;
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let staged = false;
  let base: string | undefined;
  let ref: string | undefined;
  const files: string[] = [];
  let compact = false;

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;

    if (token === "--staged" || token === "-s") {
      staged = true;
    } else if (token === "--compact" || token === "-c") {
      compact = true;
    } else if (token === "--file" || token === "-f") {
      i++;
      if (tokens[i]) files.push(tokens[i]!);
    } else if (!token.startsWith("-")) {
      // Positional args: first = base, second = ref
      if (!base) {
        base = token;
      } else if (!ref) {
        ref = token;
      }
    }
    i++;
  }

  return { staged, base, ref, files, compact };
}

export const diffSkill: Skill = {
  name: "diff",
  description: "Show visual diff with syntax highlighting",
  usage: "/diff [base] [ref] [--staged] [--file path] [--compact]",
  aliases: ["d"],
  category: "git",

  async execute(args: string, context: SkillContext): Promise<SkillResult> {
    const { staged, base, ref, files, compact } = parseArgs(args);

    try {
      const result = await showDiffTool.execute({
        cwd: context.cwd,
        staged,
        base,
        ref,
        files: files.length > 0 ? files : undefined,
        compact,
      });

      if (result.filesChanged === 0) {
        return { success: true, output: "No changes" };
      }

      return {
        success: true,
        output: `${result.filesChanged} files, +${result.additions} -${result.deletions}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n  Error: ${message}\n`));
      return { success: false, error: message };
    }
  },
};
