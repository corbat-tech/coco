/**
 * Confirmation system for destructive operations
 */

import * as readline from "node:readline/promises";
import fs from "node:fs/promises";
import chalk from "chalk";
import type { ToolCall } from "../../providers/types.js";

/**
 * Tools that require confirmation before execution
 */
const DESTRUCTIVE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "bash_exec",
]);

/**
 * Check if a tool requires confirmation
 */
export function requiresConfirmation(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

/**
 * Compute LCS (Longest Common Subsequence) matrix for diff algorithm
 */
function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const prevRow = dp[i - 1];
      const currRow = dp[i];
      if (prevRow && currRow) {
        if (a[i - 1] === b[j - 1]) {
          currRow[j] = (prevRow[j - 1] ?? 0) + 1;
        } else {
          currRow[j] = Math.max(prevRow[j] ?? 0, currRow[j - 1] ?? 0);
        }
      }
    }
  }
  return dp;
}

/**
 * Generate semantic diff showing only changed lines with context
 */
function generateDiff(oldText: string, newText: string): string {
  // Quick path for identical content
  if (oldText === newText) {
    return chalk.dim("(no changes)");
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Limit for very large files
  const maxLines = 500;
  if (oldLines.length > maxLines || newLines.length > maxLines) {
    return chalk.dim(`(diff too large: ${oldLines.length} → ${newLines.length} lines)`);
  }

  const dp = computeLCS(oldLines, newLines);
  const operations: Array<{ type: "keep" | "add" | "remove"; line: string }> = [];

  // Backtrack to find diff operations
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    const oldLine = oldLines[i - 1];
    const newLine = newLines[j - 1];
    const dpRow = dp[i];
    const dpPrevRow = dp[i - 1];

    if (i > 0 && j > 0 && oldLine === newLine) {
      operations.unshift({ type: "keep", line: oldLine ?? "" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dpRow?.[j - 1] ?? 0) >= (dpPrevRow?.[j] ?? 0))) {
      operations.unshift({ type: "add", line: newLine ?? "" });
      j--;
    } else {
      operations.unshift({ type: "remove", line: oldLine ?? "" });
      i--;
    }
  }

  // Format with context (show 1 line around changes)
  const result: string[] = [];
  let unchangedCount = 0;

  for (let idx = 0; idx < operations.length; idx++) {
    const op = operations[idx];
    if (!op) continue;

    const prevOp = operations[idx - 1];
    const nextOp = operations[idx + 1];

    if (op.type === "keep") {
      const hasChangeNear = prevOp?.type !== "keep" || nextOp?.type !== "keep";

      if (hasChangeNear) {
        if (unchangedCount > 3) {
          result.push(chalk.dim(`  ... ${unchangedCount - 1} unchanged lines ...`));
        }
        result.push(chalk.dim(`  ${truncateLine(op.line)}`));
        unchangedCount = 0;
      } else {
        unchangedCount++;
      }
    } else if (op.type === "remove") {
      if (unchangedCount > 3) {
        result.push(chalk.dim(`  ... ${unchangedCount} unchanged lines ...`));
      }
      unchangedCount = 0;
      result.push(chalk.red(`- ${truncateLine(op.line)}`));
    } else {
      if (unchangedCount > 3) {
        result.push(chalk.dim(`  ... ${unchangedCount} unchanged lines ...`));
      }
      unchangedCount = 0;
      result.push(chalk.green(`+ ${truncateLine(op.line)}`));
    }
  }

  return result.join("\n") || chalk.dim("(no visible changes)");
}

/**
 * Truncate line to max width for display
 */
function truncateLine(line: string, maxWidth: number = 80): string {
  if (line.length <= maxWidth) return line;
  return line.slice(0, maxWidth - 3) + "...";
}

/**
 * Format preview of content for write_file operations
 */
function formatWriteFilePreview(
  toolCall: ToolCall,
  maxLines: number = 10
): string | null {
  if (toolCall.name !== "write_file") return null;

  const content = toolCall.input.content;
  if (typeof content !== "string") return null;

  if (content.length === 0) {
    return chalk.dim("  (empty file)");
  }

  const lines = content.split("\n");
  const preview = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  const formatted = preview
    .map((line) => chalk.dim("  │ ") + chalk.green(truncateLine(line)))
    .join("\n");

  const footer = truncated
    ? chalk.dim(`  └─ ... ${lines.length - maxLines} more lines`)
    : "";

  return formatted + (footer ? "\n" + footer : "");
}

/**
 * Format tool call for confirmation display with CREATE/MODIFY distinction
 */
function formatToolCallForConfirmation(toolCall: ToolCall, metadata?: { isCreate?: boolean }): string {
  const { name, input } = toolCall;

  switch (name) {
    case "write_file": {
      const isCreate = metadata?.isCreate ?? false;
      const actionLabel = isCreate
        ? chalk.green.bold("CREATE file")
        : chalk.yellow.bold("MODIFY file");
      return `${actionLabel}: ${chalk.cyan(input.path ?? "unknown")}`;
    }

    case "edit_file":
      return `${chalk.yellow.bold("EDIT file")}: ${chalk.cyan(input.path ?? "unknown")}`;

    case "delete_file":
      return `${chalk.red.bold("DELETE file")}: ${chalk.cyan(input.path ?? "unknown")}`;

    case "bash_exec": {
      const cmd = String(input.command ?? "").slice(0, 60);
      const truncated = cmd.length < String(input.command ?? "").length ? "..." : "";
      return `${chalk.yellow.bold("EXECUTE")}: ${chalk.cyan(cmd + truncated)}`;
    }

    default:
      return `${chalk.yellow(name)}`;
  }
}

/**
 * Format diff preview for edit_file operations
 */
function formatDiffPreview(toolCall: ToolCall): string | null {
  if (toolCall.name !== "edit_file") return null;

  const oldText = toolCall.input.old_text;
  const newText = toolCall.input.new_text;

  if (typeof oldText !== "string" || typeof newText !== "string") return null;

  return generateDiff(oldText, newText);
}

/**
 * Result of confirmation prompt
 */
export type ConfirmationResult = "yes" | "no" | "yes_all" | "trust_session" | "abort";

/**
 * Check if a file exists (for create vs modify detection)
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask for confirmation before executing a tool
 */
export async function confirmToolExecution(
  toolCall: ToolCall
): Promise<ConfirmationResult> {
  // Detect create vs modify for write_file
  let isCreate = false;
  if (toolCall.name === "write_file" && toolCall.input.path) {
    isCreate = !(await checkFileExists(String(toolCall.input.path)));
  }

  const description = formatToolCallForConfirmation(toolCall, { isCreate });

  console.log(`\n${chalk.bold("Confirm")} ${description}`);

  // Show diff preview for edit_file
  const diffPreview = formatDiffPreview(toolCall);
  if (diffPreview) {
    console.log(chalk.dim("  Changes:"));
    for (const line of diffPreview.split("\n")) {
      console.log(`    ${line}`);
    }
  }

  // Show content preview for write_file
  const writePreview = formatWriteFilePreview(toolCall);
  if (writePreview) {
    console.log(chalk.dim("  Content:"));
    console.log(writePreview);
  }

  console.log(
    chalk.dim("  [y]es  [n]o  [a]ll this turn  [t]rust session  [c]ancel")
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // P0-3: Handle Ctrl+C during confirmation
  return new Promise<ConfirmationResult>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        rl.close();
      }
    };

    // Handle SIGINT (Ctrl+C)
    rl.on("SIGINT", () => {
      cleanup();
      console.log(chalk.dim(" (cancelled)"));
      resolve("abort");
    });

    // Handle close event (e.g., EOF)
    rl.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve("abort");
      }
    });

    rl.question(chalk.dim("  > ")).then((answer) => {
      cleanup();
      const normalized = answer.trim().toLowerCase();

      switch (normalized) {
        case "y":
        case "yes":
          resolve("yes");
          break;

        case "n":
        case "no":
          resolve("no");
          break;

        case "a":
        case "all":
          resolve("yes_all");
          break;

        case "t":
        case "trust":
          resolve("trust_session");
          break;

        case "c":
        case "cancel":
        case "abort":
          resolve("abort");
          break;

        default:
          // Default to "no" for safety
          resolve("no");
      }
    });
  });
}

/**
 * Confirmation state for a turn (tracks "allow all" setting)
 */
export type ConfirmationState = {
  allowAll: boolean;
};

/**
 * Create initial confirmation state
 */
export function createConfirmationState(): ConfirmationState {
  return { allowAll: false };
}
