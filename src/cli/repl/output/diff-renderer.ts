/**
 * Visual diff renderer for terminal
 *
 * Parses git unified diff format and renders with clean Codex-style formatting
 * showing removed lines with red background (-) and added lines with green background (+).
 */

import chalk from "chalk";
import { diffWords } from "diff";
import { highlightLine } from "./syntax.js";

// ============================================================================
// Background color helpers for Codex-style diff rendering
// ============================================================================

/** Subtle dark red background for deleted lines */
const bgDeleteLine = chalk.bgRgb(80, 20, 20);
/** Subtle dark green background for added lines */
const bgAddLine = chalk.bgRgb(20, 60, 20);
/** Brighter red background for specific removed words */
const bgDeleteWord = chalk.bgRgb(160, 40, 40);
/** Brighter green background for specific added words */
const bgAddWord = chalk.bgRgb(40, 120, 40);

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

function parseFileBlock(lines: string[], start: number): { file: DiffFile; nextIndex: number } {
  const diffLine = lines[start]!;
  let i = start + 1;

  // Extract paths from "diff --git a/path b/path"
  // Use lastIndexOf to correctly handle paths containing " b/"
  const gitPrefix = "diff --git a/";
  const pathPart = diffLine.slice(gitPrefix.length);
  const lastBSlash = pathPart.lastIndexOf(" b/");
  const oldPath = lastBSlash >= 0 ? pathPart.slice(0, lastBSlash) : pathPart;
  const newPath = lastBSlash >= 0 ? pathPart.slice(lastBSlash + 3) : oldPath;

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

function parseHunk(lines: string[], start: number): { hunk: DiffHunk; nextIndex: number } {
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
// Word-level diff highlighting
// ============================================================================

interface LinePair {
  deleteIdx: number;
  addIdx: number;
}

/**
 * Identify adjacent delete→add pairs within a hunk's lines.
 * Consecutive deletes followed by consecutive adds are matched 1:1.
 */
export function pairAdjacentLines(lines: DiffLine[]): LinePair[] {
  const pairs: LinePair[] = [];
  let i = 0;

  while (i < lines.length) {
    // Collect consecutive deletes
    const deleteStart = i;
    while (i < lines.length && lines[i]!.type === "delete") i++;
    const deleteEnd = i;

    // Collect consecutive adds immediately after
    const addStart = i;
    while (i < lines.length && lines[i]!.type === "add") i++;
    const addEnd = i;

    const deleteCount = deleteEnd - deleteStart;
    const addCount = addEnd - addStart;

    if (deleteCount > 0 && addCount > 0) {
      // Pair them 1:1, up to the smaller count
      const pairCount = Math.min(deleteCount, addCount);
      for (let j = 0; j < pairCount; j++) {
        pairs.push({ deleteIdx: deleteStart + j, addIdx: addStart + j });
      }
    }

    // Skip any non-delete/add lines (context)
    if (i === deleteEnd && i === addEnd) {
      // No deletes or adds found, advance past context
      i++;
    }
  }

  return pairs;
}

/**
 * Highlight word-level changes between a deleted and an added line.
 * Returns { styledDelete, styledAdd } with background-color segments.
 */
export function highlightWordChanges(
  deletedContent: string,
  addedContent: string,
): { styledDelete: string; styledAdd: string } {
  const changes = diffWords(deletedContent, addedContent);

  let styledDelete = "";
  let styledAdd = "";

  for (const change of changes) {
    if (change.added) {
      styledAdd += bgAddWord(change.value);
    } else if (change.removed) {
      styledDelete += bgDeleteWord(change.value);
    } else {
      // Unchanged text — use the subtle line background
      styledDelete += bgDeleteLine(change.value);
      styledAdd += bgAddLine(change.value);
    }
  }

  return { styledDelete, styledAdd };
}

// ============================================================================
// Renderer
// ============================================================================

const getTerminalWidth = () => process.stdout.columns || 80;

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

function renderFileBlock(file: DiffFile, opts: Required<DiffRenderOptions>): void {
  const { showLineNumbers, compact } = opts;
  const lang = detectLanguage(file.path);

  // File header - clean Codex-style without box borders
  const typeLabel =
    file.type === "modified"
      ? "modified"
      : file.type === "added"
        ? "new file"
        : file.type === "deleted"
          ? "deleted"
          : `renamed from ${file.oldPath}`;
  const statsLabel = ` +${file.additions} -${file.deletions}`;
  const title = `${file.path} (${typeLabel}${statsLabel})`;

  console.log(chalk.cyan.bold(title));

  // Hunks
  for (let h = 0; h < file.hunks.length; h++) {
    const hunk = file.hunks[h]!;

    // Hunk header - clean style without box borders
    if (!compact || h > 0) {
      const hunkLabel = hunk.heading ? ` ${chalk.dim(hunk.heading)}` : "";
      console.log(
        chalk.cyan(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`) +
          hunkLabel,
      );
    }

    // Build word-level pair map for this hunk
    const pairs = pairAdjacentLines(hunk.lines);
    const pairedDeleteIndices = new Set(pairs.map((p) => p.deleteIdx));
    const pairedAddIndices = new Set(pairs.map((p) => p.addIdx));
    const pairByAdd = new Map(pairs.map((p) => [p.addIdx, p.deleteIdx]));

    // Pre-compute word-level highlights for paired lines.
    // The maps pairByAdd and wordHighlights are built from the same `pairs` array,
    // so lookups with `!` are safe — every pairedAddIdx has a corresponding deleteIdx entry.
    const wordHighlights = new Map<number, { styledDelete: string; styledAdd: string }>();
    for (const pair of pairs) {
      const delLine = hunk.lines[pair.deleteIdx]!;
      const addLine = hunk.lines[pair.addIdx]!;
      wordHighlights.set(pair.deleteIdx, highlightWordChanges(delLine.content, addLine.content));
    }

    // Lines - clean style without box borders
    for (let li = 0; li < hunk.lines.length; li++) {
      const line = hunk.lines[li]!;
      const lineNo = formatLineNo(line, showLineNumbers);
      const prefix = line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";

      if (line.type === "add") {
        const isPaired = pairedAddIndices.has(li);
        let content: string;
        if (isPaired) {
          const delIdx = pairByAdd.get(li)!;
          content = wordHighlights.get(delIdx)!.styledAdd;
        } else {
          content = line.content;
        }
        // Apply syntax highlighting to the content
        if (lang) {
          content = highlightLine(content, lang);
        }
        // Green for added lines with line number and prefix
        const lineStr = `${lineNo}${prefix} ${content}`;
        console.log(bgAddLine(lineStr));
      } else if (line.type === "delete") {
        const isPaired = pairedDeleteIndices.has(li);
        let content: string;
        if (isPaired) {
          content = wordHighlights.get(li)!.styledDelete;
        } else {
          content = line.content;
        }
        // Apply syntax highlighting to the content
        if (lang) {
          content = highlightLine(content, lang);
        }
        // Red for deleted lines with line number and prefix
        const lineStr = `${lineNo}${prefix} ${content}`;
        console.log(bgDeleteLine(lineStr));
      } else {
        let content = line.content;
        if (lang) {
          content = highlightLine(content, lang);
        }
        const lineStr = `${lineNo}${prefix} ${content}`;
        console.log(chalk.dim(lineStr));
      }
    }
  }
}

function formatLineNo(line: DiffLine, show: boolean): string {
  if (!show) return "";
  // Show both line numbers aligned: old | new
  // For deletes: show old line number, blank for new
  // For adds: show blank for old, new line number
  // For context: show both
  const oldStr = line.oldLineNo !== undefined ? String(line.oldLineNo) : "";
  const newStr = line.newLineNo !== undefined ? String(line.newLineNo) : "";
  return chalk.dim(`${oldStr.padStart(4)} | ${newStr.padStart(4)} `);
}

/**
 * Render an inline diff suggestion (for review findings).
 * Shows old → new in a compact format.
 */
export function renderInlineDiff(oldLines: string[], newLines: string[]): string {
  const maxWidth = Math.min(getTerminalWidth() - 4, 120);
  const result: string[] = [];
  for (const line of oldLines) {
    const text = `- ${line}`;
    const pad = Math.max(0, maxWidth - text.length);
    result.push("  " + bgDeleteLine(text + " ".repeat(pad)));
  }
  for (const line of newLines) {
    const text = `+ ${line}`;
    const pad = Math.max(0, maxWidth - text.length);
    result.push("  " + bgAddLine(text + " ".repeat(pad)));
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
