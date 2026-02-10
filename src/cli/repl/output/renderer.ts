/**
 * Output renderer for REPL
 * Handles streaming, markdown, and tool output formatting
 *
 * Features:
 * - Line-buffered output for streaming (prevents corruption with spinners)
 * - Markdown code block detection with fancy box rendering
 * - Inline markdown formatting (headers, bold, italic, code)
 * - Tool call/result visual formatting
 */

import chalk from "chalk";
import type { StreamChunk } from "../../../providers/types.js";
import type { ExecutedToolCall } from "../types.js";
import { highlightLine, highlightBlock } from "./syntax.js";

// ============================================================================
// State Management
// ============================================================================

/** Line buffer for streaming output */
let lineBuffer = "";

/** Raw markdown accumulator for clipboard */
let rawMarkdownBuffer = "";

/** Track if we're inside a code block */
let inCodeBlock = false;
let codeBlockLang = "";
let codeBlockLines: string[] = [];

/** Streaming indicator state */
let streamingIndicatorActive = false;
let streamingIndicatorInterval: NodeJS.Timeout | null = null;
let streamingIndicatorFrame = 0;
const STREAMING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Terminal width for box rendering */
const getTerminalWidth = () => process.stdout.columns || 80;

/** Start streaming indicator when buffering code blocks */
function startStreamingIndicator(): void {
  if (streamingIndicatorActive) return;
  streamingIndicatorActive = true;
  streamingIndicatorFrame = 0;

  // Show initial indicator
  const frame = STREAMING_FRAMES[0]!;
  process.stdout.write(`\r${chalk.magenta(frame)} ${chalk.dim("Receiving markdown...")}`);

  // Animate
  streamingIndicatorInterval = setInterval(() => {
    streamingIndicatorFrame = (streamingIndicatorFrame + 1) % STREAMING_FRAMES.length;
    const frame = STREAMING_FRAMES[streamingIndicatorFrame]!;
    const lines = codeBlockLines.length;
    const linesText = lines > 0 ? ` (${lines} lines)` : "";
    process.stdout.write(
      `\r${chalk.magenta(frame)} ${chalk.dim(`Receiving markdown...${linesText}`)}`,
    );
  }, 80);
}

/** Stop streaming indicator */
function stopStreamingIndicator(): void {
  if (!streamingIndicatorActive) return;
  streamingIndicatorActive = false;

  if (streamingIndicatorInterval) {
    clearInterval(streamingIndicatorInterval);
    streamingIndicatorInterval = null;
  }

  // Clear the line
  process.stdout.write("\r\x1b[K");
}

// ============================================================================
// Buffer Management
// ============================================================================

export function flushLineBuffer(): void {
  if (lineBuffer) {
    processAndOutputLine(lineBuffer);
    lineBuffer = "";
  }
  // If we have an unclosed code block, render it
  if (inCodeBlock && codeBlockLines.length > 0) {
    stopStreamingIndicator();
    try {
      renderCodeBlock(codeBlockLang, codeBlockLines);
    } finally {
      // Ensure indicator is always stopped even if render fails
      stopStreamingIndicator();
    }
    inCodeBlock = false;
    codeBlockLang = "";
    codeBlockLines = [];
  }
}

export function resetLineBuffer(): void {
  lineBuffer = "";
  inCodeBlock = false;
  codeBlockLang = "";
  codeBlockLines = [];
  stopStreamingIndicator();
}

export function getRawMarkdown(): string {
  return rawMarkdownBuffer;
}

export function clearRawMarkdown(): void {
  rawMarkdownBuffer = "";
}

// ============================================================================
// Stream Chunk Processing
// ============================================================================

export function renderStreamChunk(chunk: StreamChunk): void {
  if (chunk.type === "text" && chunk.text) {
    lineBuffer += chunk.text;
    rawMarkdownBuffer += chunk.text;

    // Process complete lines
    let newlineIndex: number;
    while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newlineIndex);
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      processAndOutputLine(line);
    }
  } else if (chunk.type === "done") {
    flushLineBuffer();
  }
}

function processAndOutputLine(line: string): void {
  // Check for code block start/end
  const codeBlockMatch = line.match(/^```(\w*)$/);

  if (codeBlockMatch) {
    if (!inCodeBlock) {
      // Starting a code block
      inCodeBlock = true;
      codeBlockLang = codeBlockMatch[1] || "";
      codeBlockLines = [];
      // Start streaming indicator for markdown blocks
      if (codeBlockLang === "markdown" || codeBlockLang === "md") {
        startStreamingIndicator();
      }
    } else {
      // Ending a code block - stop indicator and render
      stopStreamingIndicator();
      renderCodeBlock(codeBlockLang, codeBlockLines);
      inCodeBlock = false;
      codeBlockLang = "";
      codeBlockLines = [];
    }
    return;
  }

  if (inCodeBlock) {
    // Accumulate code block content
    codeBlockLines.push(line);
  } else {
    // Render as formatted markdown line
    console.log(formatMarkdownLine(line));
  }
}

// ============================================================================
// Code Block Rendering (Box Style)
// ============================================================================

function renderCodeBlock(lang: string, lines: string[]): void {
  // For markdown blocks, render with box but process nested code blocks
  if (lang === "markdown" || lang === "md") {
    renderMarkdownBlock(lines);
    return;
  }

  // Regular code block rendering
  renderSimpleCodeBlock(lang, lines);
}

function renderMarkdownBlock(lines: string[]): void {
  const width = Math.min(getTerminalWidth() - 4, 100);
  const contentWidth = width - 4;

  // Short top border with "Markdown" title
  const title = "Markdown";
  console.log(chalk.magenta("╭── " + title + " ──"));

  // Process lines, detecting nested code blocks and tables
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Check for nested code block (~~~ or ```)
    const nestedMatch = line.match(/^(~~~|```)(\w*)$/);

    if (nestedMatch) {
      // Found nested code block start
      const delimiter = nestedMatch[1];
      const nestedLang = nestedMatch[2] || "";
      const nestedLines: string[] = [];
      i++;

      // Collect nested code block content (match same delimiter)
      const closePattern = new RegExp(`^${delimiter}$`);
      while (i < lines.length && !closePattern.test(lines[i]!)) {
        nestedLines.push(lines[i]!);
        i++;
      }
      i++; // Skip closing delimiter

      // Render nested code block inline (with different style)
      renderNestedCodeBlock(nestedLang, nestedLines, contentWidth);
    } else if (isTableLine(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      // Found a markdown table - collect all table lines
      const tableLines: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]!) || isTableSeparator(lines[i]!))) {
        tableLines.push(lines[i]!);
        i++;
      }
      // Render the table with nice borders
      renderNestedTable(tableLines, contentWidth);
    } else {
      // Regular markdown line
      const formatted = formatMarkdownLine(line);
      const wrappedLines = wrapText(formatted, contentWidth);
      for (const wrappedLine of wrappedLines) {
        console.log(chalk.magenta("│") + " " + wrappedLine);
      }
      i++;
    }
  }

  // Short bottom border (matching top length)
  console.log(chalk.magenta("╰──────────────"));
}

function isTableLine(line: string): boolean {
  // A table line starts and ends with | and has content (not just dashes/colons)
  const trimmed = line.trim();
  if (!/^\|.*\|$/.test(trimmed)) return false;
  if (isTableSeparator(line)) return false;
  // Must have actual content, not just separators
  const inner = trimmed.slice(1, -1);
  return inner.length > 0 && !/^[\s|:-]+$/.test(inner);
}

function isTableSeparator(line: string): boolean {
  // Table separator: |---|---|---| or |:--|:--:|--:| or | --- | --- |
  // Must have at least 3 dashes per cell and only contain |, -, :, and spaces
  const trimmed = line.trim();
  if (!/^\|.*\|$/.test(trimmed)) return false;
  const inner = trimmed.slice(1, -1);
  // Must only contain dashes, colons, pipes, and spaces
  if (!/^[\s|:-]+$/.test(inner)) return false;
  // Must have at least one sequence of 3+ dashes
  return /-{3,}/.test(inner);
}

function renderNestedTable(lines: string[], parentWidth: number): void {
  // Parse table
  const rows: string[][] = [];
  let columnWidths: number[] = [];

  for (const line of lines) {
    if (isTableSeparator(line)) continue; // Skip separator

    // Parse cells
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    rows.push(cells);

    // Track max width per column
    cells.forEach((cell, idx) => {
      const cellWidth = cell.length;
      if (!columnWidths[idx] || cellWidth > columnWidths[idx]!) {
        columnWidths[idx] = cellWidth;
      }
    });
  }

  if (rows.length === 0) return;

  // Calculate total table width and adjust if needed
  const minCellPadding = 2;
  let totalWidth =
    columnWidths.reduce((sum, w) => sum + w + minCellPadding, 0) + columnWidths.length + 1;

  // If table is too wide, shrink columns proportionally
  const maxTableWidth = parentWidth - 4;
  if (totalWidth > maxTableWidth) {
    const scale = maxTableWidth / totalWidth;
    columnWidths = columnWidths.map((w) => Math.max(3, Math.floor(w * scale)));
  }

  // Render table top border
  const tableTop = "╭" + columnWidths.map((w) => "─".repeat(w + 2)).join("┬") + "╮";
  const tableMid = "├" + columnWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
  const tableBot = "╰" + columnWidths.map((w) => "─".repeat(w + 2)).join("┴") + "╯";

  // Helper to render a row
  const renderRow = (cells: string[], isHeader: boolean) => {
    const formatted = cells.map((cell, idx) => {
      const width = columnWidths[idx] || 10;
      const truncated = cell.length > width ? cell.slice(0, width - 1) + "…" : cell;
      const padded = truncated.padEnd(width);
      return isHeader ? chalk.bold(padded) : padded;
    });
    return "│ " + formatted.join(" │ ") + " │";
  };

  // Output table inside the markdown box (no outer right border for markdown)
  const outputTableLine = (tableLine: string) => {
    console.log(chalk.magenta("│") + "  " + chalk.cyan(tableLine));
  };

  outputTableLine(tableTop);
  rows.forEach((row, idx) => {
    outputTableLine(renderRow(row, idx === 0));
    if (idx === 0 && rows.length > 1) {
      outputTableLine(tableMid);
    }
  });
  outputTableLine(tableBot);
}

function renderNestedCodeBlock(lang: string, lines: string[], parentWidth: number): void {
  const innerWidth = parentWidth - 4;
  const title = lang || "code";

  // Inner top border (cyan for contrast)
  const innerTopPadding = Math.floor((innerWidth - title.length - 4) / 2);
  const innerTopRemainder = innerWidth - title.length - 4 - innerTopPadding;
  console.log(
    chalk.magenta("│") +
      " " +
      chalk.cyan(
        "╭" +
          "─".repeat(Math.max(0, innerTopPadding)) +
          " " +
          title +
          " " +
          "─".repeat(Math.max(0, innerTopRemainder)) +
          "╮",
      ),
  );

  // Code lines
  for (const line of lines) {
    const formatted = formatCodeLine(line, lang);
    const codeWidth = innerWidth - 4;
    const wrappedLines = wrapText(formatted, codeWidth);
    for (const wrappedLine of wrappedLines) {
      const padding = codeWidth - stripAnsi(wrappedLine).length;
      console.log(
        chalk.magenta("│") +
          " " +
          chalk.cyan("│") +
          " " +
          wrappedLine +
          " ".repeat(Math.max(0, padding)) +
          " " +
          chalk.cyan("│"),
      );
    }
  }

  // Inner bottom border
  console.log(chalk.magenta("│") + " " + chalk.cyan("╰" + "─".repeat(innerWidth - 2) + "╯"));
}

function renderSimpleCodeBlock(lang: string, lines: string[]): void {
  const width = Math.min(getTerminalWidth() - 4, 100);
  const contentWidth = width - 4;

  const title = lang || "Code";
  const titleDisplay = ` ${title} `;

  const topPadding = Math.floor((width - titleDisplay.length - 2) / 2);
  const topRemainder = width - titleDisplay.length - 2 - topPadding;
  console.log(
    chalk.magenta("╭" + "─".repeat(topPadding) + titleDisplay + "─".repeat(topRemainder) + "╮"),
  );

  for (const line of lines) {
    const formatted = formatCodeLine(line, lang);
    const wrappedLines = wrapText(formatted, contentWidth);
    for (const wrappedLine of wrappedLines) {
      const padding = contentWidth - stripAnsi(wrappedLine).length;
      console.log(
        chalk.magenta("│") +
          " " +
          wrappedLine +
          " ".repeat(Math.max(0, padding)) +
          " " +
          chalk.magenta("│"),
      );
    }
  }

  console.log(chalk.magenta("╰" + "─".repeat(width - 2) + "╯"));
}

function formatCodeLine(line: string, lang: string): string {
  // Markdown lines get special formatting (not code highlighting)
  if (lang === "markdown" || lang === "md") {
    return formatMarkdownLine(line);
  }
  // Use highlight.js for all supported languages
  return highlightLine(line, lang);
}

// ============================================================================
// Markdown Line Formatting
// ============================================================================

function formatMarkdownLine(line: string): string {
  // Headers
  if (line.startsWith("# ")) {
    return chalk.green.bold(line.slice(2));
  }
  if (line.startsWith("## ")) {
    return chalk.green.bold(line.slice(3));
  }
  if (line.startsWith("### ")) {
    return chalk.green.bold(line.slice(4));
  }

  // Blockquotes
  if (line.match(/^>\s?/)) {
    const content = line.replace(/^>\s?/, "");
    const formatted = formatInlineMarkdown(content);
    return chalk.dim("▌ ") + chalk.italic(formatted);
  }

  // Horizontal rule
  if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) {
    return chalk.dim("─".repeat(40));
  }

  // HTML embedded elements
  const htmlResult = formatHtmlLine(line);
  if (htmlResult !== null) {
    return htmlResult;
  }

  // Checklist items
  if (line.match(/^(\s*)[-*]\s\[x\]\s/i)) {
    line = line.replace(/^(\s*)[-*]\s\[x\]\s/i, "$1" + chalk.green("✔ "));
  } else if (line.match(/^(\s*)[-*]\s\[\s?\]\s/)) {
    line = line.replace(/^(\s*)[-*]\s\[\s?\]\s/, "$1" + chalk.dim("☐ "));
  }

  // List items
  if (line.match(/^(\s*)[-*]\s/)) {
    line = line.replace(/^(\s*)([-*])\s/, "$1• ");
  }
  if (line.match(/^(\s*)\d+\.\s/)) {
    // Numbered list - keep as is but format content
  }

  // Inline formatting
  line = formatInlineMarkdown(line);

  return line;
}

/**
 * Handle HTML tags embedded in markdown.
 * Returns formatted string if the line is an HTML element, null otherwise.
 */
function formatHtmlLine(line: string): string | null {
  const trimmed = line.trim();

  // <details> → collapsible section indicator
  if (/^<details\s*\/?>$/i.test(trimmed) || /^<details\s+[^>]*>$/i.test(trimmed)) {
    return chalk.dim("▶ ") + chalk.dim.italic("details");
  }

  // </details>
  if (/^<\/details>$/i.test(trimmed)) {
    return chalk.dim("  ◀ end details");
  }

  // <summary>text</summary> (inline)
  const summaryInlineMatch = trimmed.match(/^<summary>(.*?)<\/summary>$/i);
  if (summaryInlineMatch) {
    const content = summaryInlineMatch[1] || "";
    return chalk.dim("▶ ") + chalk.bold(formatInlineMarkdown(content));
  }

  // <summary> (opening only)
  if (/^<summary\s*\/?>$/i.test(trimmed) || /^<summary\s+[^>]*>$/i.test(trimmed)) {
    return chalk.dim("▶ ") + chalk.dim.italic("summary:");
  }

  // </summary>
  if (/^<\/summary>$/i.test(trimmed)) {
    return ""; // Hide closing summary tag
  }

  // <br>, <br/>, <br /> → empty line
  if (/^<br\s*\/?>$/i.test(trimmed)) {
    return "";
  }

  // <hr>, <hr/>, <hr /> → horizontal rule
  if (/^<hr\s*\/?>$/i.test(trimmed)) {
    return chalk.dim("─".repeat(40));
  }

  // <h1>...<h6> inline headings
  const headingMatch = trimmed.match(/^<h([1-6])>(.*?)<\/h\1>$/i);
  if (headingMatch) {
    const content = headingMatch[2] || "";
    return chalk.green.bold(formatInlineMarkdown(content));
  }

  // <p>text</p> → just the text
  const pMatch = trimmed.match(/^<p>(.*?)<\/p>$/i);
  if (pMatch) {
    return formatInlineMarkdown(pMatch[1] || "");
  }

  // Opening/closing <p> tags alone
  if (/^<\/?p>$/i.test(trimmed)) {
    return ""; // Hide standalone <p> and </p>
  }

  // <strong>text</strong> or <b>text</b> → bold
  const boldMatch = trimmed.match(/^<(?:strong|b)>(.*?)<\/(?:strong|b)>$/i);
  if (boldMatch) {
    return chalk.bold(formatInlineMarkdown(boldMatch[1] || ""));
  }

  // <em>text</em> or <i>text</i> → italic
  const italicMatch = trimmed.match(/^<(?:em|i)>(.*?)<\/(?:em|i)>$/i);
  if (italicMatch) {
    return chalk.italic(formatInlineMarkdown(italicMatch[1] || ""));
  }

  // <code>text</code> → inline code
  const codeMatch = trimmed.match(/^<code>(.*?)<\/code>$/i);
  if (codeMatch) {
    return chalk.cyan(codeMatch[1] || "");
  }

  // <blockquote> → blockquote indicator
  if (/^<blockquote\s*>$/i.test(trimmed)) {
    return chalk.dim("▌ ");
  }
  if (/^<\/blockquote>$/i.test(trimmed)) {
    return ""; // Hide closing tag
  }

  // <ul>, <ol>, </ul>, </ol> → hide structural list tags
  if (/^<\/?[uo]l\s*>$/i.test(trimmed)) {
    return ""; // Hide list container tags
  }

  // <li>text</li> → bullet point
  const liMatch = trimmed.match(/^<li>(.*?)<\/li>$/i);
  if (liMatch) {
    return "• " + formatInlineMarkdown(liMatch[1] || "");
  }

  // Opening <li> alone
  if (/^<li\s*>$/i.test(trimmed)) {
    return "• ";
  }
  // Closing </li>
  if (/^<\/li>$/i.test(trimmed)) {
    return ""; // Hide closing tag
  }

  // <div> / </div> → hide structural divs
  if (/^<\/?div\s*[^>]*>$/i.test(trimmed)) {
    return ""; // Hide div tags
  }

  // <span>text</span> → just show the text
  const spanMatch = trimmed.match(/^<span[^>]*>(.*?)<\/span>$/i);
  if (spanMatch) {
    return formatInlineMarkdown(spanMatch[1] || "");
  }

  // <img ... alt="text" /> → show alt text
  const imgMatch = trimmed.match(/^<img\s[^>]*alt=["']([^"']*)["'][^>]*\/?>$/i);
  if (imgMatch) {
    return chalk.dim("[image: ") + chalk.italic(imgMatch[1] || "") + chalk.dim("]");
  }

  // <a href="url">text</a> → show text as link
  const aMatch = trimmed.match(/^<a\s[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>$/i);
  if (aMatch) {
    return chalk.blue.underline(aMatch[2] || aMatch[1] || "");
  }

  // Generic: any remaining standalone HTML tag (opening or closing) → dim it
  if (/^<\/?[a-z][a-z0-9]*(\s[^>]*)?\s*\/?>$/i.test(trimmed)) {
    return chalk.dim(trimmed);
  }

  // Lines with mixed HTML inline tags → strip HTML and format
  if (/<[a-z][a-z0-9]*(\s[^>]*)?\s*\/?>/i.test(trimmed) && /<\/[a-z][a-z0-9]*>/i.test(trimmed)) {
    // SECURITY: Use whitelist approach - only convert known-safe tags to markdown
    // Extract text content and safe formatting, discard all other HTML
    let stripped = trimmed;

    // Convert safe formatting tags to markdown equivalents
    stripped = stripped
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/?(?:strong|b)>/gi, "**")
      .replace(/<\/?(?:em|i)>/gi, "*")
      .replace(/<\/?code>/gi, "`")
      .replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>/gi, "")
      .replace(/<\/a>/gi, "");

    // Strip ALL remaining HTML tags completely (including script, style, iframe, etc.)
    // Use a loop to ensure complete removal - prevents CodeQL incomplete sanitization warning
    let prevStripped = "";
    while (prevStripped !== stripped) {
      prevStripped = stripped;
      stripped = stripped.replace(/<[^>]*>/g, "");
    }

    // Decode only safe HTML entities - NEVER decode < or > to prevent tag reintroduction
    stripped = stripped
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&"); // Must be last to avoid double-unescaping

    return formatInlineMarkdown(stripped);
  }

  return null; // Not an HTML line, handle normally
}

function formatInlineMarkdown(text: string): string {
  // Bold + Italic (***text***)
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, content) => chalk.bold.italic(content));

  // Bold (**text**)
  text = text.replace(/\*\*(.+?)\*\*/g, (_, content) => chalk.bold(content));

  // Italic (*text* or _text_)
  text = text.replace(/\*([^*]+)\*/g, (_, content) => chalk.italic(content));
  text = text.replace(/_([^_]+)_/g, (_, content) => chalk.italic(content));

  // Inline code (`code`)
  text = text.replace(/`([^`]+)`/g, (_, content) => chalk.cyan(content));

  // Strikethrough (~~text~~)
  text = text.replace(/~~(.+?)~~/g, (_, content) => chalk.strikethrough(content));

  // Links [text](url) - show text in blue
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, (_, linkText) => chalk.blue.underline(linkText));

  return text;
}

// ============================================================================
// Utility Functions
// ============================================================================

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const plainText = stripAnsi(text);
  if (plainText.length <= maxWidth) {
    return [text];
  }

  // For ANSI-safe wrapping: operate on plain text to find break points,
  // then slice the original string at corresponding positions.
  const lines: string[] = [];
  let remaining = text;

  while (stripAnsi(remaining).length > maxWidth) {
    const plain = stripAnsi(remaining);

    // Find break point on plain text
    let breakPoint = maxWidth;
    const lastSpace = plain.lastIndexOf(" ", maxWidth);
    if (lastSpace > maxWidth * 0.5) {
      breakPoint = lastSpace;
    }

    // Map plain text position to position in ANSI string
    // eslint-disable-next-line no-control-regex -- Intentional: must match literal ANSI escape sequences
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    let match: RegExpExecArray | null;
    const ansiPositions: Array<{ start: number; end: number }> = [];

    ansiRegex.lastIndex = 0;
    while ((match = ansiRegex.exec(remaining)) !== null) {
      ansiPositions.push({ start: match.index, end: match.index + match[0].length });
    }

    let rawPos = 0;
    let visualPos = 0;
    let ansiIdx = 0;

    while (visualPos < breakPoint && rawPos < remaining.length) {
      // Skip any ANSI sequences at current position
      while (ansiIdx < ansiPositions.length && ansiPositions[ansiIdx]!.start === rawPos) {
        rawPos = ansiPositions[ansiIdx]!.end;
        ansiIdx++;
      }
      if (rawPos >= remaining.length) break;
      rawPos++;
      visualPos++;
    }

    // Include any trailing ANSI sequences at the break point
    while (ansiIdx < ansiPositions.length && ansiPositions[ansiIdx]!.start === rawPos) {
      rawPos = ansiPositions[ansiIdx]!.end;
      ansiIdx++;
    }

    lines.push(remaining.slice(0, rawPos));
    remaining = remaining.slice(rawPos).trimStart();
  }

  if (remaining) {
    lines.push(remaining);
  }

  return lines.length > 0 ? lines : [text];
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ============================================================================
// Tool Icons and Rendering
// ============================================================================

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

function getToolIcon(toolName: string, input?: Record<string, unknown>): string {
  if (toolName === "write_file" && input) {
    const wouldCreate = input.wouldCreate === true;
    return wouldCreate
      ? (TOOL_ICONS.write_file_create ?? "📝+")
      : (TOOL_ICONS.write_file_modify ?? "✏️");
  }
  return TOOL_ICONS[toolName] ?? "🔧";
}

export function renderToolStart(
  toolName: string,
  input: Record<string, unknown>,
  metadata?: { isCreate?: boolean },
): void {
  const icon = getToolIcon(toolName, { ...input, wouldCreate: metadata?.isCreate });
  const summary = formatToolSummary(toolName, input);

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

export function renderToolEnd(result: ExecutedToolCall): void {
  const status = result.result.success ? chalk.green("✓") : chalk.red("✗");
  const duration = chalk.dim(`${result.duration.toFixed(0)}ms`);
  const preview = formatResultPreview(result);
  console.log(`  ${status} ${duration}${preview ? ` ${preview}` : ""}`);

  if (!result.result.success && result.result.error) {
    console.log(chalk.red(`  └─ ${result.result.error}`));
  }
}

function formatToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
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
      return cmd.length > 50 ? cmd.slice(0, 47) + "..." : cmd;
    }
    default:
      return formatToolInput(input);
  }
}

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

// ============================================================================
// Message Rendering
// ============================================================================

export function renderUsageStats(
  inputTokens: number,
  outputTokens: number,
  toolCallCount: number,
): void {
  const totalTokens = inputTokens + outputTokens;
  const toolsStr = toolCallCount > 0 ? ` · ${toolCallCount} tools` : "";
  console.log(chalk.dim(`─ ${totalTokens.toLocaleString()} tokens${toolsStr}`));
}

export function renderError(message: string): void {
  console.error(chalk.red(`✗ Error: ${message}`));
}

export function renderInfo(message: string): void {
  console.log(chalk.dim(message));
}

export function renderSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function renderWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

// ============================================================================
// Code Highlighting (delegates to syntax.ts / highlight.js)
// ============================================================================

export function highlightCode(code: string): string {
  return highlightBlock(code, "typescript");
}

// ============================================================================
// Legacy Exports
// ============================================================================

export function resetTypewriter(): void {
  resetLineBuffer();
}

export function getTypewriter(): { flush: () => void; waitForComplete: () => Promise<void> } {
  return {
    flush: flushLineBuffer,
    waitForComplete: () => Promise.resolve(),
  };
}

export function renderStreamChunkImmediate(chunk: StreamChunk): void {
  if (chunk.type === "text" && chunk.text) {
    process.stdout.write(chunk.text);
  }
}
