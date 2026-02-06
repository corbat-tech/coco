/**
 * Allow-Path Command for REPL
 *
 * Manages additional directories authorized for file operations
 * beyond the current project root.
 */

import path from "node:path";
import fs from "node:fs/promises";
import chalk from "chalk";
import * as p from "@clack/prompts";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  getAllowedPaths,
  addAllowedPathToSession,
  removeAllowedPathFromSession,
  persistAllowedPath,
  removePersistedAllowedPath,
} from "../../../tools/allowed-paths.js";

/**
 * System paths that can never be allowed
 */
const BLOCKED_SYSTEM_PATHS = [
  "/etc",
  "/var",
  "/usr",
  "/root",
  "/sys",
  "/proc",
  "/boot",
  "/bin",
  "/sbin",
];

/**
 * Allow-path command
 */
export const allowPathCommand: SlashCommand = {
  name: "allow-path",
  aliases: ["ap"],
  description: "Allow file operations in an additional directory",
  usage: "/allow-path <directory> | /allow-path list | /allow-path revoke <directory>",
  execute: async (args: string[], session: ReplSession): Promise<boolean> => {
    const subcommand = args[0] ?? "";

    if (subcommand === "list" || subcommand === "ls") {
      showAllowedPaths(session);
      return false;
    }

    if (subcommand === "revoke" || subcommand === "rm") {
      await revokePath(args.slice(1).join(" "), session);
      return false;
    }

    if (!subcommand) {
      p.log.info("Usage: /allow-path <directory>");
      p.log.info("       /allow-path list");
      p.log.info("       /allow-path revoke <directory>");
      return false;
    }

    // Add a new allowed path
    const dirPath = args.join(" ");
    await addPath(dirPath, session);
    return false;
  },
};

/**
 * Add a new allowed path with confirmation
 */
async function addPath(dirPath: string, session: ReplSession): Promise<void> {
  const absolute = path.resolve(dirPath);

  // Validate: must exist and be a directory
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) {
      p.log.error(`Not a directory: ${absolute}`);
      return;
    }
  } catch {
    p.log.error(`Directory not found: ${absolute}`);
    return;
  }

  // Validate: not a system path
  for (const blocked of BLOCKED_SYSTEM_PATHS) {
    const normalizedBlocked = path.normalize(blocked);
    if (absolute === normalizedBlocked || absolute.startsWith(normalizedBlocked + path.sep)) {
      p.log.error(`System path '${blocked}' cannot be allowed`);
      return;
    }
  }

  // Validate: not already the project directory
  const normalizedCwd = path.normalize(session.projectPath);
  if (absolute === normalizedCwd || absolute.startsWith(normalizedCwd + path.sep)) {
    p.log.info("That path is already within the project directory");
    return;
  }

  // Validate: not already allowed
  const existing = getAllowedPaths();
  if (existing.some((e) => path.normalize(e.path) === path.normalize(absolute))) {
    p.log.info(`Already allowed: ${absolute}`);
    return;
  }

  // Confirmation
  console.log();
  console.log(chalk.yellow("  ⚠ Grant access to external directory"));
  console.log(chalk.dim(`  📁 ${absolute}`));
  console.log();

  const action = await p.select({
    message: "Grant access?",
    options: [
      { value: "session-write", label: "✓ Write access (this session only)" },
      { value: "session-read", label: "◐ Read-only (this session only)" },
      { value: "persist-write", label: "⚡ Write access (remember for this project)" },
      { value: "persist-read", label: "💾 Read-only (remember for this project)" },
      { value: "no", label: "✗ Cancel" },
    ],
  });

  if (p.isCancel(action) || action === "no") {
    p.log.info("Cancelled");
    return;
  }

  const level = (action as string).includes("read") ? "read" : "write";
  const persist = (action as string).startsWith("persist");

  addAllowedPathToSession(absolute, level as "read" | "write");

  if (persist) {
    await persistAllowedPath(absolute, level as "read" | "write");
  }

  const levelLabel = level === "write" ? "write" : "read-only";
  const persistLabel = persist ? " (persisted)" : " (session only)";
  p.log.success(`Access granted: ${levelLabel}${persistLabel}`);
  console.log(chalk.dim(`  📁 ${absolute}`));
}

/**
 * Show currently allowed paths
 */
function showAllowedPaths(session: ReplSession): void {
  const paths = getAllowedPaths();

  console.log();
  console.log(chalk.bold("  Allowed Paths"));
  console.log();
  console.log(chalk.dim(`  📁 ${session.projectPath}`) + chalk.green(" (project root)"));

  if (paths.length === 0) {
    console.log(chalk.dim("  No additional paths allowed"));
  } else {
    for (const entry of paths) {
      const level = entry.level === "write" ? chalk.yellow("write") : chalk.cyan("read");
      console.log(chalk.dim(`  📁 ${entry.path}`) + ` [${level}]`);
    }
  }
  console.log();
}

/**
 * Revoke an allowed path
 */
async function revokePath(dirPath: string, _session: ReplSession): Promise<void> {
  if (!dirPath) {
    // Show list and let user choose
    const paths = getAllowedPaths();
    if (paths.length === 0) {
      p.log.info("No additional paths to revoke");
      return;
    }

    const selected = await p.select({
      message: "Revoke access to:",
      options: [
        ...paths.map((entry) => ({
          value: entry.path,
          label: `${entry.path} [${entry.level}]`,
        })),
        { value: "__cancel__", label: "Cancel" },
      ],
    });

    if (p.isCancel(selected) || selected === "__cancel__") {
      return;
    }

    dirPath = selected as string;
  }

  const absolute = path.resolve(dirPath);
  const removed = removeAllowedPathFromSession(absolute);
  await removePersistedAllowedPath(absolute);

  if (removed) {
    p.log.success(`Access revoked: ${absolute}`);
  } else {
    p.log.error(`Path not found in allowed list: ${absolute}`);
  }
}
