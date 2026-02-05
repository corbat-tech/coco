/**
 * Output renderer for REPL
 * Handles streaming, markdown, and tool output formatting
 *
 * Uses line-buffered output for streaming - accumulates text until
 * a newline is received, then flushes the complete line.
 * This prevents partial/corrupted output with spinners.
 *
 * Following patterns from Aider/Continue: batch output, not char-by-char.
 */

import chalk from "chalk";
import type { StreamChunk } from "../../../providers/types.js";
import type { ExecutedToolCall } from "../types.js";

/**
 * Line buffer for streaming output
 * Accumulates text until newline, then flushes complete lines
 */
let lineBuffer = "";

/**
 * Flush any remaining content in the line buffer
 */
export function flushLineBuffer(): void {
  if (lineBuffer) {
    process.stdout.write(lineBuffer);
    lineBuffer = "";
  }
}

/**
 * Reset the line buffer (for new sessions)
 */
export function resetLineBuffer(): void {
  lineBuffer = "";
}

/**
 * Tool icons for visual distinction
 */
const TOOL_ICONS: Record<string, string> = {
  read_file: "📄",
  write_file_create: "📝+",
  write_file_modify: "✏️",
  edit_file: "✏️",
  delete_file: "🗑️",
  list_directory: "📁",
  list_dir: "📁",
  search_files: "🔍",
  grep: "🔍",
  bash_exec: "⚡",
  web_search: "🌐",
  git_status: "📊",
  git_commit: "💾",
  git_push: "⬆️",
  git_pull: "⬇️",
  run_tests: "🧪",
  run_linter: "🔎",
  default: "🔧",
};

/**
 * Get icon for a tool (with context awareness for create vs modify)
 */
function getToolIcon(toolName: string, input?: Record<string, unknown>): string {
  // Special handling for write_file to distinguish create vs modify
  if (toolName === "write_file" && input) {
    const wouldCreate = input.wouldCreate === true;
    return wouldCreate
      ? (TOOL_ICONS.write_file_create ?? "📝+")
      : (TOOL_ICONS.write_file_modify ?? "✏️");
  }
  return TOOL_ICONS[toolName] ?? "🔧";
}

/**
 * Render streaming text chunk with line buffering
 * Accumulates text until newline, then outputs complete lines
 * This prevents partial output corruption with spinners
 */
export function renderStreamChunk(chunk: StreamChunk): void {
  if (chunk.type === "text" && chunk.text) {
    // Add to buffer
    lineBuffer += chunk.text;

    // Check for complete lines
    const lastNewline = lineBuffer.lastIndexOf("\n");
    if (lastNewline !== -1) {
      // Output complete lines
      const completeLines = lineBuffer.slice(0, lastNewline + 1);
      process.stdout.write(completeLines);
      // Keep incomplete line in buffer
      lineBuffer = lineBuffer.slice(lastNewline + 1);
    }
  } else if (chunk.type === "done") {
    // Flush remaining buffer when stream ends
    flushLineBuffer();
  }
}

/**
 * Render tool execution start with create/modify distinction
 */
export function renderToolStart(
  toolName: string,
  input: Record<string, unknown>,
  metadata?: { isCreate?: boolean },
): void {
  const icon = getToolIcon(toolName, { ...input, wouldCreate: metadata?.isCreate });
  const summary = formatToolSummary(toolName, input);

  // Add CREATE/MODIFY label for file operations
  let label = toolName;
  if (toolName === "write_file") {
    label = metadata?.isCreate
      ? chalk.green.bold("CREATE") + " " + chalk.cyan(String(input.path || ""))
      : chalk.yellow.bold("MODIFY") + " " + chalk.cyan(String(input.path || ""));
    console.log(`\n${icon} ${label}`);
    return;
  }

  console.log(`\n${icon} ${chalk.cyan.bold(toolName)} ${chalk.dim(summary)}`);
}

/**
 * Render tool execution result
 */
export function renderToolEnd(result: ExecutedToolCall): void {
  const status = result.result.success ? chalk.green("✓") : chalk.red("✗");

  const duration = chalk.dim(`${result.duration.toFixed(0)}ms`);

  // Show concise result preview
  const preview = formatResultPreview(result);
  console.log(`  ${status} ${duration}${preview ? ` ${preview}` : ""}`);

  // Show error if failed
  if (!result.result.success && result.result.error) {
    console.log(chalk.red(`  └─ ${result.result.error}`));
  }
}

/**
 * Format a smart summary based on tool type
 */
function formatToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
      return String(input.path || "");

    case "write_file":
    case "edit_file":
      return String(input.path || "");

    case "delete_file":
      return String(input.path || "");

    case "list_directory":
      return String(input.path || ".");

    case "search_files": {
      const pattern = String(input.pattern || "");
      const path = input.path ? ` in ${input.path}` : "";
      return `"${pattern}"${path}`;
    }

    case "bash_exec": {
      const cmd = String(input.command || "");
      const truncated = cmd.length > 50 ? cmd.slice(0, 47) + "..." : cmd;
      return truncated;
    }

    default:
      return formatToolInput(input);
  }
}

/**
 * Format a preview of the result based on tool type
 */
function formatResultPreview(result: ExecutedToolCall): string {
  if (!result.result.success) return "";

  const { name, result: toolResult } = result;

  try {
    const data = JSON.parse(toolResult.output);

    switch (name) {
      case "read_file":
        if (data.lines !== undefined) {
          return chalk.dim(`(${data.lines} lines)`);
        }
        break;

      case "list_directory":
        if (Array.isArray(data.entries)) {
          const dirs = data.entries.filter((e: { type: string }) => e.type === "directory").length;
          const files = data.entries.length - dirs;
          return chalk.dim(`(${files} files, ${dirs} dirs)`);
        }
        break;

      case "search_files":
        if (Array.isArray(data.matches)) {
          return chalk.dim(`(${data.matches.length} matches)`);
        }
        break;

      case "bash_exec":
        if (data.exitCode === 0) {
          const lines = String(data.stdout || "").split("\n").length;
          return chalk.dim(`(${lines} lines)`);
        }
        break;

      case "write_file":
      case "edit_file":
        return chalk.dim("(saved)");
    }
  } catch {
    // Ignore parse errors
  }

  return "";
}

/**
 * Format tool input for display (truncated)
 */
function formatToolInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "";

  const parts = entries.slice(0, 3).map(([key, value]) => {
    let str: string;
    if (typeof value === "string") {
      str = value;
    } else if (value === undefined || value === null) {
      str = String(value);
    } else {
      str = JSON.stringify(value);
    }
    const truncated = str.length > 40 ? str.slice(0, 37) + "..." : str;
    return `${key}=${truncated}`;
  });

  if (entries.length > 3) {
    parts.push(`+${entries.length - 3} more`);
  }

  return parts.join(", ");
}

/**
 * Render usage statistics
 */
export function renderUsageStats(
  inputTokens: number,
  outputTokens: number,
  toolCallCount: number,
): void {
  const totalTokens = inputTokens + outputTokens;
  const toolsStr = toolCallCount > 0 ? ` · ${toolCallCount} tools` : "";
  console.log(chalk.dim(`─ ${totalTokens.toLocaleString()} tokens${toolsStr}`));
}

/**
 * Render error message
 */
export function renderError(message: string): void {
  console.error(chalk.red(`✗ Error: ${message}`));
}

/**
 * Render info message
 */
export function renderInfo(message: string): void {
  console.log(chalk.dim(message));
}

/**
 * Render success message
 */
export function renderSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Render warning message
 */
export function renderWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

/**
 * Basic syntax highlighting for code output
 * Highlights strings, numbers, keywords, and comments
 */
export function highlightCode(code: string): string {
  const keywords = new Set([
    "const",
    "let",
    "var",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "import",
    "export",
    "from",
    "class",
    "extends",
    "async",
    "await",
    "try",
    "catch",
    "throw",
    "new",
    "this",
    "true",
    "false",
    "null",
    "undefined",
    "type",
    "interface",
    "enum",
  ]);

  // Process line by line to handle comments properly
  return code
    .split("\n")
    .map((line) => {
      // Handle single-line comments first
      const commentIndex = line.indexOf("//");
      if (commentIndex !== -1) {
        const beforeComment = line.slice(0, commentIndex);
        const comment = line.slice(commentIndex);
        return highlightLine(beforeComment, keywords) + chalk.dim(comment);
      }
      return highlightLine(line, keywords);
    })
    .join("\n");
}

/**
 * Highlight a single line (no comments)
 */
function highlightLine(line: string, keywords: Set<string>): string {
  // Simple tokenization with regex
  return (
    line
      // Strings (double quotes)
      .replace(/"([^"\\]|\\.)*"/g, (match) => chalk.yellow(match))
      // Strings (single quotes)
      .replace(/'([^'\\]|\\.)*'/g, (match) => chalk.yellow(match))
      // Strings (template literals - simplified)
      .replace(/`([^`\\]|\\.)*`/g, (match) => chalk.yellow(match))
      // Numbers
      .replace(/\b(\d+\.?\d*)\b/g, (match) => chalk.magenta(match))
      // Keywords (word boundaries)
      .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
        if (keywords.has(match)) {
          return chalk.blue(match);
        }
        return match;
      })
  );
}

// Legacy exports for backward compatibility (used in tests)
export function resetTypewriter(): void {
  resetLineBuffer();
}

export function getTypewriter(): { flush: () => void; waitForComplete: () => Promise<void> } {
  return {
    flush: flushLineBuffer,
    waitForComplete: () => Promise.resolve(),
  };
}

/**
 * Render stream chunk immediately (no buffering)
 * Used for non-interactive output or testing
 */
export function renderStreamChunkImmediate(chunk: StreamChunk): void {
  if (chunk.type === "text" && chunk.text) {
    process.stdout.write(chunk.text);
  }
}
