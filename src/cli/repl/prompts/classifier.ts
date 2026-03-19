/**
 * Request classifier for prompt enhancer selection.
 *
 * Classifies user input into a RequestType using zero-latency pattern matching.
 * Patterns are checked in priority order — more specific types (bugfix, debug)
 * take precedence over broader types (feature, general).
 */

import type { RequestType } from "./enhancers/types.js";

/**
 * Classification rule: a regex pattern mapped to a RequestType.
 * Rules are checked in order — first match wins.
 */
interface ClassificationRule {
  type: RequestType;
  pattern: RegExp;
}

/**
 * Classification rules in priority order (first match wins).
 * More specific intents are checked before broader ones.
 */
const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  // Debug — most specific intent (active investigation)
  {
    type: "debug",
    pattern:
      /\b(debug|trace|diagnos[ei]|investigate|stacktrace|exception|breakpoint|step.?through)\b/i,
  },
  // Bugfix — something is broken (EN + ES)
  {
    type: "bugfix",
    pattern:
      /\b(fix|bug|error|broken|crash(?:es|ed|ing)?|fail(?:s|ed|ing)?|issue|wrong|incorrect|not.?working|arregl[ao]|corrig[ei]|falla|roto|no.?funciona)\b/i,
  },
  // Test — writing or running tests (check before feature so "write tests" → test)
  {
    type: "test",
    pattern: /\b(tests?|spec|coverage|assert|vitest|jest|unit.?test|e2e|test.?driven|tdd)\b/i,
  },
  // Review — code quality inspection
  {
    type: "review",
    pattern:
      /\b(review|audit|check.?quality|inspect|code.?review|security.?review|revisa|audita)\b/i,
  },
  // Refactor — structural improvement (EN + ES)
  {
    type: "refactor",
    pattern:
      /\b(refactor|clean.?up|improve|optimize|simplif[yi]|reorganiz[ei]|restructur[ei]|extract|rename|refactoriza|mejora|optimiza|simplifica)\b/i,
  },
  // Question — seeking information, checked BEFORE plan/feature (EN + ES)
  // Uses ^ anchor so "explain X" → question, but "create a plan" → plan
  {
    type: "question",
    pattern:
      /^(what|how|why|where|when|explain|describe|show me|tell me|qu[ée]|c[oó]mo|por.?qu[eé]|d[oó]nde|cu[aá]ndo|explica|describe|muestra)\b/i,
  },
  // Plan — design and architecture (EN + ES)
  {
    type: "plan",
    pattern:
      /\b(plan|design|architect|strategy|approach|blueprint|roadmap|planifica|dise[ñn]a|arquitectura|estrategia)\b/i,
  },
  // Feature — creating something new (EN + ES)
  {
    type: "feature",
    pattern:
      /\b(implement|create|build|add|develop|write|generate|setup|set.?up|integrat[ei]|migrat[ei]|convert|implementa|crea|construye|a[ñn]ade|desarrolla|genera|configura)\b/i,
  },
];

/**
 * Classify a user input string into a RequestType.
 *
 * Uses zero-latency pattern matching (no LLM call).
 * Rules are checked in priority order — first match wins.
 * Falls back to "general" if no patterns match.
 *
 * @param input - The user's message text
 * @returns The classified request type
 */
export function classifyRequest(input: string): RequestType {
  // Only the first 1000 chars matter for classification — avoid regex overhead on large pastes
  const trimmed = input.trim().slice(0, 1000);

  // Empty or very short input → general
  if (trimmed.length < 2) return "general";

  // Question mark at end is a strong signal (but only for short-ish inputs)
  if (trimmed.endsWith("?") && trimmed.length < 200) {
    // Still check for action-oriented keywords first
    // "Can you fix this bug?" should be bugfix, not question
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.type === "question") continue;
      if (rule.pattern.test(trimmed)) return rule.type;
    }
    return "question";
  }

  // Check rules in priority order
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(trimmed)) return rule.type;
  }

  return "general";
}
