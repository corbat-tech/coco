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
import { diffLines, diffWords } from "diff";
import type { StreamChunk } from "../../../providers/types.js";
import type { ExecutedToolCall } from "../types.js";
import { highlightLine, highlightBlock } from "./syntax.js";
import {
  storeBlock,
  resetBlockStore,
  getBlock,
  getLastBlock,
  getBlockCount,
} from "./block-store.js";
// DiffLine type used in renderEditPreview
interface DiffLine {
  type: "add" | "delete" | "context";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export { getBlock, getLastBlock, getBlockCount };

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
/** Track nested code blocks inside an outer block (e.g. ```python inside ```markdown).
 *  A nested opener (```lang) is accumulated as content; its closing ``` does NOT
 *  close the outer block — only a bare ``` outside a nested block does. */
let inNestedCodeBlock = false;
/** Fence character that opened the current outer code block: "```" or "~~~". */
let codeBlockFenceChar = "";

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
    codeBlockFenceChar = "";
    codeBlockLang = "";
    codeBlockLines = [];
  }
}

export function resetLineBuffer(): void {
  lineBuffer = "";
  inCodeBlock = false;
  inNestedCodeBlock = false;
  codeBlockFenceChar = "";
  codeBlockLang = "";
  codeBlockLines = [];
  stopStreamingIndicator();
  resetBlockStore();
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
  // Strip invisible Unicode characters that some LLMs inject at line starts
  // (BOM U+FEFF, zero-width space U+200B, etc.) — these break startsWith() matching.
  // oxlint: no-misleading-character-class flags ZWJ in char classes; use alternation instead
  line = line.replace(/^(?:\u{200B}|\u{FEFF}|\u{200C}|\u{200D}|\u{2060}|\u{00AD})+/u, "");

  // ── Tilde fence detection (~~~lang opens a block; bare ~~~ closes or is text) ──
  const tildeFenceMatch = line.match(/^~~~(\w*)$/);

  if (tildeFenceMatch) {
    const lang = tildeFenceMatch[1] || "";

    if (!inCodeBlock) {
      if (lang) {
        // ~~~lang at top level → open outer tilde block (bare ~~~ stays as plain text)
        inCodeBlock = true;
        inNestedCodeBlock = false;
        codeBlockFenceChar = "~~~";
        codeBlockLang = lang;
        codeBlockLines = [];
        if (codeBlockLang === "markdown" || codeBlockLang === "md") {
          startStreamingIndicator();
        }
      } else {
        // Bare ~~~ at top level → regular text
        const formatted = formatMarkdownLine(line);
        const termWidth = getTerminalWidth();
        const wrapped = wrapText(formatted, termWidth);
        for (const wl of wrapped) {
          console.log(wl);
        }
      }
    } else if (codeBlockFenceChar === "~~~") {
      // Inside a tilde outer block
      if (lang && !inNestedCodeBlock) {
        // ~~~lang → open nested tilde block, accumulate
        inNestedCodeBlock = true;
        codeBlockLines.push(line);
      } else if (!lang && inNestedCodeBlock) {
        // bare ~~~ → close nested tilde block, accumulate
        inNestedCodeBlock = false;
        codeBlockLines.push(line);
      } else if (!lang && !inNestedCodeBlock) {
        // bare ~~~ outside any nested block → close the outer tilde block
        stopStreamingIndicator();
        renderCodeBlock(codeBlockLang, codeBlockLines);
        inCodeBlock = false;
        inNestedCodeBlock = false;
        codeBlockFenceChar = "";
        codeBlockLang = "";
        codeBlockLines = [];
      } else {
        // ~~~lang inside already-nested → accumulate as content
        codeBlockLines.push(line);
      }
    } else {
      // Inside a backtick outer block (codeBlockFenceChar === "```")
      if (lang && !inNestedCodeBlock) {
        // ~~~lang → cross-char nested open, accumulate
        inNestedCodeBlock = true;
        codeBlockLines.push(line);
      } else if (!lang && inNestedCodeBlock) {
        // bare ~~~ → close cross-char nested block, accumulate
        inNestedCodeBlock = false;
        codeBlockLines.push(line);
      } else {
        // bare ~~~ with no nested block, or ~~~lang inside already-nested → content
        codeBlockLines.push(line);
      }
    }
    return;
  }

  // ── Backtick fence detection (```lang / ``` or ````lang / ````) ──────────
  // Matches exactly 3 or 4 backticks followed by optional word chars.
  // A 4-backtick outer block (````markdown) can only be closed by ````.
  // A bare ``` (3bt) can NEVER close a ```` (4bt) outer → eliminates the
  // "premature close" ambiguity when the LLM uses ``` for inner blocks.
  const codeBlockMatch = line.match(/^(`{3,4})(\w*)$/);

  if (codeBlockMatch) {
    const fenceChars = codeBlockMatch[1]!; // "```" or "````"
    const lang = codeBlockMatch[2] || "";

    if (!inCodeBlock) {
      // Opening the outer block (3bt or 4bt)
      inCodeBlock = true;
      inNestedCodeBlock = false;
      codeBlockFenceChar = fenceChars;
      codeBlockLang = lang;
      codeBlockLines = [];
      if (codeBlockLang === "markdown" || codeBlockLang === "md") {
        startStreamingIndicator();
      }
    } else if (!lang && inNestedCodeBlock && fenceChars === "```") {
      // Bare ``` closes a backtick-opened nested block — accumulate
      inNestedCodeBlock = false;
      codeBlockLines.push(line);
    } else if (!inNestedCodeBlock && lang && fenceChars === "```") {
      // ```lang inside outer block → open nested block, accumulate
      inNestedCodeBlock = true;
      codeBlockLines.push(line);
    } else if (!lang && !inNestedCodeBlock && codeBlockFenceChar === fenceChars) {
      // Bare fence whose length matches the outer → close the outer block
      stopStreamingIndicator();
      renderCodeBlock(codeBlockLang, codeBlockLines);
      inCodeBlock = false;
      inNestedCodeBlock = false;
      codeBlockFenceChar = "";
      codeBlockLang = "";
      codeBlockLines = [];
    } else {
      // Anything else (wrong fence length, nested-inside-nested, etc.) → content
      codeBlockLines.push(line);
    }
    return;
  }

  if (inCodeBlock) {
    // Accumulate code block content
    codeBlockLines.push(line);
  } else {
    // Render as formatted markdown line, word-wrapping at terminal width
    const formatted = formatMarkdownLine(line);
    const termWidth = getTerminalWidth();
    const wrapped = wrapText(formatted, termWidth);
    for (const wl of wrapped) {
      console.log(wl);
    }
  }
}

// ============================================================================
// Code Block Rendering (Box Style)
// ============================================================================

function renderCodeBlock(lang: string, lines: string[]): void {
  const blockId = storeBlock(lang, lines);

  // For markdown blocks, render with box but process nested code blocks
  if (lang === "markdown" || lang === "md") {
    renderMarkdownBlock(lines, blockId);
    return;
  }

  // Regular code block rendering
  renderSimpleCodeBlock(lang, lines, blockId);
}

function renderMarkdownBlock(lines: string[], blockId: number): void {
  const width = Math.min(getTerminalWidth() - 4, 100);
  const contentWidth = width - 4;

  // Short top border with "Markdown" title and block ID
  const title = "Markdown";
  const idTag = chalk.dim(` · #${blockId}`);
  console.log(chalk.magenta("╭── " + title) + idTag + chalk.magenta(" ──"));

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

  // Short bottom border with copy hint
  const copyHint = ` #${blockId} · /copy ${blockId} `;
  console.log(chalk.magenta("╰──") + chalk.dim(copyHint) + chalk.magenta("──"));
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
  const isDiff = lang === "diff" || (!lang && looksLikeDiff(lines));

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

  const bgDel = chalk.bgRgb(80, 20, 20);
  const bgAdd = chalk.bgRgb(20, 60, 20);

  // Code lines
  for (const line of lines) {
    const formatted = formatCodeLine(line, lang);
    const codeWidth = innerWidth - 4;
    const wrappedLines = wrapText(formatted, codeWidth);
    for (const wrappedLine of wrappedLines) {
      const padding = Math.max(0, codeWidth - stripAnsi(wrappedLine).length);
      if (isDiff && isDiffDeletion(line)) {
        console.log(
          chalk.magenta("│") +
            " " +
            chalk.cyan("│") +
            bgDel(" " + wrappedLine + " ".repeat(padding) + " ") +
            chalk.cyan("│"),
        );
      } else if (isDiff && isDiffAddition(line)) {
        console.log(
          chalk.magenta("│") +
            " " +
            chalk.cyan("│") +
            bgAdd(" " + wrappedLine + " ".repeat(padding) + " ") +
            chalk.cyan("│"),
        );
      } else {
        console.log(
          chalk.magenta("│") +
            " " +
            chalk.cyan("│") +
            " " +
            wrappedLine +
            " ".repeat(padding) +
            " " +
            chalk.cyan("│"),
        );
      }
    }
  }

  // Inner bottom border
  console.log(chalk.magenta("│") + " " + chalk.cyan("╰" + "─".repeat(innerWidth - 2) + "╯"));
}

/** Detect unified diff content by checking for typical headers */
function looksLikeDiff(lines: string[]): boolean {
  // Check first 5 lines for unified diff markers
  const head = lines.slice(0, 5);
  return head.some((l) => l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("@@ "));
}

/** Check if a line in a diff block should get deletion background */
function isDiffDeletion(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---");
}

/** Check if a line in a diff block should get addition background */
function isDiffAddition(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++");
}

function renderSimpleCodeBlock(lang: string, lines: string[], blockId: number): void {
  const isDiff = lang === "diff" || (!lang && looksLikeDiff(lines));

  // Show title header without box borders
  const title = lang || "Code";
  console.log(chalk.dim(`${title} · #${blockId}`));

  const bgDel = chalk.bgRgb(80, 20, 20);
  const bgAdd = chalk.bgRgb(20, 60, 20);

  // Track line numbers from @@ hunk headers for diff blocks
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of lines) {
    // Parse @@ headers to update line counters
    if (isDiff) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        oldLineNo = parseInt(hunkMatch[1]!, 10);
        newLineNo = parseInt(hunkMatch[2]!, 10);
      }
    }

    const formatted = formatCodeLine(line, lang);
    const lineNoStr = isDiff ? formatDiffLineNo(line, oldLineNo, newLineNo) : "";

    if (isDiff && isDiffDeletion(line)) {
      console.log(bgDel("  " + lineNoStr + formatted));
    } else if (isDiff && isDiffAddition(line)) {
      console.log(bgAdd("  " + lineNoStr + formatted));
    } else {
      console.log("  " + lineNoStr + formatted);
    }

    // Advance line counters after rendering
    if (isDiff) {
      if (isDiffDeletion(line)) {
        oldLineNo++;
      } else if (isDiffAddition(line)) {
        newLineNo++;
      } else if (
        !line.startsWith("@@") &&
        !line.startsWith("diff ") &&
        !line.startsWith("index ") &&
        !line.startsWith("---") &&
        !line.startsWith("+++")
      ) {
        // Context line — advances both
        oldLineNo++;
        newLineNo++;
      }
    }
  }

  // Show copy hint at the end
  console.log(chalk.dim(`  #${blockId} · /copy ${blockId}`));
}

/** Format line number for diff code blocks */
function formatDiffLineNo(line: string, oldLineNo: number, newLineNo: number): string {
  if (isDiffDeletion(line)) {
    return chalk.dim(String(oldLineNo).padStart(5) + " ");
  } else if (isDiffAddition(line)) {
    return chalk.dim(String(newLineNo).padStart(5) + " ");
  } else if (
    line.startsWith("@@") ||
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "       "; // 7 chars blank for headers
  }
  // Context line — show new line number
  return chalk.dim(String(newLineNo).padStart(5) + " ");
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

  while (true) {
    const plain = stripAnsi(remaining);
    if (plain.length <= maxWidth) break;

    // Find break point on plain text
    let breakPoint = maxWidth;
    const lastSpace = plain.lastIndexOf(" ", maxWidth);
    // Only break at a word boundary if it keeps at least half the line width
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

    // Reset ANSI color state at the break so active colors don't bleed into the next line
    lines.push(remaining.slice(0, rawPos) + "\x1b[0m");
    remaining = "\x1b[0m" + remaining.slice(rawPos).trimStart();
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

  if (toolName === "write_file") {
    const label = metadata?.isCreate
      ? chalk.green.bold("CREATE") + " " + chalk.cyan(String(input.path || ""))
      : chalk.yellow.bold("MODIFY") + " " + chalk.cyan(String(input.path || ""));
    console.log(`\n${icon} ${label}`);
    const preview = renderContentPreview(String(input.content || ""), 3);
    if (preview) console.log(preview);
    return;
  }

  if (toolName === "edit_file") {
    console.log(`\n${icon} ${chalk.yellow.bold("EDIT")} ${chalk.cyan(String(input.path || ""))}`);
    // Print diff sequentially instead of buffering for immediate feedback
    printEditDiff(
      String(input.oldText || ""),
      String(input.newText || ""),
    );
    return;
  }

  console.log(`\n${icon} ${chalk.cyan.bold(toolName)} ${chalk.dim(summary)}`);
}

/** Show first N non-empty lines of file content, indented and dimmed */
function renderContentPreview(content: string, maxLines: number): string {
  const maxWidth = Math.max(getTerminalWidth() - 6, 40);
  const lines = content.split("\n");
  const preview: string[] = [];

  for (const line of lines) {
    if (preview.length >= maxLines) break;
    const trimmed = line.trimEnd();
    // Skip leading blank lines
    if (trimmed.length === 0 && preview.length === 0) continue;
    const truncated = trimmed.length > maxWidth ? trimmed.slice(0, maxWidth - 1) + "…" : trimmed;
    preview.push(`   ${truncated}`);
  }

  if (preview.length === 0) return "";

  const totalNonEmpty = lines.filter((l) => l.trim().length > 0).length;
  const more = totalNonEmpty > maxLines ? chalk.dim(` … +${totalNonEmpty - maxLines} lines`) : "";
  return chalk.dim(preview.join("\n")) + more;
}

/** Identify adjacent delete→add pairs for word-level highlighting */
function pairAdjacentDiffLines(lines: DiffLine[]): Array<{ deleteIdx: number; addIdx: number }> {
  const pairs: Array<{ deleteIdx: number; addIdx: number }> = [];
  let i = 0;

  while (i < lines.length) {
    const deleteStart = i;
    while (i < lines.length && lines[i]!.type === "delete") i++;
    const deleteEnd = i;
    const addStart = i;
    while (i < lines.length && lines[i]!.type === "add") i++;
    const addEnd = i;

    const deleteCount = deleteEnd - deleteStart;
    const addCount = addEnd - addStart;
    if (deleteCount > 0 && addCount > 0) {
      const pairCount = Math.min(deleteCount, addCount);
      for (let j = 0; j < pairCount; j++) {
        pairs.push({ deleteIdx: deleteStart + j, addIdx: addStart + j });
      }
    }
    if (i === deleteEnd && i === addEnd) i++;
  }

  return pairs;
}

// ── Diff color palette (Claude Code–inspired) ────────────────────────────────
// Lazy helpers evaluated at call time so they work in test environments (no TTY).
// bgRgb returns a Chalk builder; we call it as a function directly on the string
// rather than chaining .white (which may not be callable in all environments).
function diffBgDel(s: string): string {
  return chalk.bgRgb ? chalk.bgRgb(60, 0, 0)(s) : chalk.bgRed(s);
}
function diffBgAdd(s: string): string {
  return chalk.bgRgb ? chalk.bgRgb(0, 50, 0)(s) : chalk.bgGreen(s);
}
function diffBgDelWord(s: string): string {
  return chalk.bgRgb ? chalk.bgRgb(140, 30, 30)(s) : chalk.bgRed.bold(s);
}
function diffBgAddWord(s: string): string {
  return chalk.bgRgb ? chalk.bgRgb(30, 120, 30)(s) : chalk.bgGreen.bold(s);
}

/** Word-level diff highlighting using diffWords from the diff package */
function wordLevelHighlight(
  deletedContent: string,
  addedContent: string,
): { styledDelete: string; styledAdd: string } {
  const changes = diffWords(deletedContent, addedContent);
  let styledDelete = "";
  let styledAdd = "";

  for (const change of changes) {
    if (change.added) {
      styledAdd += diffBgAddWord(change.value);
    } else if (change.removed) {
      styledDelete += diffBgDelWord(change.value);
    } else {
      styledDelete += diffBgDel(change.value);
      styledAdd += diffBgAdd(change.value);
    }
  }

  return { styledDelete, styledAdd };
}

/**
 * Print edit diff sequentially to console (line-by-line, no buffering).
 * This provides immediate visual feedback instead of waiting for full render.
 */
function printEditDiff(oldStr: string, newStr: string): void {
  // Content width = terminal - indent(2) - gutter(old4 + │ + new4 + │ + sign1 + space1) = -14
  const termWidth = Math.max(getTerminalWidth() - 14, 30);
  const MAX_SHOWN = 30;

  // Pure insertion (empty old) — show compact green block, no line-number columns
  if (!oldStr.trim()) {
    const lines = newStr
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(0, 6);
    if (lines.length === 0) return;
    const truncate = (s: string) =>
      s.length > termWidth - 2 ? s.slice(0, termWidth - 3) + "…" : s;
    for (const l of lines) {
      const text = `+ ${truncate(l)}`;
      const pad = Math.max(0, termWidth - stripAnsi(text).length + 2);
      console.log("  " + diffBgAdd(text + " ".repeat(pad)));
    }
    return;
  }

  if (!newStr.trim() && !oldStr.trim()) return;

  // ── Build DiffLine array ─────────────────────────────────────────────────
  const changes = diffLines(oldStr, newStr);
  const diffLineList: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const change of changes) {
    const value = change.value.endsWith("\n") ? change.value.slice(0, -1) : change.value;
    for (const line of value.split("\n")) {
      if (change.added) {
        diffLineList.push({ type: "add", content: line, newLineNo: newNo++ });
      } else if (change.removed) {
        diffLineList.push({ type: "delete", content: line, oldLineNo: oldNo++ });
      } else {
        diffLineList.push({
          type: "context",
          content: line,
          oldLineNo: oldNo++,
          newLineNo: newNo++,
        });
      }
    }
  }

  if (diffLineList.length === 0) return;

  // ── Word-level highlights for adjacent delete→add pairs ──────────────────
  const pairs = pairAdjacentDiffLines(diffLineList);
  const pairedDeletes = new Set(pairs.map((p) => p.deleteIdx));
  const pairedAdds = new Set(pairs.map((p) => p.addIdx));
  const pairByAdd = new Map(pairs.map((p) => [p.addIdx, p.deleteIdx]));
  const wordHighlights = new Map<number, { styledDelete: string; styledAdd: string }>();
  for (const pair of pairs) {
    const del = diffLineList[pair.deleteIdx];
    const add = diffLineList[pair.addIdx];
    if (del && add)
      wordHighlights.set(pair.deleteIdx, wordLevelHighlight(del.content, add.content));
  }

  // ── Compute visible indices (changed ± 2 context lines) ──────────────────
  const changedIndices = new Set(
    diffLineList.map((l, i) => (l.type !== "context" ? i : -1)).filter((i) => i >= 0),
  );
  const visibleIndices = new Set<number>();
  for (const idx of changedIndices) {
    for (let d = -2; d <= 2; d++) {
      const n = idx + d;
      if (n >= 0 && n < diffLineList.length) visibleIndices.add(n);
    }
  }

  // ── Render sequentially (print line by line) ─────────────────────────────
  let shown = 0;
  let prevIdx = -1;
  const truncate = (s: string) => (s.length > termWidth ? s.slice(0, termWidth - 1) + "…" : s);

  // Helper: two-column gutter  "  4│  5│"
  const gutter = (oldN: number | undefined, newN: number | undefined): string => {
    const o = oldN !== undefined ? String(oldN).padStart(4) : "    ";
    const n = newN !== undefined ? String(newN).padStart(4) : "    ";
    return chalk.dim(`${o}│${n}│`);
  };

  for (let i = 0; i < diffLineList.length; i++) {
    if (!visibleIndices.has(i)) continue;
    if (shown >= MAX_SHOWN) {
      console.log(chalk.dim(`  … +${diffLineList.length - i} more lines`));
      break;
    }

    // Gap separator between non-contiguous hunks
    if (prevIdx >= 0 && i > prevIdx + 1) {
      console.log(chalk.dim("      ⋮"));
    }
    prevIdx = i;
    shown++;

    const dl = diffLineList[i]!;

    if (dl.type === "add") {
      const rawContent = pairedAdds.has(i)
        ? (wordHighlights.get(pairByAdd.get(i)!)?.styledAdd ?? truncate(dl.content))
        : truncate(dl.content);
      const visLen = stripAnsi(rawContent).length;
      const pad = Math.max(0, termWidth - visLen);
      const line = diffBgAdd(` + ${rawContent}${" ".repeat(pad)}`);
      console.log("  " + gutter(undefined, dl.newLineNo) + line);
    } else if (dl.type === "delete") {
      const rawContent = pairedDeletes.has(i)
        ? (wordHighlights.get(i)?.styledDelete ?? truncate(dl.content))
        : truncate(dl.content);
      const visLen = stripAnsi(rawContent).length;
      const pad = Math.max(0, termWidth - visLen);
      const line = diffBgDel(` - ${rawContent}${" ".repeat(pad)}`);
      console.log("  " + gutter(dl.oldLineNo, undefined) + line);
    } else {
      console.log(
        "  " + gutter(dl.oldLineNo, dl.newLineNo) + chalk.dim(`   ${truncate(dl.content)}`),
      );
    }
  }
}

/**
 * Render a visual diff for edit_file / write_file (modify).
 *
 * Design (Claude Code–inspired):
 * - Two-column line numbers: old│new, right-aligned in 4 chars each
 * - Full-width red/green background on changed lines
 * - Brighter word-level accent for changed words within a line
 * - ⋮ gap separator between non-contiguous hunks
 * - Max 30 lines shown, then "… +N more" guard
 */
export function renderEditPreview(oldStr: string, newStr: string): string {
  // Content width = terminal - indent(2) - gutter(old4 + │ + new4 + │ + sign1 + space1) = -14
  const termWidth = Math.max(getTerminalWidth() - 14, 30);
  const MAX_SHOWN = 30;

  // Pure insertion (empty old) — show compact green block, no line-number columns
  if (!oldStr.trim()) {
    const lines = newStr
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(0, 6);
    if (lines.length === 0) return "";
    const truncate = (s: string) =>
      s.length > termWidth - 2 ? s.slice(0, termWidth - 3) + "…" : s;
    return lines
      .map((l) => {
        const text = `+ ${truncate(l)}`;
        const pad = Math.max(0, termWidth - stripAnsi(text).length + 2);
        return "  " + diffBgAdd(text + " ".repeat(pad));
      })
      .join("\n");
  }

  if (!newStr.trim() && !oldStr.trim()) return "";

  // ── Build DiffLine array ─────────────────────────────────────────────────
  const changes = diffLines(oldStr, newStr);
  const diffLineList: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const change of changes) {
    const value = change.value.endsWith("\n") ? change.value.slice(0, -1) : change.value;
    for (const line of value.split("\n")) {
      if (change.added) {
        diffLineList.push({ type: "add", content: line, newLineNo: newNo++ });
      } else if (change.removed) {
        diffLineList.push({ type: "delete", content: line, oldLineNo: oldNo++ });
      } else {
        diffLineList.push({
          type: "context",
          content: line,
          oldLineNo: oldNo++,
          newLineNo: newNo++,
        });
      }
    }
  }

  if (diffLineList.length === 0) return "";

  // ── Word-level highlights for adjacent delete→add pairs ──────────────────
  const pairs = pairAdjacentDiffLines(diffLineList);
  const pairedDeletes = new Set(pairs.map((p) => p.deleteIdx));
  const pairedAdds = new Set(pairs.map((p) => p.addIdx));
  const pairByAdd = new Map(pairs.map((p) => [p.addIdx, p.deleteIdx]));
  const wordHighlights = new Map<number, { styledDelete: string; styledAdd: string }>();
  for (const pair of pairs) {
    const del = diffLineList[pair.deleteIdx];
    const add = diffLineList[pair.addIdx];
    if (del && add)
      wordHighlights.set(pair.deleteIdx, wordLevelHighlight(del.content, add.content));
  }

  // ── Compute visible indices (changed ± 2 context lines) ──────────────────
  const changedIndices = new Set(
    diffLineList.map((l, i) => (l.type !== "context" ? i : -1)).filter((i) => i >= 0),
  );
  const visibleIndices = new Set<number>();
  for (const idx of changedIndices) {
    for (let d = -2; d <= 2; d++) {
      const n = idx + d;
      if (n >= 0 && n < diffLineList.length) visibleIndices.add(n);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const result: string[] = [];
  let shown = 0;
  let prevIdx = -1;
  const truncate = (s: string) => (s.length > termWidth ? s.slice(0, termWidth - 1) + "…" : s);

  // Helper: two-column gutter  "  4│  5│"
  const gutter = (oldN: number | undefined, newN: number | undefined): string => {
    const o = oldN !== undefined ? String(oldN).padStart(4) : "    ";
    const n = newN !== undefined ? String(newN).padStart(4) : "    ";
    return chalk.dim(`${o}│${n}│`);
  };

  for (let i = 0; i < diffLineList.length; i++) {
    if (!visibleIndices.has(i)) continue;
    if (shown >= MAX_SHOWN) {
      result.push(chalk.dim(`  … +${diffLineList.length - i} more lines`));
      break;
    }

    // Gap separator between non-contiguous hunks
    if (prevIdx >= 0 && i > prevIdx + 1) {
      result.push(chalk.dim("      ⋮"));
    }
    prevIdx = i;
    shown++;

    const dl = diffLineList[i]!;

    if (dl.type === "add") {
      const rawContent = pairedAdds.has(i)
        ? (wordHighlights.get(pairByAdd.get(i)!)?.styledAdd ?? truncate(dl.content))
        : truncate(dl.content);
      const visLen = stripAnsi(rawContent).length;
      const pad = Math.max(0, termWidth - visLen);
      const line = diffBgAdd(` + ${rawContent}${" ".repeat(pad)}`);
      result.push("  " + gutter(undefined, dl.newLineNo) + line);
    } else if (dl.type === "delete") {
      const rawContent = pairedDeletes.has(i)
        ? (wordHighlights.get(i)?.styledDelete ?? truncate(dl.content))
        : truncate(dl.content);
      const visLen = stripAnsi(rawContent).length;
      const pad = Math.max(0, termWidth - visLen);
      const line = diffBgDel(` - ${rawContent}${" ".repeat(pad)}`);
      result.push("  " + gutter(dl.oldLineNo, undefined) + line);
    } else {
      result.push(
        "  " + gutter(dl.oldLineNo, dl.newLineNo) + chalk.dim(`   ${truncate(dl.content)}`),
      );
    }
  }

  return result.join("\n");
}

export function renderToolEnd(result: ExecutedToolCall): void {
  const status = result.result.success ? chalk.green("✓") : chalk.red("✗");
  const duration = chalk.dim(`${result.duration.toFixed(0)}ms`);
  const preview = formatResultPreview(result);
  console.log(`  ${status} ${duration}${preview ? ` ${preview}` : ""}`);

  if (!result.result.success && result.result.error) {
    console.log(chalk.red(`  └─ ${result.result.error}`));
  }

  // Show result details (match lines, stdout snippets) when meaningful
  const details = formatResultDetails(result);
  if (details) console.log(details);
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
    case "grep":
    case "search_files": {
      const pattern = String(input.pattern || "");
      const path = input.path ? ` in ${input.path}` : "";
      return `"${pattern}"${path}`;
    }
    case "bash_exec": {
      const cmd = String(input.command || "");
      const max = Math.max(getTerminalWidth() - 20, 50);
      return cmd.length > max ? cmd.slice(0, max - 1) + "…" : cmd;
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
      case "grep":
      case "search_files":
        if (Array.isArray(data.matches)) {
          const n = data.matches.length;
          return n === 0
            ? chalk.yellow("· no matches")
            : chalk.dim(`· ${n} match${n === 1 ? "" : "es"}`);
        }
        break;
      case "bash_exec":
        if (data.exitCode !== undefined && data.exitCode !== 0) {
          return chalk.red(`(exit ${data.exitCode})`);
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

/** Render extra detail lines below the status line for grep matches and bash output */
function formatResultDetails(result: ExecutedToolCall): string {
  if (!result.result.success) return "";

  const { name, result: toolResult } = result;
  const maxWidth = Math.max(getTerminalWidth() - 8, 40);

  try {
    const data = JSON.parse(toolResult.output);

    if ((name === "grep" || name === "search_files") && Array.isArray(data.matches)) {
      const matches: Array<{ file: string; line: number; content: string }> = data.matches;
      if (matches.length === 0) return "";

      const MAX_SHOWN = 3;
      const shown = matches.slice(0, MAX_SHOWN);
      const lines = shown.map(({ file, line, content }) => {
        const location = chalk.cyan(`${file}:${line}`);
        const snippet = content.trim();
        const truncated =
          snippet.length > maxWidth ? snippet.slice(0, maxWidth - 1) + "…" : snippet;
        return `  ${chalk.dim("│")} ${location} ${chalk.dim(truncated)}`;
      });

      if (matches.length > MAX_SHOWN) {
        lines.push(`  ${chalk.dim(`│ … +${matches.length - MAX_SHOWN} more`)}`);
      }
      return lines.join("\n");
    }

    if (name === "bash_exec" && data.exitCode === 0) {
      const stdout = String(data.stdout || "").trimEnd();
      if (!stdout) return "";
      const outputLines = stdout.split("\n").filter((l: string) => l.trim());
      // Only show inline preview if output is short enough to be meaningful
      if (outputLines.length > 6) return "";
      const shown = outputLines.slice(0, 4);
      const lines = shown.map((l: string) => {
        const truncated = l.length > maxWidth ? l.slice(0, maxWidth - 1) + "…" : l;
        return `  ${chalk.dim("│")} ${chalk.dim(truncated)}`;
      });
      if (outputLines.length > 4) {
        lines.push(`  ${chalk.dim(`│ … +${outputLines.length - 4} more`)}`);
      }
      return lines.join("\n");
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
  console.log(chalk.dim(`─ ${totalTokens.toLocaleString("en-US")} tokens${toolsStr}`));
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
