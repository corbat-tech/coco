/**
 * Visual diff renderer for terminal
 *
 * Parses git unified diff format and renders with box-style formatting
 * matching the existing code block rendering in renderer.ts.
 */

import chalk from "chalk";
import { highlightLine } from "./syntax.js";

// ============================================================================
// Types
// ============================================================================

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  type: "modified" | "added" | "deleted" | "renamed";
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "delete" | "context";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  stats: DiffStats;
}

export interface DiffRenderOptions {
  showLineNumbers?: boolean;
  maxWidth?: number;
  compact?: boolean;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse unified diff text into structured format.
 */
export function parseDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Look for diff header
    if (line.startsWith("diff --git ")) {
      const file = parseFileBlock(lines, i);
      files.push(file.file);
      i = file.nextIndex;
    } else {
      i++;
    }
  }

  const stats: DiffStats = {
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    filesChanged: files.length,
  };

  return { files, stats };
}

function parseFileBlock(
  lines: string[],
  start: number,
): { file: DiffFile; nextIndex: number } {
  const diffLine = lines[start]!;
  let i = start + 1;

  // Extract paths from "diff --git a/path b/path"
  const pathMatch = diffLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
  const oldPath = pathMatch?.[1] ?? "";
  const newPath = pathMatch?.[2] ?? oldPath;

  let fileType: DiffFile["type"] = "modified";

  // Skip metadata lines (index, old mode, new mode, similarity, etc.)
  while (i < lines.length && !lines[i]!.startsWith("diff --git ")) {
    const current = lines[i]!;

    if (current.startsWith("new file mode")) {
      fileType = "added";
    } else if (current.startsWith("deleted file mode")) {
      fileType = "deleted";
    } else if (current.startsWith("rename from") || current.startsWith("similarity index")) {
      fileType = "renamed";
    } else if (current.startsWith("@@")) {
      break;
    } else if (current.startsWith("Binary files")) {
      // Binary file, skip
      i++;
      break;
    }
    i++;
  }

  // Parse hunks
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  while (i < lines.length && !lines[i]!.startsWith("diff --git ")) {
    const current = lines[i]!;

    if (current.startsWith("@@")) {
      const hunk = parseHunk(lines, i);
      hunks.push(hunk.hunk);
      additions += hunk.hunk.lines.filter((l) => l.type === "add").length;
      deletions += hunk.hunk.lines.filter((l) => l.type === "delete").length;
      i = hunk.nextIndex;
    } else {
      i++;
    }
  }

  const file: DiffFile = {
    path: newPath,
    oldPath: fileType === "renamed" ? oldPath : undefined,
    type: fileType,
    hunks,
    additions,
    deletions,
  };

  return { file, nextIndex: i };
}

function parseHunk(
  lines: string[],
  start: number,
): { hunk: DiffHunk; nextIndex: number } {
  const header = lines[start]!;
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);

  const oldStart = parseInt(match?.[1] ?? "1", 10);
  const oldLines = parseInt(match?.[2] ?? "1", 10);
  const newStart = parseInt(match?.[3] ?? "1", 10);
  const newLines = parseInt(match?.[4] ?? "1", 10);
  const heading = match?.[5]?.trim() ?? "";

  const hunkLines: DiffLine[] = [];
  let i = start + 1;
  let oldLineNo = oldStart;
  let newLineNo = newStart;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("diff --git ") || line.startsWith("@@")) {
      break;
    }

    if (line.startsWith("+")) {
      hunkLines.push({
        type: "add",
        content: line.slice(1),
        newLineNo,
      });
      newLineNo++;
    } else if (line.startsWith("-")) {
      hunkLines.push({
        type: "delete",
        content: line.slice(1),
        oldLineNo,
      });
      oldLineNo++;
    } else if (line.startsWith(" ") || line === "") {
      hunkLines.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldLineNo,
        newLineNo,
      });
      oldLineNo++;
      newLineNo++;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — skip
      i++;
      continue;
    } else {
      break;
    }

    i++;
  }

  return {
    hunk: { oldStart, oldLines, newStart, newLines, heading, lines: hunkLines },
    nextIndex: i,
  };
}

// ============================================================================
// Renderer
// ============================================================================

const getTerminalWidth = () => process.stdout.columns || 80;

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Detect language from file extension for syntax highlighting.
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    css: "css",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    xml: "xml",
    html: "xml",
  };
  return extMap[ext] ?? "";
}

/**
 * Render a parsed diff to the terminal with box-style formatting.
 */
export function renderDiff(diff: ParsedDiff, options?: DiffRenderOptions): void {
  const showLineNumbers = options?.showLineNumbers ?? true;
  const maxWidth = options?.maxWidth ?? Math.min(getTerminalWidth() - 2, 120);
  const compact = options?.compact ?? false;

  if (diff.files.length === 0) {
    console.log(chalk.dim("\n  No changes\n"));
    return;
  }

  for (const file of diff.files) {
    renderFileBlock(file, { showLineNumbers, maxWidth, compact });
  }

  // Stats line
  const { stats } = diff;
  const parts: string[] = [];
  parts.push(`${stats.filesChanged} file${stats.filesChanged !== 1 ? "s" : ""}`);
  if (stats.additions > 0) parts.push(chalk.green(`+${stats.additions}`));
  if (stats.deletions > 0) parts.push(chalk.red(`-${stats.deletions}`));
  console.log(chalk.dim(`\n  ${parts.join(", ")}\n`));
}

function renderFileBlock(
  file: DiffFile,
  opts: Required<DiffRenderOptions>,
): void {
  const { maxWidth, showLineNumbers, compact } = opts;
  const lang = detectLanguage(file.path);
  const contentWidth = maxWidth - 4;

  // File header
  const typeLabel = file.type === "modified" ? "modified" :
    file.type === "added" ? "new file" :
    file.type === "deleted" ? "deleted" :
    `renamed from ${file.oldPath}`;
  const statsLabel = ` +${file.additions} -${file.deletions}`;
  const title = ` ${file.path} (${typeLabel}${statsLabel}) `;

  // Top border
  const topFill = Math.max(0, maxWidth - 2 - stripAnsi(title).length);
  console.log(
    chalk.magenta("╭──") + chalk.cyan.bold(title) + chalk.magenta("─".repeat(topFill) + "╮"),
  );

  // Hunks
  for (let h = 0; h < file.hunks.length; h++) {
    const hunk = file.hunks[h]!;

    // Hunk header
    if (!compact || h > 0) {
      const hunkLabel = hunk.heading ? ` ${chalk.dim(hunk.heading)}` : "";
      console.log(
        chalk.magenta("│") +
          " " +
          chalk.cyan(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`) +
          hunkLabel,
      );
    }

    // Lines
    for (const line of hunk.lines) {
      const lineNo = formatLineNo(line, showLineNumbers);
      const prefix = line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";

      let content = line.content;
      // Syntax highlight context and added lines (deleted lines keep dim)
      if (line.type !== "delete" && lang) {
        content = highlightLine(content, lang);
      }

      const lineStr = `${lineNo}${prefix} ${content}`;
      const plainLen = stripAnsi(lineStr).length;
      const pad = Math.max(0, contentWidth - plainLen);

      if (line.type === "add") {
        console.log(
          chalk.magenta("│") + chalk.green(` ${lineStr}`) + " ".repeat(pad) + " " + chalk.magenta("│"),
        );
      } else if (line.type === "delete") {
        console.log(
          chalk.magenta("│") + chalk.red(` ${lineStr}`) + " ".repeat(pad) + " " + chalk.magenta("│"),
        );
      } else {
        console.log(
          chalk.magenta("│") + chalk.dim(` ${lineStr}`) + " ".repeat(pad) + " " + chalk.magenta("│"),
        );
      }
    }
  }

  // Bottom border
  console.log(chalk.magenta("╰" + "─".repeat(maxWidth - 2) + "╯"));
}

function formatLineNo(line: DiffLine, show: boolean): string {
  if (!show) return "";

  if (line.type === "add") {
    return chalk.dim(`${String(line.newLineNo ?? "").padStart(4)} `);
  } else if (line.type === "delete") {
    return chalk.dim(`${String(line.oldLineNo ?? "").padStart(4)} `);
  }
  return chalk.dim(`${String(line.newLineNo ?? "").padStart(4)} `);
}

/**
 * Render an inline diff suggestion (for review findings).
 * Shows old → new in a compact format.
 */
export function renderInlineDiff(oldLines: string[], newLines: string[]): string {
  const result: string[] = [];
  for (const line of oldLines) {
    result.push(chalk.red(`  - ${line}`));
  }
  for (const line of newLines) {
    result.push(chalk.green(`  + ${line}`));
  }
  return result.join("\n");
}

/**
 * Build a set of changed line numbers per file from a parsed diff.
 * Useful for filtering linter output to only changed lines.
 */
export function getChangedLines(diff: ParsedDiff): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();

  for (const file of diff.files) {
    const lines = new Set<number>();
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add" && line.newLineNo !== undefined) {
          lines.add(line.newLineNo);
        }
      }
    }
    if (lines.size > 0) {
      result.set(file.path, lines);
    }
  }

  return result;
}
