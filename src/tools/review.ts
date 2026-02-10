/**
 * Code review tool for Corbat-Coco
 *
 * Analyzes git diffs between current branch and a base branch,
 * runs pattern detection and optional linting, and produces
 * structured review findings ordered by severity.
 */

import path from "node:path";
import { z } from "zod";
import { simpleGit, type SimpleGit } from "simple-git";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import { fileExists } from "../utils/files.js";
import { parseDiff, getChangedLines, type ParsedDiff } from "../cli/repl/output/diff-renderer.js";
import { detectMaturity, type MaturityLevel } from "../utils/maturity.js";
import { runLinterTool, type LintIssue } from "./quality.js";

// ============================================================================
// Types
// ============================================================================

export type ReviewSeverity = "critical" | "major" | "minor" | "info";

export type ReviewCategory =
  | "security"
  | "correctness"
  | "performance"
  | "maintainability"
  | "style"
  | "testing"
  | "documentation"
  | "best-practice";

export interface ReviewFinding {
  file: string;
  line?: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  suggestion?: { old: string[]; new: string[] };
}

export interface ReviewSummary {
  branch: string;
  baseBranch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  status: "approved" | "needs_work";
}

export interface ReviewResult {
  summary: ReviewSummary;
  required: ReviewFinding[];
  suggestions: ReviewFinding[];
  maturity: MaturityLevel;
  diff: ParsedDiff;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

interface Pattern {
  regex: RegExp;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  suggestion?: { old: string; new: string };
  /** Skip this pattern for files matching these paths (e.g. CLI output files) */
  excludePaths?: RegExp;
}

const SECURITY_PATTERNS: Pattern[] = [
  {
    regex: /\beval\s*\(/,
    severity: "critical",
    category: "security",
    message: "Avoid eval() — risk of code injection",
  },
  {
    regex: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i,
    severity: "critical",
    category: "security",
    message: "Hardcoded secret detected — use environment variables",
  },
  {
    regex: /\bdebugger\b/,
    severity: "major",
    category: "security",
    message: "Remove debugger statement before merging",
  },
  {
    regex: /console\.(log|debug|info)\(/,
    severity: "minor",
    category: "best-practice",
    message: "Remove console.log — use structured logging instead",
    excludePaths: /\/(cli|repl|bin|scripts)\//,
  },
];

const CORRECTNESS_PATTERNS: Pattern[] = [
  {
    regex: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/,
    severity: "major",
    category: "correctness",
    message: "Empty catch block swallows errors — handle or log the error",
  },
  {
    regex: /catch\s*\{\s*\}/,
    severity: "major",
    category: "correctness",
    message: "Empty catch block swallows errors — handle or log the error",
  },
  {
    regex: /:\s*any\b/,
    severity: "minor",
    category: "maintainability",
    message: "Avoid 'any' type — use a specific type instead",
  },
  {
    regex: /\/\/\s*@ts-ignore/,
    severity: "minor",
    category: "correctness",
    message: "Prefer @ts-expect-error over @ts-ignore for better type safety",
  },
  {
    regex: /new\s+Promise\s*\(\s*\(\s*resolve\s*,\s*reject\s*\)\s*=>\s*\{/,
    severity: "info",
    category: "best-practice",
    message: "Consider if Promise constructor is needed — prefer async/await",
  },
];

const STYLE_PATTERNS: Pattern[] = [
  {
    regex: /TODO|FIXME|HACK|XXX/,
    severity: "info",
    category: "best-practice",
    message: "TODO/FIXME comment found — track in issue tracker before merging",
  },
];

const ALL_PATTERNS = [...SECURITY_PATTERNS, ...CORRECTNESS_PATTERNS, ...STYLE_PATTERNS];

// ============================================================================
// Analysis Functions
// ============================================================================

function getGit(cwd?: string): SimpleGit {
  return simpleGit(cwd ?? process.cwd());
}

/**
 * Get diff between current branch and base branch.
 * Includes both committed and uncommitted changes.
 */
async function getDiff(
  git: SimpleGit,
  baseBranch: string,
  includeUncommitted: boolean,
): Promise<string> {
  const diffs: string[] = [];

  // Get committed changes vs base branch
  try {
    const branchDiff = await git.diff([`${baseBranch}...HEAD`]);
    if (branchDiff) diffs.push(branchDiff);
  } catch {
    // If the base branch doesn't exist or no common ancestor, try direct diff
    try {
      const directDiff = await git.diff([baseBranch]);
      if (directDiff) diffs.push(directDiff);
    } catch {
      // No base branch available, fall through to uncommitted
    }
  }

  // Get uncommitted changes (staged + unstaged)
  if (includeUncommitted) {
    try {
      const uncommitted = await git.diff();
      if (uncommitted) diffs.push(uncommitted);
    } catch {
      // ignore
    }
    try {
      const staged = await git.diff(["--staged"]);
      if (staged) diffs.push(staged);
    } catch {
      // ignore
    }
  }

  return diffs.join("\n");
}

/**
 * Run pattern detection on added diff lines.
 * Checks each added line against security, correctness, and style patterns.
 * Patterns with `excludePaths` are skipped for matching file paths (e.g. CLI files).
 */
export function analyzePatterns(diff: ParsedDiff): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        // Only check added lines
        if (line.type !== "add") continue;

        for (const pattern of ALL_PATTERNS) {
          if (pattern.excludePaths?.test(file.path)) continue;
          if (pattern.regex.test(line.content)) {
            findings.push({
              file: file.path,
              line: line.newLineNo,
              severity: pattern.severity,
              category: pattern.category,
              message: pattern.message,
              suggestion: pattern.suggestion
                ? { old: [pattern.suggestion.old], new: [pattern.suggestion.new] }
                : undefined,
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Minimum additions threshold before flagging test coverage when tests exist on disk.
 * Changes below this are likely refactors or fixes already covered by existing tests.
 */
const TEST_COVERAGE_LARGE_CHANGE_THRESHOLD = 15;

/**
 * Check if source files changed without corresponding test changes.
 * When a test file exists on disk but wasn't modified in the diff,
 * small changes (< 15 additions) are silently skipped — existing tests
 * almost certainly cover them. Large changes still get an "info" nudge.
 * Files with no test file on disk always get flagged as "minor".
 */
export async function checkTestCoverage(diff: ParsedDiff, cwd: string): Promise<ReviewFinding[]> {
  const findings: ReviewFinding[] = [];
  const changedSrc: { path: string; additions: number }[] = [];
  const changedTests = new Set<string>();

  for (const file of diff.files) {
    const isTest = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file.path);
    if (isTest) {
      changedTests.add(file.path);
    } else if (/\.(ts|tsx|js|jsx)$/.test(file.path)) {
      // Only flag source files with substantial changes
      if (file.additions > 5) {
        changedSrc.push({ path: file.path, additions: file.additions });
      }
    }
  }

  for (const src of changedSrc) {
    // Check if a corresponding test file was also changed
    const baseName = src.path.replace(/\.(ts|tsx|js|jsx)$/, "");
    const hasTestChange = [...changedTests].some(
      (t) => t.includes(baseName.split("/").pop()!) || t.startsWith(baseName),
    );

    if (!hasTestChange) {
      // Check if a test file exists on disk (just not in the diff)
      const ext = src.path.match(/\.(ts|tsx|js|jsx)$/)?.[0] ?? ".ts";
      const testExists =
        (await fileExists(path.join(cwd, `${baseName}.test${ext}`))) ||
        (await fileExists(path.join(cwd, `${baseName}.spec${ext}`)));

      if (testExists) {
        // Test file exists — only flag large changes, skip small refactors
        if (src.additions >= TEST_COVERAGE_LARGE_CHANGE_THRESHOLD) {
          findings.push({
            file: src.path,
            severity: "info",
            category: "testing",
            message:
              "Test file exists but was not updated — verify existing tests cover these changes",
          });
        }
        // Small changes with existing tests → silent, no finding
      } else {
        findings.push({
          file: src.path,
          severity: "minor",
          category: "testing",
          message: "Logic changes without corresponding test updates",
        });
      }
    }
  }

  return findings;
}

/**
 * Check for new exports without JSDoc documentation.
 */
function checkDocumentation(diff: ParsedDiff): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of diff.files) {
    if (!/\.(ts|tsx)$/.test(file.path)) continue;

    for (const hunk of file.hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i]!;
        if (line.type !== "add") continue;

        // Check for exported functions/interfaces/types without JSDoc
        const isExport = /^export\s+(function|interface|type|class|const|enum)\b/.test(
          line.content.trim(),
        );
        if (!isExport) continue;

        // Check if previous line is a JSDoc comment closing
        const prevLine = hunk.lines[i - 1];
        const hasDoc =
          prevLine && prevLine.type === "add" && /\*\/\s*$/.test(prevLine.content.trim());

        if (!hasDoc) {
          findings.push({
            file: file.path,
            line: line.newLineNo,
            severity: "info",
            category: "documentation",
            message: "New exported declaration missing JSDoc documentation",
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Filter linter issues to only those on changed lines.
 */
function filterLintIssues(
  issues: LintIssue[],
  changedLines: Map<string, Set<number>>,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const issue of issues) {
    // Normalize file path for comparison
    const normalizedFile = issue.file.replace(/^.*?\/src\//, "src/");
    const fileChanges = changedLines.get(normalizedFile);

    if (fileChanges && fileChanges.has(issue.line)) {
      findings.push({
        file: normalizedFile,
        line: issue.line,
        severity: issue.severity === "error" ? "major" : "minor",
        category: "style",
        message: `[${issue.rule}] ${issue.message}`,
      });
    }
  }

  return findings;
}

/**
 * Adjust findings based on project maturity level.
 */
function adjustForMaturity(findings: ReviewFinding[], maturity: MaturityLevel): ReviewFinding[] {
  if (maturity === "established") {
    // In established projects, promote some minor issues to major
    return findings.map((f) => {
      if (f.severity === "minor" && (f.category === "testing" || f.category === "style")) {
        return { ...f, severity: "major" as ReviewSeverity };
      }
      return f;
    });
  }

  if (maturity === "empty" || maturity === "new") {
    // In new projects, demote style issues to info
    return findings.map((f) => {
      if (f.severity === "minor" && f.category === "style") {
        return { ...f, severity: "info" as ReviewSeverity };
      }
      return f;
    });
  }

  return findings;
}

/**
 * Add maturity-specific recommendations.
 */
function getMaturityRecommendations(maturity: MaturityLevel, diff: ParsedDiff): ReviewFinding[] {
  if (maturity !== "empty" && maturity !== "new") return [];

  const findings: ReviewFinding[] = [];
  const hasTests = diff.files.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f.path));

  if (!hasTests && maturity === "new") {
    findings.push({
      file: "",
      severity: "info",
      category: "testing",
      message: "Consider adding tests — no test files detected in this changeset",
    });
  }

  return findings;
}

// ============================================================================
// Sort findings
// ============================================================================

const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  info: 3,
};

function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.file.localeCompare(b.file);
  });
}

/**
 * Deduplicate findings by file+line+message.
 */
function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line ?? 0}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// Tool Definition
// ============================================================================

export const reviewCodeTool: ToolDefinition<
  {
    baseBranch?: string;
    includeUncommitted?: boolean;
    runLinter?: boolean;
    cwd?: string;
  },
  ReviewResult
> = defineTool({
  name: "review_code",
  description: `Review code changes between current branch and a base branch.
Performs pattern detection, optional linting, and maturity-aware analysis.
Returns findings ordered by severity.

Examples:
- Review vs main: {} → review all changes
- Review vs develop: { "baseBranch": "develop" }
- Skip linting: { "runLinter": false }`,
  category: "quality",
  parameters: z.object({
    baseBranch: z.string().optional().default("main").describe("Base branch to compare against"),
    includeUncommitted: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include uncommitted changes"),
    runLinter: z.boolean().optional().default(true).describe("Run linter on changed files"),
    cwd: z.string().optional().describe("Repository directory"),
  }),
  async execute({ baseBranch, includeUncommitted, runLinter, cwd }) {
    const projectDir = cwd ?? process.cwd();
    const git = getGit(projectDir);

    try {
      // Get branch info
      const status = await git.status();
      const currentBranch = status.current ?? "HEAD";

      // Get diff
      const rawDiff = await getDiff(git, baseBranch!, includeUncommitted!);
      const diff = parseDiff(rawDiff);

      if (diff.files.length === 0) {
        return {
          summary: {
            branch: currentBranch,
            baseBranch: baseBranch!,
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            status: "approved",
          },
          required: [],
          suggestions: [],
          maturity: "new",
          diff,
        };
      }

      // Detect maturity
      const maturityInfo = await detectMaturity(projectDir);
      const maturity = maturityInfo.level;

      // Run all analyses
      let allFindings: ReviewFinding[] = [];

      // 1. Pattern analysis
      allFindings.push(...analyzePatterns(diff));

      // 2. Test coverage check
      allFindings.push(...(await checkTestCoverage(diff, projectDir)));

      // 3. Documentation check
      allFindings.push(...checkDocumentation(diff));

      // 4. Linter (optional)
      if (runLinter) {
        try {
          const changedFiles = diff.files.filter((f) => f.type !== "deleted").map((f) => f.path);

          if (changedFiles.length > 0) {
            const lintResult = await runLinterTool.execute({
              cwd: projectDir,
              files: changedFiles,
            });

            if (lintResult.issues.length > 0) {
              const changedLines = getChangedLines(diff);
              allFindings.push(...filterLintIssues(lintResult.issues, changedLines));
            }
          }
        } catch {
          // Linter not available, skip
        }
      }

      // 5. Maturity recommendations
      allFindings.push(...getMaturityRecommendations(maturity, diff));

      // Adjust for maturity
      allFindings = adjustForMaturity(allFindings, maturity);

      // Deduplicate and sort
      allFindings = deduplicateFindings(sortFindings(allFindings));

      // Split into required vs suggestions
      const required = allFindings.filter(
        (f) => f.severity === "critical" || f.severity === "major",
      );
      const suggestions = allFindings.filter(
        (f) => f.severity === "minor" || f.severity === "info",
      );

      const status_result: ReviewSummary["status"] = required.some((f) => f.severity === "critical")
        ? "needs_work"
        : required.length > 0
          ? "needs_work"
          : "approved";

      return {
        summary: {
          branch: currentBranch,
          baseBranch: baseBranch!,
          filesChanged: diff.stats.filesChanged,
          additions: diff.stats.additions,
          deletions: diff.stats.deletions,
          status: status_result,
        },
        required,
        suggestions,
        maturity,
        diff,
      };
    } catch (error) {
      throw new ToolError(
        `Code review failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "review_code", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

export const reviewTools = [reviewCodeTool];
