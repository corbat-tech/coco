/**
 * Skill Matcher
 *
 * Determines which skills are relevant to a given user message
 * using keyword-based matching with stemming, fuzzy matching,
 * and optional glob-aware file context boosting.
 */

import type { SkillMetadata, SkillMatch } from "./types.js";

/** Default minimum score to consider a match */
const DEFAULT_MIN_SCORE = 0.3;

/** Default maximum results to return */
const DEFAULT_MAX_RESULTS = 3;

/** Weight for name matches */
const NAME_WEIGHT = 3.0;

/** Weight for description matches */
const DESC_WEIGHT = 1.5;

/** Weight for tag matches */
const TAG_WEIGHT = 2.0;

/** Bonus score when skill globs match active files */
const GLOB_BOOST = 0.3;

/** Common stop words to ignore */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "i", "me", "my",
  "you", "your", "we", "our", "they", "their", "it", "its", "this",
  "that", "these", "those", "and", "or", "but", "if", "then", "else",
  "when", "where", "how", "what", "which", "who", "whom", "to", "for",
  "with", "at", "by", "from", "in", "on", "of", "as", "not", "no",
]);

/** Match options */
export interface MatchOptions {
  maxResults?: number;
  minScore?: number;
  /** Active file paths — used for glob-aware score boosting */
  activeFiles?: string[];
}

/**
 * Match user input against available skills
 *
 * Returns skills sorted by relevance score, filtered by minimum threshold.
 */
export function matchSkills(
  query: string,
  skills: SkillMetadata[],
  options?: MatchOptions | { maxResults?: number; minScore?: number },
): SkillMatch[] {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const activeFiles = (options as MatchOptions)?.activeFiles;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const matches: SkillMatch[] = [];

  for (const skill of skills) {
    const { score, reason } = scoreSkill(queryTokens, skill, activeFiles);
    if (score >= minScore) {
      matches.push({ skill, score: Math.min(score, 1.0), reason });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, maxResults);
}

/**
 * Score a skill against query tokens
 */
function scoreSkill(
  queryTokens: string[],
  skill: SkillMetadata,
  activeFiles?: string[],
): { score: number; reason: string } {
  let totalScore = 0;
  const reasons: string[] = [];

  // Score against name
  const nameTokens = tokenize(skill.name);
  const nameScore = tokenOverlap(queryTokens, nameTokens);
  if (nameScore > 0) {
    totalScore += nameScore * NAME_WEIGHT;
    reasons.push(`name match (${(nameScore * 100).toFixed(0)}%)`);
  }

  // Score against description
  const descTokens = tokenize(skill.description);
  const descScore = tokenOverlap(queryTokens, descTokens);
  if (descScore > 0) {
    totalScore += descScore * DESC_WEIGHT;
    reasons.push(`description match (${(descScore * 100).toFixed(0)}%)`);
  }

  // Score against tags
  if (skill.tags && skill.tags.length > 0) {
    const tagTokens = skill.tags.flatMap((t) => tokenize(t));
    const tagScore = tokenOverlap(queryTokens, tagTokens);
    if (tagScore > 0) {
      totalScore += tagScore * TAG_WEIGHT;
      reasons.push(`tag match (${(tagScore * 100).toFixed(0)}%)`);
    }
  }

  // Normalize: max possible is NAME_WEIGHT + DESC_WEIGHT + TAG_WEIGHT
  const maxPossible = NAME_WEIGHT + DESC_WEIGHT + TAG_WEIGHT;
  let normalized = totalScore / maxPossible;

  // Glob-aware boosting: if skill has globs and any active file matches, boost score
  if (activeFiles && activeFiles.length > 0 && skill.globs && skill.globs.length > 0) {
    const hasGlobMatch = skill.globs.some((glob) =>
      activeFiles.some((file) => matchesGlob(file, glob)),
    );
    if (hasGlobMatch) {
      normalized += GLOB_BOOST;
      reasons.push("file context match");
    }
  }

  return {
    score: normalized,
    reason: reasons.join(", ") || "no match",
  };
}

/**
 * Calculate overlap ratio between two token sets
 * Returns the fraction of queryTokens found in targetTokens.
 * Uses exact matching, substring matching, and fuzzy (Levenshtein) matching.
 */
function tokenOverlap(queryTokens: string[], targetTokens: string[]): number {
  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

  const targetSet = new Set(targetTokens);
  let hits = 0;

  for (const token of queryTokens) {
    // Exact match
    if (targetSet.has(token)) {
      hits++;
      continue;
    }

    let bestPartial = 0;

    for (const target of targetSet) {
      // Substring match
      if (token !== target && (token.includes(target) || target.includes(token))) {
        bestPartial = Math.max(bestPartial, 0.5);
      }

      // Fuzzy match: allow 1-char typos for words >= 4 chars
      if (
        bestPartial < 0.4 &&
        token.length >= 4 &&
        target.length >= 4 &&
        levenshtein(token, target) <= 1
      ) {
        bestPartial = Math.max(bestPartial, 0.4);
      }
    }

    hits += bestPartial;
  }

  return hits / queryTokens.length;
}

/**
 * Tokenize a string into lowercase words, filtering stop words.
 * Applies stemming to improve matching across word forms.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem);
}

// ============================================================================
// Stemmer (simplified Porter Stemmer — no external dependencies)
// ============================================================================

/**
 * Simplified Porter Stemmer for English.
 * Handles common suffixes to improve matching across word forms.
 * e.g., "testing" -> "test", "deployed" -> "deploy", "creates" -> "creat"
 */
export function stem(word: string): string {
  if (word.length < 4) return word;

  let w = word;

  // Step 1: Plurals and -ed/-ing
  if (w.endsWith("ies") && w.length > 4) {
    w = w.slice(0, -3) + "i";
  } else if (w.endsWith("sses")) {
    w = w.slice(0, -2);
  } else if (w.endsWith("ness")) {
    w = w.slice(0, -4);
  } else if (w.endsWith("ment")) {
    w = w.slice(0, -4);
  } else if (w.endsWith("able")) {
    w = w.slice(0, -4);
  } else if (w.endsWith("tion")) {
    w = w.slice(0, -4) + "t";
  } else if (w.endsWith("sion")) {
    w = w.slice(0, -4) + "s";
  } else if (w.endsWith("ful")) {
    w = w.slice(0, -3);
  } else if (w.endsWith("ing") && w.length > 5) {
    w = w.slice(0, -3);
    // Handle doubling: "running" -> "runn" -> "run"
    if (w.length >= 3 && w[w.length - 1] === w[w.length - 2]) {
      w = w.slice(0, -1);
    }
  } else if (w.endsWith("ed") && w.length > 4) {
    w = w.slice(0, -2);
    // Handle doubling: "mapped" -> "mapp" -> "map"
    if (w.length >= 3 && w[w.length - 1] === w[w.length - 2]) {
      w = w.slice(0, -1);
    }
  } else if (w.endsWith("es") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    w = w.slice(0, -1);
  }

  return w;
}

// ============================================================================
// Levenshtein distance (for fuzzy matching)
// ============================================================================

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for fuzzy matching (typo tolerance).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use single-row optimization
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[j]! + 1, // deletion
        prev + 1, // insertion
        row[j - 1]! + cost, // substitution
      );
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length]!;
}

// ============================================================================
// Glob matching (lightweight, no dependencies)
// ============================================================================

/**
 * Simple glob matching for file extensions.
 * Supports patterns like "*.ts", "*.tsx", "*.py".
 * For more complex globs, a full minimatch library would be needed.
 */
function matchesGlob(filePath: string, glob: string): boolean {
  if (glob.startsWith("*.")) {
    const ext = glob.slice(1); // e.g., ".ts"
    return filePath.endsWith(ext);
  }
  // Simple contains check for non-extension globs
  return filePath.includes(glob);
}
