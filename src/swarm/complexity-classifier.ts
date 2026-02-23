/**
 * Complexity Classifier
 *
 * Classifies SwarmFeature complexity and selects the minimal necessary
 * agent roster for the swarm pipeline, avoiding running all 8 agents
 * when simpler reviews suffice.
 */

import type { LLMProvider } from "../providers/types.js";
import type { TaskComplexity } from "../types/task.js";
import type { SwarmAgentRole } from "./agents/types.js";
import type { SwarmFeature } from "./spec-parser.js";

/**
 * Result of a feature complexity classification.
 */
export interface ComplexityResult {
  /** Numeric complexity score from 1 (trivial) to 10 (very complex) */
  score: number;
  /** Categorical complexity level mapped from the score */
  level: TaskComplexity;
  /** Minimal agent roles required for this complexity level */
  agents: SwarmAgentRole[];
  /** Human-readable explanation of the classification */
  reasoning: string;
}

/**
 * Mapping from TaskComplexity level to the minimal required agent roster.
 *
 * Each level is a strict superset of the previous:
 * - trivial (1-3):  tdd-developer only
 * - simple (4-5):   + qa
 * - moderate (6-7): + architect
 * - complex (8-10): + security-auditor + external-reviewer
 */
export const AGENT_ROSTERS: Readonly<Record<TaskComplexity, SwarmAgentRole[]>> = {
  trivial: ["tdd-developer"],
  simple: ["tdd-developer", "qa"],
  moderate: ["tdd-developer", "qa", "architect"],
  complex: ["tdd-developer", "qa", "architect", "security-auditor", "external-reviewer"],
};

/** Score upper-bound thresholds for each complexity level */
const LEVEL_THRESHOLDS: Array<[number, TaskComplexity]> = [
  [3, "trivial"],
  [5, "simple"],
  [7, "moderate"],
  [10, "complex"],
];

/** Keywords that signal higher complexity and boost the score */
const COMPLEX_KEYWORDS = ["auth", "security", "migration", "refactor"] as const;

/** Keywords that signal lower complexity and reduce the score */
const SIMPLE_KEYWORDS = ["fix", "typo", "style"] as const;

/**
 * Map a numeric score (1-10) to a TaskComplexity level.
 */
function scoreToLevel(score: number): TaskComplexity {
  for (const [threshold, level] of LEVEL_THRESHOLDS) {
    if (score <= threshold) return level;
  }
  return "complex";
}

/**
 * Classify feature complexity using only local heuristics (no LLM call).
 *
 * Scoring factors (base score = 1, clamped to [1, 10]):
 * - Description word count: >5 words → +1, >20 → +2, >50 → +3
 * - Acceptance criteria count: 1 → +1, ≥2 → +2, ≥4 → +3
 * - Dependency count: ≥1 → +4, ≥3 → +8
 * - Complex keyword present (auth/security/migration/refactor): +8
 * - Simple keyword present (fix/typo/style): −2
 *
 * Score → Level:
 * - 1–3: trivial, 4–5: simple, 6–7: moderate, 8–10: complex
 */
export function classifyFeatureHeuristic(feature: SwarmFeature): ComplexityResult {
  const description = feature.description ?? "";
  const criteria = feature.acceptanceCriteria ?? [];
  const deps = feature.dependencies ?? [];

  const wordCount = description.split(/\s+/).filter(Boolean).length;
  const lowerDesc = description.toLowerCase();

  let score = 1;
  const reasons: string[] = [
    `words=${wordCount}`,
    `criteria=${criteria.length}`,
    `deps=${deps.length}`,
  ];

  // Description length contribution
  if (wordCount > 50) score += 3;
  else if (wordCount > 20) score += 2;
  else if (wordCount > 5) score += 1;

  // Acceptance criteria contribution
  if (criteria.length >= 4) score += 3;
  else if (criteria.length >= 2) score += 2;
  else if (criteria.length >= 1) score += 1;

  // Dependency contribution (large jump: deps imply integration complexity)
  if (deps.length >= 3) score += 8;
  else if (deps.length >= 1) score += 4;

  // Complex keyword boost (security-sensitive or structurally risky)
  const hasComplexKeyword = COMPLEX_KEYWORDS.some((kw) => lowerDesc.includes(kw));
  if (hasComplexKeyword) {
    score += 8;
    reasons.push("complex-keywords");
  }

  // Simple keyword penalty (known-trivial change types)
  const hasSimpleKeyword = SIMPLE_KEYWORDS.some((kw) => lowerDesc.includes(kw));
  if (hasSimpleKeyword) {
    score -= 2;
    reasons.push("simple-keywords");
  }

  // Clamp to valid range
  score = Math.max(1, Math.min(10, score));

  const level = scoreToLevel(score);

  return {
    score,
    level,
    agents: AGENT_ROSTERS[level],
    reasoning: `Heuristic score ${score}: ${reasons.join(", ")}`,
  };
}

/**
 * Classify feature complexity using the LLM provider, with heuristic fallback.
 *
 * Sends a structured prompt asking the LLM to rate the feature on a 1-10 scale
 * based on description, criteria count, dependency count, and known complexity
 * patterns. If the LLM call fails or returns an unparseable response, falls back
 * to {@link classifyFeatureHeuristic}.
 */
export async function classifyFeatureComplexity(
  feature: SwarmFeature,
  provider: LLMProvider,
): Promise<ComplexityResult> {
  const criteriaCount = (feature.acceptanceCriteria ?? []).length;
  const depsCount = (feature.dependencies ?? []).length;

  const userMessage = `Rate the complexity of this software feature on a scale of 1-10.

Feature: ${feature.name}
Description: ${feature.description ?? ""}
Acceptance Criteria count: ${criteriaCount}
Dependencies count: ${depsCount}

Complexity guidelines:
- 1-3 (trivial): Fix, typo, style change — short description, 0-1 criteria, 0 deps
- 4-5 (simple): Small enhancement — medium description, 2-3 criteria
- 6-7 (moderate): Feature with logic — longer description, 4+ criteria or 1+ deps
- 8-10 (complex): Security, auth, migration, heavy refactor — many deps or critical path

Return only JSON: { "score": <number 1-10>, "reasoning": "<brief explanation>" }`;

  try {
    const response = await provider.chat([{ role: "user", content: userMessage }], {
      maxTokens: 256,
      temperature: 0.2,
    });

    const json = extractJsonScore(response.content);
    if (json !== null && typeof json.score === "number") {
      const score = Math.max(1, Math.min(10, Math.round(json.score)));
      const level = scoreToLevel(score);
      return {
        score,
        level,
        agents: AGENT_ROSTERS[level],
        reasoning: json.reasoning ?? `LLM score: ${score}`,
      };
    }
  } catch {
    // Fall through to heuristic
  }

  return classifyFeatureHeuristic(feature);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface JsonScore {
  score: unknown;
  reasoning?: string;
}

function extractJsonScore(text: string): JsonScore | null {
  try {
    const stripped = text
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
    return JSON.parse(stripped) as JsonScore;
  } catch {
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as JsonScore;
      } catch {
        return null;
      }
    }
    return null;
  }
}
