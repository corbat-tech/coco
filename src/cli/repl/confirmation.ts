/**
 * Confirmation system for destructive operations
 */

import * as readline from "node:readline/promises";
import fs from "node:fs/promises";
import chalk from "chalk";
import type { ToolCall } from "../../providers/types.js";
import { getTrustPattern } from "./bash-patterns.js";
import { getRiskDescription, getEffectDescription } from "../../tools/permissions.js";

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
  // Permission changes (always confirm)
  "manage_permissions",
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
 * Format tool call for confirmation display with CREATE/MODIFY distinction.
 * Returns the description line and the trust pattern.
 */
function formatToolCallForConfirmation(
  toolCall: ToolCall,
  metadata?: { isCreate?: boolean },
): { description: string; pattern: string } {
  const pattern = getTrustPattern(toolCall.name, toolCall.input);
  const { name, input } = toolCall;

  let description: string;

  switch (name) {
    // File operations
    case "write_file": {
      const isCreate = metadata?.isCreate ?? false;
      const actionLabel = isCreate
        ? chalk.green.bold("CREATE file")
        : chalk.yellow.bold("MODIFY file");
      description = `${actionLabel}: ${chalk.cyan(input.path ?? "unknown")}`;
      break;
    }

    case "edit_file":
      description = `${chalk.yellow.bold("EDIT file")}: ${chalk.cyan(input.path ?? "unknown")}`;
      break;

    case "delete_file":
      description = `${chalk.red.bold("DELETE file")}: ${chalk.cyan(input.path ?? "unknown")}`;
      break;

    case "copy_file":
      description = `${chalk.yellow.bold("COPY")}: ${chalk.cyan(input.source ?? "?")} → ${chalk.cyan(input.destination ?? "?")}`;
      break;

    case "move_file":
      description = `${chalk.yellow.bold("MOVE")}: ${chalk.cyan(input.source ?? "?")} → ${chalk.cyan(input.destination ?? "?")}`;
      break;

    // Shell execution
    case "bash_exec": {
      const cmd = truncateLine(String(input.command ?? ""), 60);
      description = `${chalk.yellow.bold("EXECUTE")}: ${chalk.cyan(cmd)}`;
      break;
    }

    case "bash_background": {
      const cmd = truncateLine(String(input.command ?? ""), 60);
      description = `${chalk.yellow.bold("BACKGROUND")}: ${chalk.cyan(cmd)}`;
      break;
    }

    // Git remote operations
    case "git_push": {
      const remote = input.remote ?? "origin";
      const branch = input.branch ?? "current";
      description = `${chalk.red.bold("GIT PUSH")}: ${chalk.cyan(`${remote}/${branch}`)}`;
      break;
    }

    case "git_pull": {
      const remote = input.remote ?? "origin";
      const branch = input.branch ?? "current";
      description = `${chalk.yellow.bold("GIT PULL")}: ${chalk.cyan(`${remote}/${branch}`)}`;
      break;
    }

    // Package management
    case "install_deps":
      description = `${chalk.yellow.bold("INSTALL DEPS")}: ${chalk.cyan(input.packageManager ?? "npm/pnpm")}`;
      break;

    // Build tools
    case "make": {
      const target = input.target ?? "default";
      description = `${chalk.yellow.bold("MAKE")}: ${chalk.cyan(target)}`;
      break;
    }

    case "run_script": {
      const script = input.script ?? input.name ?? "unknown";
      description = `${chalk.yellow.bold("RUN SCRIPT")}: ${chalk.cyan(script)}`;
      break;
    }

    // Network
    case "http_fetch":
    case "http_json": {
      const url = String(input.url ?? "unknown");
      const method = String(input.method ?? "GET").toUpperCase();
      description = `${chalk.yellow.bold("HTTP " + method)}: ${chalk.cyan(url)}`;
      break;
    }

    // Sensitive
    case "get_env": {
      const varName = input.name ?? input.variable ?? "unknown";
      description = `${chalk.yellow.bold("READ ENV")}: ${chalk.cyan(varName)}`;
      break;
    }

    // Permission management
    case "manage_permissions": {
      const action = String(input.action ?? "unknown");
      const patterns = Array.isArray(input.patterns) ? input.patterns.map(String) : [];
      const scope = String(input.scope ?? "project") as "global" | "project";
      const reason = input.reason ? String(input.reason) : undefined;
      const actionLabel =
        action === "allow" ? chalk.green.bold("ALLOW") : chalk.red.bold(action.toUpperCase());
      const scopeLabel =
        scope === "global"
          ? chalk.blue("Global (all projects)")
          : chalk.magenta("Project (current only)");
      const patternList = patterns.map((p: string) => chalk.cyan(p)).join(", ");
      const lines = [`${actionLabel}: ${patternList}`];
      lines.push(`${chalk.dim("  Scope:")}  ${scopeLabel}`);
      if (reason) {
        lines.push(`${chalk.dim("  Reason:")} ${reason}`);
      }
      for (const p of patterns) {
        lines.push(`${chalk.dim("  Risk:")}   ${getRiskDescription(p)}`);
        lines.push(
          `${chalk.dim("  Effect:")} ${getEffectDescription(action as "allow" | "deny" | "ask", p, scope)}`,
        );
      }
      description = lines.join("\n  ");
      break;
    }

    default:
      description = chalk.yellow(name);
      break;
  }

  return { description, pattern };
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
 * Ask user to edit the command using readline (needs cooked mode for line editing)
 */
async function promptEditCommand(originalCommand: string): Promise<string | null> {
  console.log();
  console.log(chalk.dim("  Edit command (or press Enter to cancel):"));
  console.log(chalk.cyan(`  Current: ${originalCommand}`));

  // Track raw mode state so we can restore it
  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;

  // Switch to cooked mode for line editing
  if (process.stdin.isTTY && wasRaw) {
    process.stdin.setRawMode(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(chalk.dim("  New cmd: "));
    const trimmed = answer.trim();
    return trimmed || null;
  } finally {
    rl.close();
    // Restore raw mode if it was active before
    if (process.stdin.isTTY && wasRaw) {
      process.stdin.setRawMode(true);
    }
  }
}

/** Option definition for the interactive menu */
interface MenuOption {
  key: string;
  label: string;
  description: string;
  color: (s: string) => string;
  result: ConfirmationResult | "edit";
}

/**
 * Ask for confirmation before executing a tool
 * Brand color: Magenta 🟣
 *
 * Features:
 * - Instant single-key response (no Enter needed for y/n/t/!)
 * - Arrow key navigation between options with Enter to select
 */
export async function confirmToolExecution(toolCall: ToolCall): Promise<ConfirmationResult> {
  // Detect create vs modify for write_file
  let isCreate = false;
  if (toolCall.name === "write_file" && toolCall.input.path) {
    isCreate = !(await checkFileExists(String(toolCall.input.path)));
  }

  const { description, pattern } = formatToolCallForConfirmation(toolCall, { isCreate });
  const isBashExec = toolCall.name === "bash_exec";

  // Generic header with trust pattern indicator
  console.log();
  console.log(chalk.magenta.bold("  ⚡ Confirm Action"));
  console.log(chalk.magenta("  " + "─".repeat(24)));
  console.log();
  console.log(`  ${description}  ${chalk.dim(chalk.green(`[${pattern}]`))}`);

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

  // Build menu options
  const options: MenuOption[] = [
    { key: "y", label: "yes", description: "Allow once", color: chalk.green, result: "yes" },
    { key: "n", label: "no", description: "Skip", color: chalk.red, result: "no" },
  ];
  if (isBashExec) {
    options.push({
      key: "e",
      label: "edit",
      description: "Edit command",
      color: chalk.yellow,
      result: "edit",
    });
  }
  options.push(
    {
      key: "t",
      label: "trust",
      description: "Always allow (this project)",
      color: chalk.magenta,
      result: "trust_project",
    },
    {
      key: "!",
      label: "!",
      description: "Always allow (everywhere)",
      color: chalk.blue,
      result: "trust_global",
    },
  );

  const menuLines = options.length + 3; // options + hint + empty lines
  let selectedIndex = 0;

  /** Render the menu with the current selection highlighted */
  const renderMenu = () => {
    console.log();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const pointer = i === selectedIndex ? chalk.magenta("❯ ") : "  ";
      const keyDisplay = opt.color(`[${opt.key}]`);
      const labelPad = opt.label.padEnd(8);
      const desc = i === selectedIndex ? chalk.white(opt.description) : opt.description;
      console.log(`${pointer}${keyDisplay}${chalk.dim(labelPad)} ${desc}`);
    }
    console.log(chalk.dim("  Ctrl+C to abort"));
    console.log();
  };

  /** Clear the menu area (move up and clear lines) */
  const clearMenu = () => {
    process.stdout.write(`\x1b[${menuLines}A`);
    for (let i = 0; i < menuLines; i++) {
      process.stdout.write("\x1b[2K");
      if (i < menuLines - 1) process.stdout.write("\n");
    }
    process.stdout.write(`\x1b[${menuLines - 1}A\r`);
  };

  /** Show final selection after clearing the menu */
  const showSelection = (choice: string, color: (s: string) => string) => {
    clearMenu();
    console.log(color(`  ✓ ${choice}`));
  };

  // Render initial menu
  renderMenu();

  // Ensure stdin is ready
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }

  return new Promise<ConfirmationResult>((resolve) => {
    let resolved = false;

    // Enable raw mode for instant keypress detection
    const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      process.stdin.removeListener("data", onData);
      // Restore previous raw mode state
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
      }
    };

    const handleResult = (result: ConfirmationResult) => {
      cleanup();
      resolve(result);
    };

    const handleEdit = async () => {
      cleanup();
      const originalCommand = String(toolCall.input.command ?? "");
      try {
        const newCommand = await promptEditCommand(originalCommand);
        if (newCommand) {
          showSelection("Edited", chalk.yellow);
          resolve({ type: "edit", newCommand });
        } else {
          console.log(chalk.dim("  Edit cancelled, re-prompting..."));
          // Re-enter the confirmation flow
          resolve(await confirmToolExecution(toolCall));
        }
      } catch {
        resolve("abort");
      }
    };

    const selectCurrent = () => {
      const opt = options[selectedIndex]!;
      if (opt.result === "edit") {
        showSelection("Editing...", chalk.yellow);
        handleEdit();
      } else {
        const labels: Record<string, [string, (s: string) => string]> = {
          yes: ["Allowed", chalk.green],
          no: ["Skipped", chalk.red],
          trust_project: ["Trusted (project)", chalk.magenta],
          trust_global: ["Trusted (global)", chalk.blue],
        };
        const [label, color] = labels[opt.result as string] ?? ["Selected", chalk.white];
        showSelection(label, color);
        handleResult(opt.result as ConfirmationResult);
      }
    };

    const redrawMenu = () => {
      clearMenu();
      renderMenu();
    };

    const onData = (data: Buffer) => {
      if (resolved) return;

      const str = data.toString();

      // Ctrl+C
      if (str === "\x03") {
        showSelection("Cancelled", chalk.dim);
        handleResult("abort");
        return;
      }

      // Enter - select current option
      if (str === "\r" || str === "\n") {
        selectCurrent();
        return;
      }

      // Arrow keys (escape sequences)
      if (str === "\x1b[A" || str === "\x1bOA") {
        // Up arrow
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        redrawMenu();
        return;
      }
      if (str === "\x1b[B" || str === "\x1bOB") {
        // Down arrow
        selectedIndex = (selectedIndex + 1) % options.length;
        redrawMenu();
        return;
      }

      // Direct key shortcuts (instant, no Enter needed)
      const key = str.toLowerCase();
      const matchedOption = options.find((o) => o.key === key);
      if (matchedOption) {
        selectedIndex = options.indexOf(matchedOption);
        if (matchedOption.result === "edit") {
          showSelection("Editing...", chalk.yellow);
          handleEdit();
        } else {
          const labels: Record<string, [string, (s: string) => string]> = {
            yes: ["Allowed", chalk.green],
            no: ["Skipped", chalk.red],
            trust_project: ["Trusted (project)", chalk.magenta],
            trust_global: ["Trusted (global)", chalk.blue],
          };
          const [label, color] = labels[matchedOption.result as string] ?? [
            "Selected",
            chalk.white,
          ];
          showSelection(label, color);
          handleResult(matchedOption.result as ConfirmationResult);
        }
      }
    };

    process.stdin.on("data", onData);
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
