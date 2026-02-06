/**
 * Slash command registry
 */

import type { SlashCommand, ReplSession } from "../types.js";
import { helpCommand } from "./help.js";
import { clearCommand } from "./clear.js";
import { exitCommand } from "./exit.js";
import { modelCommand } from "./model.js";
import { providerCommand } from "./provider.js";
import { statusCommand } from "./status.js";
import { diffCommand } from "./diff.js";
import { commitCommand } from "./commit.js";
import { compactCommand } from "./compact.js";
import { costCommand } from "./cost.js";
import { undoCommand } from "./undo.js";
import { trustCommand } from "./trust.js";
import { initCommand } from "./init.js";
import { planCommand } from "./plan.js";
import { buildCommand } from "./build.js";
import { taskCommand } from "./task.js";
import { outputCommand } from "./output.js";
import { tasksCommand } from "./tasks.js";
import { memoryCommand } from "./memory.js";
import { rewindCommand } from "./rewind.js";
import { resumeCommand } from "./resume.js";
import { updateCommand } from "./update.js";
import { copyCommand } from "./copy.js";
import { allowPathCommand } from "./allow-path.js";
import { renderError } from "../output/renderer.js";

/**
 * All registered commands
 */
const commands: SlashCommand[] = [
  helpCommand,
  clearCommand,
  exitCommand,
  providerCommand,
  modelCommand,
  statusCommand,
  diffCommand,
  commitCommand,
  compactCommand,
  costCommand,
  undoCommand,
  trustCommand,
  initCommand,
  planCommand,
  buildCommand,
  taskCommand,
  outputCommand,
  tasksCommand,
  memoryCommand,
  rewindCommand,
  resumeCommand,
  updateCommand,
  copyCommand,
  allowPathCommand,
];

/**
 * Check if input is a slash command
 */
export function isSlashCommand(input: string): boolean {
  return input.startsWith("/");
}

/**
 * Parse slash command from input
 */
export function parseSlashCommand(input: string): {
  command: string;
  args: string[];
} {
  const parts = input.slice(1).split(/\s+/);
  return {
    command: parts[0]?.toLowerCase() ?? "",
    args: parts.slice(1),
  };
}

/**
 * Find command by name or alias
 */
function findCommand(name: string): SlashCommand | undefined {
  return commands.find((cmd) => cmd.name === name || cmd.aliases.includes(name));
}

/**
 * Execute a slash command
 * Returns true if REPL should exit
 */
export async function executeSlashCommand(
  commandName: string,
  args: string[],
  session: ReplSession,
): Promise<boolean> {
  const command = findCommand(commandName);

  if (!command) {
    renderError(`Unknown command: /${commandName}. Type /help for available commands.`);
    return false;
  }

  return command.execute(args, session);
}

/**
 * Get all commands (for help display)
 */
export function getAllCommands(): SlashCommand[] {
  return commands;
}

// Re-export utilities
export { addTokenUsage, resetTokenUsage, getTokenUsage } from "./cost.js";
export { isCompactMode } from "./compact.js";
