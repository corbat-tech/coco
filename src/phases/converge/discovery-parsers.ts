/**
 * Parser and normalizer functions for the Discovery Engine
 */

import { randomUUID } from "node:crypto";
import type {
  Requirement,
  Question,
  Assumption,
  TechDecision,
} from "./types.js";

/**
 * Raw requirement data from LLM response
 */
export interface RawRequirement {
  category?: string;
  priority?: string;
  title?: string;
  description?: string;
  explicit?: boolean;
  acceptanceCriteria?: string[];
}

/**
 * Raw question data from LLM response
 */
export interface RawQuestion {
  category?: string;
  question?: string;
  context?: string;
  importance?: string;
  defaultAnswer?: string | null;
  options?: string[] | null;
}

/**
 * Raw assumption data from LLM response
 */
export interface RawAssumption {
  category?: string;
  statement?: string;
  confidence?: string;
  impactIfWrong?: string;
}

/**
 * Raw tech hint data from LLM response
 */
export interface RawTechHint {
  area?: string;
  decision?: string;
  alternatives?: string[];
  rationale?: string;
}

/**
 * Normalize complexity value
 */
export function normalizeComplexity(
  value?: string
): "simple" | "moderate" | "complex" | "enterprise" {
  const normalized = value?.toLowerCase();
  if (normalized === "simple") return "simple";
  if (normalized === "moderate") return "moderate";
  if (normalized === "complex") return "complex";
  if (normalized === "enterprise") return "enterprise";
  return "moderate";
}

/**
 * Normalize requirement category
 */
export function normalizeCategory(value?: string): Requirement["category"] {
  const normalized = value?.toLowerCase();
  if (normalized === "functional") return "functional";
  if (normalized === "non_functional" || normalized === "nonfunctional")
    return "non_functional";
  if (normalized === "technical") return "technical";
  if (normalized === "user_experience" || normalized === "ux")
    return "user_experience";
  if (normalized === "integration") return "integration";
  if (normalized === "deployment") return "deployment";
  if (normalized === "constraint") return "constraint";
  return "functional";
}

/**
 * Normalize requirement priority
 */
export function normalizePriority(value?: string): Requirement["priority"] {
  const normalized = value?.toLowerCase();
  if (normalized === "must_have" || normalized === "must") return "must_have";
  if (normalized === "should_have" || normalized === "should")
    return "should_have";
  if (normalized === "could_have" || normalized === "could")
    return "could_have";
  if (normalized === "wont_have" || normalized === "wont") return "wont_have";
  return "should_have";
}

/**
 * Normalize question category
 */
export function normalizeQuestionCategory(value?: string): Question["category"] {
  const normalized = value?.toLowerCase();
  if (normalized === "clarification") return "clarification";
  if (normalized === "expansion") return "expansion";
  if (normalized === "decision") return "decision";
  if (normalized === "confirmation") return "confirmation";
  if (normalized === "scope") return "scope";
  if (normalized === "priority") return "priority";
  return "clarification";
}

/**
 * Normalize question importance
 */
export function normalizeImportance(
  value?: string
): "critical" | "important" | "helpful" {
  const normalized = value?.toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "important") return "important";
  return "helpful";
}

/**
 * Normalize confidence level
 */
export function normalizeConfidence(value?: string): "high" | "medium" | "low" {
  const normalized = value?.toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

/**
 * Parse raw requirements from LLM response
 */
export function parseRequirements(data: RawRequirement[]): Requirement[] {
  return data.map((r) => ({
    id: randomUUID(),
    category: normalizeCategory(r.category),
    priority: normalizePriority(r.priority),
    title: r.title || "Untitled",
    description: r.description || "",
    sourceMessageId: "",
    explicit: r.explicit ?? true,
    acceptanceCriteria: r.acceptanceCriteria,
    status: "draft" as const,
  }));
}

/**
 * Parse raw questions from LLM response
 */
export function parseQuestions(data: RawQuestion[]): Question[] {
  return data.map((q) => ({
    id: randomUUID(),
    category: normalizeQuestionCategory(q.category),
    question: q.question || "",
    context: q.context || "",
    importance: normalizeImportance(q.importance),
    defaultAnswer: q.defaultAnswer || undefined,
    options: q.options || undefined,
    asked: false,
  }));
}

/**
 * Parse raw assumptions from LLM response
 */
export function parseAssumptions(data: RawAssumption[]): Assumption[] {
  return data.map((a) => ({
    id: randomUUID(),
    category: a.category || "general",
    statement: a.statement || "",
    confidence: normalizeConfidence(a.confidence),
    confirmed: false,
    impactIfWrong: a.impactIfWrong || "",
  }));
}

/**
 * Parse raw tech hints from LLM response
 */
export function parseTechHints(data: RawTechHint[]): Partial<TechDecision>[] {
  return data.map((t) => ({
    area: t.area as TechDecision["area"],
    decision: t.decision,
    alternatives: t.alternatives || [],
    rationale: t.rationale,
    explicit: false,
  }));
}
