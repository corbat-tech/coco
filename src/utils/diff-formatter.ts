/**
 * Diff formatter utility - Formats diffs in a clean, readable way
 * Inspired by Codex CLI approach: concise, relevant, no noise
 */

import { execSync } from "node:child_process";
import chalk from "chalk";

/**
 * Options for formatting diffs
 */
export interface DiffFormatOptions {
  /** Maximum number of lines to show per file (0 = unlimited) */
  maxLinesPerFile?: number;
  /** Maximum number of files to show (0 = unlimited) */
  maxFiles?: number;
  /** Show only filenames without content */
  summaryOnly?: boolean;
  /** Context lines around changes */
  contextLines?: number;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: DiffFormatOptions = {
  maxLinesPerFile: 50,
  maxFiles: 10,
  summaryOnly: false,
  contextLines: 3,
};

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(cwd?: string): boolean {
  try {
    execSync("git diff --quiet", { cwd, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

/**
 * Get list of modified files with stats
 */
export function getModifiedFiles(cwd?: string): Array<{
  path: string;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "deleted" | "renamed";
}> {
  try {
    const output = execSync("git diff --numstat", { cwd: cwd ?? process.cwd(), encoding: "utf-8", stdio: "pipe" });
    const files: ReturnType<typeof getModifiedFiles> = [];

    for (const line of output.split("\n").filter(Boolean)) {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (match) {
        const [, added, deleted, filePath] = match;
        if (filePath) {
          files.push({
            path: filePath,
            additions: parseInt(added ?? "0", 10),
            deletions: parseInt(deleted ?? "0", 10),
            status: parseInt(added ?? "0", 10) === 0 ? "deleted" : parseInt(deleted ?? "0", 10) === 0 && parseInt(added ?? "0", 10) > 0 ? "added" : "modified",
          });
        }
      }
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Get staged files with stats
 */
export function getStagedFiles(cwd?: string): ReturnType<typeof getModifiedFiles> {
  try {
    const output = execSync("git diff --cached --numstat", { cwd: cwd ?? process.cwd(), encoding: "utf-8", stdio: "pipe" });
    const files: ReturnType<typeof getModifiedFiles> = [];

    for (const line of output.split("\n").filter(Boolean)) {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (match) {
        const [, added, deleted, filePath] = match;
        if (filePath) {
          files.push({
            path: filePath,
            additions: parseInt(added ?? "0", 10),
            deletions: parseInt(deleted ?? "0", 10),
            status: parseInt(added ?? "0", 10) === 0 ? "deleted" : parseInt(deleted ?? "0", 10) === 0 && parseInt(added ?? "0", 10) > 0 ? "added" : "modified",
          });
        }
      }
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Format a summary of changes
 */
export function formatChangeSummary(
  files: ReturnType<typeof getModifiedFiles>,
  options: DiffFormatOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (files.length === 0) {
    return chalk.gray("No changes detected.");
  }

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  let output = "\n";
  output += chalk.bold(`📁 Changed files (${files.length}):\n`);
  output += chalk.gray(`   +${totalAdditions} / -${totalDeletions} lines\n\n`);

  const filesToShow = opts.maxFiles && opts.maxFiles > 0 ? files.slice(0, opts.maxFiles) : files;
  const remaining = files.length - filesToShow.length;

  for (const file of filesToShow) {
    const statusIcon = file.status === "added" ? chalk.green("A") : file.status === "deleted" ? chalk.red("D") : chalk.yellow("M");
    const stats = `${chalk.green("+" + file.additions)} ${chalk.red("-" + file.deletions)}`;
    output += `  ${statusIcon} ${chalk.white(file.path)} ${chalk.gray(stats)}\n`;
  }

  if (remaining > 0) {
    output += chalk.gray(`  ... and ${remaining} more files\n`);
  }

  return output;
}

/**
 * Get raw diff for a specific file
 */
export function getFileDiff(filePath: string, cwd?: string, staged = false): string {
  try {
    const cmd = staged ? `git diff --cached -- "${filePath}"` : `git diff -- "${filePath}"`;
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe" });
  } catch {
    return "";
  }
}

/**
 * Format a diff with syntax highlighting
 */
export function formatDiff(
  diff: string,
  options: DiffFormatOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!diff.trim()) {
    return chalk.gray("No diff to display.");
  }

  const lines = diff.split("\n");
  const maxLines = opts.maxLinesPerFile || 0;
  let output = "";
  let lineCount = 0;
  let truncated = false;

  for (const line of lines) {
    if (maxLines > 0 && lineCount >= maxLines) {
      truncated = true;
      break;
    }

    if (line.startsWith("+")) {
      output += chalk.green(line) + "\n";
    } else if (line.startsWith("-")) {
      output += chalk.red(line) + "\n";
    } else if (line.startsWith("@@")) {
      output += chalk.cyan(line) + "\n";
    } else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      output += chalk.gray(line) + "\n";
    } else {
      output += line + "\n";
    }

    lineCount++;
  }

  if (truncated) {
    output += chalk.gray(`\n... (${lines.length - lineCount} more lines) ...\n`);
  }

  return output;
}

/**
 * Format complete diff output for display
 */
export function formatFullDiff(
  cwd?: string,
  options: DiffFormatOptions = {},
  files?: ReturnType<typeof getModifiedFiles>,
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Get summary first (use provided files or fetch them)
    const filesToProcess = files ?? getModifiedFiles(cwd);
    let output = formatChangeSummary(filesToProcess, opts);

    if (opts.summaryOnly || filesToProcess.length === 0) {
      return output;
    }

    // Add detailed diff for each file
    output += "\n" + chalk.bold("📝 Detailed changes:\n\n");

    const filesToShow = opts.maxFiles && opts.maxFiles > 0 ? filesToProcess.slice(0, opts.maxFiles) : filesToProcess;

    for (const file of filesToShow) {
      const diff = getFileDiff(file.path, cwd);
      if (diff) {
        output += chalk.white.bold(`${file.path}\n`);
        output += formatDiff(diff, opts);
        output += "\n";
      }
    }

    const remaining = filesToProcess.length - filesToShow.length;
    if (remaining > 0) {
      output += chalk.gray(`\n... (${remaining} more files, use /diff --all to see all) ...\n`);
    }

    return output;
  } catch (error) {
    return chalk.red(`Error getting diff: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get a quick one-line summary of changes
 */
export function getQuickChangeSummary(cwd?: string): string {
  const files = getModifiedFiles(cwd);
  if (files.length === 0) return "";

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return chalk.gray(`(${files.length} files, +${totalAdditions}/-${totalDeletions})`);
}

/**
 * Check if a file is auto-generated (should skip diff)
 */
export function isAutoGenerated(filePath: string): boolean {
  const autoGenPatterns = [
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /bun\.lockb$/,
    /Cargo\.lock$/,
    /Gemfile\.lock$/,
    /composer\.lock$/,
    /\.min\.(js|css)$/,
    /dist\//,
    /build\//,
    /\.generated\./,
    /__snapshots__/,
  ];

  return autoGenPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Filter out auto-generated files from diff
 */
export function filterAutoGenerated(files: ReturnType<typeof getModifiedFiles>): ReturnType<typeof getModifiedFiles> {
  return files.filter((f) => !isAutoGenerated(f.path));
}
