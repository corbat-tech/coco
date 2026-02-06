/**
 * Interactive prompt for allowing paths outside the project directory.
 *
 * Shown automatically when a tool tries to access a path outside the project.
 * Offers the user to authorize the directory inline, without needing /allow-path.
 */

import path from "node:path";
import chalk from "chalk";
import * as p from "@clack/prompts";
import { addAllowedPathToSession, persistAllowedPath } from "../../tools/allowed-paths.js";

/**
 * Prompt the user to authorize an external directory.
 * Returns true if authorized (tool should retry), false otherwise.
 */
export async function promptAllowPath(dirPath: string): Promise<boolean> {
  const absolute = path.resolve(dirPath);

  console.log();
  console.log(chalk.yellow("  ⚠ Access denied — path is outside the project directory"));
  console.log(chalk.dim(`  📁 ${absolute}`));
  console.log();

  const action = await p.select({
    message: "Grant access to this directory?",
    options: [
      { value: "session-write", label: "✓ Allow write (this session)" },
      { value: "session-read", label: "◐ Allow read-only (this session)" },
      { value: "persist-write", label: "⚡ Allow write (remember for this project)" },
      { value: "persist-read", label: "💾 Allow read-only (remember for this project)" },
      { value: "no", label: "✗ Deny" },
    ],
  });

  if (p.isCancel(action) || action === "no") {
    return false;
  }

  const level = (action as string).includes("read") ? "read" : "write";
  const persist = (action as string).startsWith("persist");

  addAllowedPathToSession(absolute, level as "read" | "write");

  if (persist) {
    await persistAllowedPath(absolute, level as "read" | "write");
  }

  const levelLabel = level === "write" ? "write" : "read-only";
  const persistLabel = persist ? " (remembered)" : "";
  console.log(chalk.green(`  ✓ Access granted: ${levelLabel}${persistLabel}`));

  return true;
}
