/**
 * Commit Message Generator
 *
 * Generates conventional commit messages from diffs and sanitizes
 * to remove any AI co-authored-by or attribution lines.
 */

// ============================================================================
// Sanitization
// ============================================================================

/**
 * Patterns that must be stripped from commit messages.
 * Matches co-authored-by lines, AI attribution, and generated-by lines.
 */
const STRIP_PATTERNS = [
  /^\s*co-authored-by\s*:.*$/gim,
  /^\s*generated\s+(by|with)\s+(ai|claude|gpt|copilot|coco|kimi|chatgpt|gemini|openai|anthropic).*$/gim,
  /^\s*\[?(ai|claude|gpt|copilot|coco)\]?\s*(assisted|generated|authored).*$/gim,
  /^\s*🤖.*$/gm, // Robot emoji lines
];

/**
 * Remove AI co-authored-by and attribution lines from a commit message.
 */
export function sanitizeCommitMessage(message: string): string {
  let cleaned = message;
  for (const pattern of STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Remove multiple consecutive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

// ============================================================================
// Generation (from structured data, no LLM needed for simple cases)
// ============================================================================

export interface CommitSummary {
  /** Conventional commit type */
  type: string;
  /** Optional scope */
  scope?: string;
  /** Short description */
  description: string;
  /** Bullet points for body (optional) */
  bullets?: string[];
  /** Breaking change flag */
  breaking?: boolean;
}

/**
 * Format a structured commit summary into a conventional commit message.
 */
export function formatCommitMessage(summary: CommitSummary): string {
  const scope = summary.scope ? `(${summary.scope})` : "";
  const breaking = summary.breaking ? "!" : "";
  const header = `${summary.type}${scope}${breaking}: ${summary.description}`;

  const lines = [header];

  if (summary.bullets && summary.bullets.length > 0) {
    lines.push("");
    for (const bullet of summary.bullets) {
      lines.push(`- ${bullet}`);
    }
  }

  if (summary.breaking) {
    lines.push("");
    lines.push("BREAKING CHANGE: see description");
  }

  return sanitizeCommitMessage(lines.join("\n"));
}

// ============================================================================
// Type detection from file changes
// ============================================================================

/**
 * Infer a conventional commit type from the set of changed files.
 */
export function inferCommitType(changedFiles: string[]): { type: string; scope?: string } {
  const hasTests = changedFiles.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f));
  const hasSrc = changedFiles.some(
    (f) => f.startsWith("src/") && !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f),
  );
  const hasDocs = changedFiles.some((f) => /^(docs?\/|README|CHANGELOG|\.md$)/i.test(f));
  const hasConfig = changedFiles.some((f) =>
    /^(\..*rc|.*config\.|tsconfig|package\.json|Cargo\.toml|pyproject)/i.test(f),
  );
  const hasCi = changedFiles.some((f) => /^\.github\/|^\.gitlab-ci|^\.circleci/i.test(f));

  if (hasCi && !hasSrc) return { type: "ci" };
  if (hasDocs && !hasSrc) return { type: "docs" };
  if (hasTests && !hasSrc) return { type: "test" };
  if (hasConfig && !hasSrc) return { type: "chore" };
  if (hasTests && hasSrc) return { type: "feat" }; // New features often include tests

  return { type: "feat" };
}
