/**
 * Confirmation system for destructive operations
 */

import * as readline from "node:readline/promises";
import fs from "node:fs/promises";
import chalk from "chalk";
import type { ToolCall } from "../../providers/types.js";

/**
 * Tools that ALWAYS require confirmation before execution
 * (regardless of input)
 */
const ALWAYS_CONFIRM_TOOLS = new Set([
  // File modifications
  "write_file",
  "edit_file",
  "delete_file",
  "copy_file",
  "move_file",
  // Git remote (affects others)
  "git_push",
  "git_pull",
  // Package management (downloads & runs code)
  "install_deps",
  // Build tools (can run arbitrary code)
  "make",
  "run_script",
  // Network requests
  "http_fetch",
  "http_json",
  // Sensitive data
  "get_env",
]);

/**
 * Safe bash commands that don't require confirmation
 * These are read-only or informational commands
 */
const SAFE_BASH_COMMANDS = new Set([
  // File listing & info
  "ls",
  "ll",
  "la",
  "dir",
  "find",
  "locate",
  "stat",
  "file",
  "du",
  "df",
  "tree",
  // Text viewing (read-only)
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  // Search
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  // Process & system info
  "ps",
  "top",
  "htop",
  "who",
  "whoami",
  "id",
  "uname",
  "hostname",
  "uptime",
  "date",
  "cal",
  "env",
  "printenv",
  // Git (read-only)
  "git status",
  "git log",
  "git diff",
  "git branch",
  "git show",
  "git blame",
  "git remote -v",
  "git tag",
  "git stash list",
  // Package info (read-only)
  "npm list",
  "npm ls",
  "npm outdated",
  "npm view",
  "pnpm list",
  "pnpm ls",
  "pnpm outdated",
  "yarn list",
  "pip list",
  "pip show",
  "cargo --version",
  "go version",
  "node --version",
  "npm --version",
  "python --version",
  // Path & which
  "which",
  "whereis",
  "type",
  "command -v",
  // Echo & print
  "echo",
  "printf",
  "pwd",
  // Help
  "man",
  "help",
  "--help",
  "-h",
  "--version",
  "-v",
]);

/**
 * Dangerous bash command patterns that ALWAYS require confirmation
 */
const DANGEROUS_BASH_PATTERNS = [
  // Network commands
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bnc\b/i,
  /\bnetcat\b/i,
  /\btelnet\b/i,
  /\bftp\b/i,
  // Destructive file operations
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  // Permission changes
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  // Package installation
  /\bnpm\s+(install|i|add|ci)\b/i,
  /\bpnpm\s+(install|i|add)\b/i,
  /\byarn\s+(add|install)\b/i,
  /\bpip\s+install\b/i,
  /\bapt(-get)?\s+(install|remove|purge)\b/i,
  /\bbrew\s+(install|uninstall|remove)\b/i,
  // Git write operations
  /\bgit\s+(push|commit|merge|rebase|reset|checkout|pull|clone)\b/i,
  // Process control
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  // Sudo & admin
  /\bsudo\b/i,
  /\bsu\b/i,
  // Code execution
  /\beval\b/i,
  /\bexec\b/i,
  /\bsource\b/i,
  /\b\.\s+\//,
  // Pipes to shell
  /\|\s*(ba)?sh\b/i,
  /\|\s*bash\b/i,
  // Writing to files
  /[>|]\s*\/?\w/,
  /\btee\b/i,
  // Docker operations
  /\bdocker\s+(run|exec|build|push|pull|rm|stop|kill)\b/i,
  /\bdocker-compose\s+(up|down|build|pull|push)\b/i,
  // Database operations
  /\bmysql\b/i,
  /\bpsql\b/i,
  /\bmongo\b/i,
  /\bredis-cli\b/i,
];

/**
 * Check if a bash command is safe (doesn't require confirmation)
 */
function isSafeBashCommand(command: string): boolean {
  const trimmed = command.trim();

  // Check against dangerous patterns first
  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // Extract the base command (first word or git subcommand)
  const baseCommand = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";

  // Check if it's a known safe command
  if (SAFE_BASH_COMMANDS.has(baseCommand)) {
    return true;
  }

  // Check for git read-only commands specifically
  if (trimmed.startsWith("git ")) {
    const gitCmd = trimmed.slice(0, 20).toLowerCase();
    for (const safe of SAFE_BASH_COMMANDS) {
      if (safe.startsWith("git ") && gitCmd.startsWith(safe)) {
        return true;
      }
    }
  }

  // Check for common safe patterns
  if (trimmed.endsWith("--help") || trimmed.endsWith("-h")) {
    return true;
  }
  if (trimmed.endsWith("--version") || trimmed.endsWith("-v") || trimmed.endsWith("-V")) {
    return true;
  }

  // Default: require confirmation for unknown commands
  return false;
}

/**
 * Check if a tool requires confirmation
 * @param toolName - Name of the tool
 * @param input - Optional tool input for context-aware decisions
 */
export function requiresConfirmation(toolName: string, input?: Record<string, unknown>): boolean {
  // Always confirm these tools
  if (ALWAYS_CONFIRM_TOOLS.has(toolName)) {
    return true;
  }

  // Special handling for bash_exec and bash_background
  if (toolName === "bash_exec" || toolName === "bash_background") {
    const command = input?.command;
    if (typeof command === "string") {
      // Safe commands don't need confirmation
      return !isSafeBashCommand(command);
    }
    // If no command provided, require confirmation
    return true;
  }

  return false;
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
function formatWriteFilePreview(toolCall: ToolCall, maxLines: number = 10): string | null {
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

  const footer = truncated ? chalk.dim(`  └─ ... ${lines.length - maxLines} more lines`) : "";

  return formatted + (footer ? "\n" + footer : "");
}

/**
 * Format tool call for confirmation display with CREATE/MODIFY distinction
 */
function formatToolCallForConfirmation(
  toolCall: ToolCall,
  metadata?: { isCreate?: boolean },
): string {
  const { name, input } = toolCall;

  switch (name) {
    // File operations
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

    case "copy_file":
      return `${chalk.yellow.bold("COPY")}: ${chalk.cyan(input.source ?? "?")} → ${chalk.cyan(input.destination ?? "?")}`;

    case "move_file":
      return `${chalk.yellow.bold("MOVE")}: ${chalk.cyan(input.source ?? "?")} → ${chalk.cyan(input.destination ?? "?")}`;

    // Shell execution
    case "bash_exec": {
      const cmd = truncateLine(String(input.command ?? ""));
      return `${chalk.yellow.bold("EXECUTE")}: ${chalk.cyan(cmd)}`;
    }

    case "bash_background": {
      const cmd = truncateLine(String(input.command ?? ""));
      return `${chalk.yellow.bold("BACKGROUND")}: ${chalk.cyan(cmd)}`;
    }

    // Git remote operations
    case "git_push": {
      const remote = input.remote ?? "origin";
      const branch = input.branch ?? "current";
      return `${chalk.red.bold("GIT PUSH")}: ${chalk.cyan(`${remote}/${branch}`)}`;
    }

    case "git_pull": {
      const remote = input.remote ?? "origin";
      const branch = input.branch ?? "current";
      return `${chalk.yellow.bold("GIT PULL")}: ${chalk.cyan(`${remote}/${branch}`)}`;
    }

    // Package management
    case "install_deps":
      return `${chalk.yellow.bold("INSTALL DEPS")}: ${chalk.cyan(input.packageManager ?? "npm/pnpm")}`;

    // Build tools
    case "make": {
      const target = input.target ?? "default";
      return `${chalk.yellow.bold("MAKE")}: ${chalk.cyan(target)}`;
    }

    case "run_script": {
      const script = input.script ?? input.name ?? "unknown";
      return `${chalk.yellow.bold("RUN SCRIPT")}: ${chalk.cyan(script)}`;
    }

    // Network
    case "http_fetch":
    case "http_json": {
      const url = String(input.url ?? "unknown");
      const method = String(input.method ?? "GET").toUpperCase();
      return `${chalk.yellow.bold("HTTP " + method)}: ${chalk.cyan(url)}`;
    }

    // Sensitive
    case "get_env": {
      const varName = input.name ?? input.variable ?? "unknown";
      return `${chalk.yellow.bold("READ ENV")}: ${chalk.cyan(varName)}`;
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
export type ConfirmationResult =
  | "yes"
  | "no"
  | "trust_project"
  | "trust_global"
  | "abort"
  | { type: "edit"; newCommand: string };

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
 * Ask user to edit the command
 */
async function promptEditCommand(
  rl: readline.Interface,
  originalCommand: string,
): Promise<string | null> {
  console.log();
  console.log(chalk.dim("  Edit command (or press Enter to cancel):"));
  console.log(chalk.cyan(`  Current: ${originalCommand}`));

  const answer = await rl.question(chalk.dim("  New cmd: "));
  const trimmed = answer.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
}

/**
 * Ask for confirmation before executing a tool
 * Brand color: Magenta 🟣
 */
export async function confirmToolExecution(toolCall: ToolCall): Promise<ConfirmationResult> {
  // Detect create vs modify for write_file
  let isCreate = false;
  if (toolCall.name === "write_file" && toolCall.input.path) {
    isCreate = !(await checkFileExists(String(toolCall.input.path)));
  }

  const description = formatToolCallForConfirmation(toolCall, { isCreate });
  const isBashExec = toolCall.name === "bash_exec";

  // Simple clean header
  console.log();
  console.log(chalk.magenta.bold("  ⚡ Confirm Action"));
  console.log(chalk.magenta("  " + "─".repeat(45)));
  console.log();
  console.log(`  ${description}`);

  // Show diff preview for edit_file
  const diffPreview = formatDiffPreview(toolCall);
  if (diffPreview) {
    console.log();
    console.log(chalk.dim("  Changes:"));
    for (const line of diffPreview.split("\n").slice(0, 5)) {
      console.log(chalk.dim("    ") + line);
    }
  }

  // Show content preview for write_file
  const writePreview = formatWriteFilePreview(toolCall, 3);
  if (writePreview) {
    console.log();
    console.log(chalk.dim("  Preview:"));
    for (const line of writePreview.split("\n").slice(0, 4)) {
      console.log(line);
    }
  }

  // Options - simplified menu
  console.log();
  const baseOptions = 4; // y, n, t, !
  const optionCount = isBashExec ? baseOptions + 1 : baseOptions;
  const menuLines = optionCount + 2; // +2 for empty lines before/after

  console.log(chalk.green("  [y]") + chalk.dim("es       ") + "Allow once");
  console.log(chalk.red("  [n]") + chalk.dim("o       ") + "Skip");
  if (isBashExec) {
    console.log(chalk.yellow("  [e]") + chalk.dim("dit     ") + "Edit command");
  }
  console.log(chalk.magenta("  [t]") + chalk.dim("rust    ") + "Always allow (this project)");
  console.log(chalk.blue("  [!]") + chalk.dim("       ") + "Always allow (everywhere)");
  console.log(chalk.dim("  Ctrl+C to abort task"));
  console.log();

  // Ensure stdin is in the right state for readline
  // (it may have been paused by the input handler)
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
  // Disable raw mode if enabled (readline needs cooked mode)
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  /**
   * Clear the options menu and show selected choice
   * Need to clear: menu lines + 1 for user input line
   */
  const showSelection = (choice: string, color: (s: string) => string) => {
    const linesToClear = menuLines + 1; // +1 for the input line with user's answer

    // Move cursor up
    process.stdout.write(`\x1b[${linesToClear}A`);

    // Clear each line
    for (let i = 0; i < linesToClear; i++) {
      process.stdout.write("\x1b[2K"); // Clear entire line
      if (i < linesToClear - 1) {
        process.stdout.write("\n"); // Move down (except last)
      }
    }

    // Move back to top of cleared area
    process.stdout.write(`\x1b[${linesToClear - 1}A`);
    process.stdout.write("\r"); // Return to beginning of line

    // Show selected choice
    console.log(color(`  ✓ ${choice}`));
  };

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
      showSelection("Cancelled", chalk.dim);
      resolve("abort");
    });

    // Handle close event (e.g., EOF)
    rl.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve("abort");
      }
    });

    const askQuestion = () => {
      rl.question(chalk.magenta("  ❯ ")).then(async (answer) => {
        const normalized = answer.trim();

        switch (normalized.toLowerCase()) {
          case "y":
          case "yes":
            cleanup();
            showSelection("Allowed", chalk.green);
            resolve("yes");
            break;

          case "n":
          case "no":
            cleanup();
            showSelection("Skipped", chalk.red);
            resolve("no");
            break;

          case "e":
          case "edit":
            if (isBashExec) {
              const originalCommand = String(toolCall.input.command ?? "");
              try {
                const newCommand = await promptEditCommand(rl, originalCommand);
                cleanup();
                if (newCommand) {
                  showSelection("Edited", chalk.yellow);
                  resolve({ type: "edit", newCommand });
                } else {
                  console.log(chalk.dim("  Edit cancelled."));
                  askQuestion();
                }
              } catch {
                cleanup();
                resolve("abort");
              }
            } else {
              console.log(chalk.yellow("  Edit only available for bash commands."));
              askQuestion();
            }
            break;

          case "t":
          case "trust":
            cleanup();
            showSelection("Trusted (project)", chalk.magenta);
            resolve("trust_project");
            break;

          case "!":
            cleanup();
            showSelection("Trusted (global)", chalk.blue);
            resolve("trust_global");
            break;

          default:
            console.log(chalk.yellow("  Invalid: y/n" + (isBashExec ? "/e" : "") + "/t/!"));
            askQuestion();
        }
      });
    };

    askQuestion();
  });
}

/**
 * Confirmation state for a session
 * Note: "allow all this turn" was removed for simplicity
 */
export type ConfirmationState = {
  // Reserved for future use
};

/**
 * Create initial confirmation state
 */
export function createConfirmationState(): ConfirmationState {
  return {};
}
