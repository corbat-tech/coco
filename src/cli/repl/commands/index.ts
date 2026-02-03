/**
 * Slash command registry
 */

import type { SlashCommand, ReplSession } from "../types.js";
import { helpCommand } from "./help.js";
import { clearCommand } from "./clear.js";
import { exitCommand } from "./exit.js";
import { modelCommand } from "./model.js";
import { statusCommand } from "./status.js";
import { diffCommand } from "./diff.js";
import { commitCommand } from "./commit.js";
import { compactCommand } from "./compact.js";
import { costCommand } from "./cost.js";
import { undoCommand } from "./undo.js";
import { renderError } from "../output/renderer.js";

/**
 * All registered commands
 */
const commands: SlashCommand[] = [
  helpCommand,
  clearCommand,
  exitCommand,
  modelCommand,
  statusCommand,
  diffCommand,
  commitCommand,
  compactCommand,
  costCommand,
  undoCommand,
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
  return commands.find(
    (cmd) => cmd.name === name || cmd.aliases.includes(name)
  );
}

/**
 * Execute a slash command
 * Returns true if REPL should exit
 */
export async function executeSlashCommand(
  commandName: string,
  args: string[],
  session: ReplSession
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
