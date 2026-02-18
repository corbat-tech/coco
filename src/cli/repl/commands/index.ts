/**
 * Slash command registry
 *
 * Integrates two command systems:
 * 1. SlashCommands (legacy) — direct command implementations
 * 2. SkillRegistry — modular skill system with aliases and categories
 *
 * When a command is not found in the SlashCommand array, the SkillRegistry
 * is consulted as a fallback. This ensures skills like /open, /review, and
 * /ship are reachable from the REPL.
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
import { permissionsCommand } from "./permissions.js";
import { cocoCommand } from "./coco.js";
import { fullAccessCommand } from "./full-access.js";
import { updateCocoCommand } from "./update-coco.js";
import { imageCommand } from "./image.js";
import { tutorialCommand } from "./tutorial.js";
import { renderError } from "../output/renderer.js";
import { createDefaultRegistry } from "../skills/index.js";
import type { SkillRegistry } from "../skills/index.js";

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
  permissionsCommand,
  cocoCommand,
  fullAccessCommand,
  updateCocoCommand,
  imageCommand,
  tutorialCommand,
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

// ============================================================================
// Skill registry integration (lazy-initialized singleton)
// ============================================================================

let skillRegistry: SkillRegistry | undefined;

/**
 * Get or create the skill registry singleton.
 * Lazy-initialized to avoid circular dependencies at module load time.
 */
function getSkillRegistry(): SkillRegistry {
  if (!skillRegistry) {
    skillRegistry = createDefaultRegistry();
  }
  return skillRegistry;
}

/**
 * Execute a slash command.
 *
 * Resolution order:
 * 1. Look up in the legacy SlashCommand array (exact name or alias match)
 * 2. Fall back to the SkillRegistry (supports skills like /open, /review, /ship)
 *
 * Returns true if REPL should exit.
 */
export async function executeSlashCommand(
  commandName: string,
  args: string[],
  session: ReplSession,
): Promise<boolean> {
  // 1. Try legacy commands first
  const command = findCommand(commandName);
  if (command) {
    return command.execute(args, session);
  }

  // 2. Fall back to skill registry
  const registry = getSkillRegistry();
  const skill = registry.get(commandName);

  if (skill) {
    const argsString = args.join(" ");
    const result = await registry.execute(commandName, argsString, {
      cwd: session.projectPath,
      session,
      config: session.config,
    });

    if (result.error) {
      renderError(result.error);
    }

    return result.shouldExit ?? false;
  }

  // 3. Nothing found
  renderError(`Unknown command: /${commandName}. Type /help for available commands.`);
  return false;
}

/**
 * Get all commands (for help display).
 * Includes both legacy commands and skills from the registry.
 */
export function getAllCommands(): SlashCommand[] {
  return commands;
}

/**
 * Get the skill registry for external access (e.g., help display).
 */
export function getRegisteredSkills(): SkillRegistry {
  return getSkillRegistry();
}

// Re-export utilities
export { addTokenUsage, resetTokenUsage, getTokenUsage } from "./cost.js";
export { isCompactMode } from "./compact.js";
export { consumePendingImage, hasPendingImage, setPendingImage } from "./image.js";
