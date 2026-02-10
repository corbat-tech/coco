/**
 * Open / Execute Skill
 *
 * Opens files with the system default application or executes
 * scripts and binaries from the REPL.
 *
 * Usage:
 *   /open docs/index.html           Open in browser
 *   /open screenshot.png            Open in image viewer
 *   /open --exec scripts/setup.sh   Execute a shell script
 *   /open -x deploy.py -- --env prod  Execute with arguments
 *   /run build.sh                   Alias for /open --exec
 */

import chalk from "chalk";
import * as p from "@clack/prompts";
import type { Skill, SkillContext, SkillResult } from "../types.js";
import { openFileTool } from "../../../../tools/open.js";

function parseArgs(args: string): {
  filePath: string;
  mode: "open" | "exec";
  scriptArgs: string[];
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let filePath = "";
  let mode: "open" | "exec" = "open";
  const scriptArgs: string[] = [];
  let collectingArgs = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (token === "--exec" || token === "-x") {
      mode = "exec";
    } else if (token === "--") {
      collectingArgs = true;
    } else if (collectingArgs) {
      scriptArgs.push(token);
    } else if (!token.startsWith("-") && !filePath) {
      filePath = token;
    }
  }

  return { filePath, mode, scriptArgs };
}

export const openSkill: Skill = {
  name: "open",
  description: "Open a file or execute a script",
  usage: "/open <path> [--exec] [-- args...]",
  aliases: ["run", "exec"],
  category: "general",

  async execute(args: string, context: SkillContext): Promise<SkillResult> {
    // When called via /run or /exec alias, default to exec mode
    const calledAsExec = /^\s*--exec\b/.test(args) || false;
    const { filePath, mode: parsedMode, scriptArgs } = parseArgs(args);

    // If the skill was invoked but no --exec flag, keep parsed mode
    const mode = calledAsExec ? "exec" : parsedMode;

    if (!filePath) {
      return {
        success: false,
        error: "Please specify a file path. Usage: /open <path> [--exec] [-- args...]",
      };
    }

    try {
      const result = await openFileTool.execute({
        path: filePath,
        mode,
        args: scriptArgs,
        cwd: context.cwd,
      });

      if (result.action === "opened") {
        const output = `Opened ${result.path} with ${result.resolvedCommand}`;
        p.log.success(output);
        return { success: true, output };
      }

      // Executed
      let output = `Executed ${result.path}`;
      if (result.exitCode !== undefined && result.exitCode !== 0) {
        output += ` (exit code: ${result.exitCode})`;
      }
      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.error(chalk.yellow(result.stderr));
      }
      return {
        success: result.exitCode === 0,
        output,
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(message);
      return { success: false, error: message };
    }
  },
};
