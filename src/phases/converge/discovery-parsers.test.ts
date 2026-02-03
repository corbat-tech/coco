/**
 * Tests for discovery-parsers module
 */

import { describe, it, expect } from "vitest";
import {
  normalizeComplexity,
  normalizeCategory,
  normalizePriority,
  normalizeQuestionCategory,
  normalizeImportance,
  normalizeConfidence,
  parseRequirements,
  parseQuestions,
  parseAssumptions,
  parseTechHints,
} from "./discovery-parsers.js";

describe("normalizeComplexity", () => {
  it("should return 'simple' for simple", () => {
    expect(normalizeComplexity("simple")).toBe("simple");
    expect(normalizeComplexity("SIMPLE")).toBe("simple");
  });

  it("should return 'moderate' for moderate", () => {
    expect(normalizeComplexity("moderate")).toBe("moderate");
    expect(normalizeComplexity("MODERATE")).toBe("moderate");
  });

  it("should return 'complex' for complex", () => {
    expect(normalizeComplexity("complex")).toBe("complex");
  });

  it("should return 'enterprise' for enterprise", () => {
    expect(normalizeComplexity("enterprise")).toBe("enterprise");
  });

  it("should default to 'moderate' for undefined or unknown values", () => {
    expect(normalizeComplexity(undefined)).toBe("moderate");
    expect(normalizeComplexity("unknown")).toBe("moderate");
  });
});

describe("normalizeCategory", () => {
  it("should normalize all category types", () => {
    expect(normalizeCategory("functional")).toBe("functional");
    expect(normalizeCategory("non_functional")).toBe("non_functional");
    expect(normalizeCategory("nonfunctional")).toBe("non_functional");
    expect(normalizeCategory("technical")).toBe("technical");
    expect(normalizeCategory("user_experience")).toBe("user_experience");
    expect(normalizeCategory("ux")).toBe("user_experience");
    expect(normalizeCategory("integration")).toBe("integration");
    expect(normalizeCategory("deployment")).toBe("deployment");
    expect(normalizeCategory("constraint")).toBe("constraint");
  });

  it("should be case-insensitive", () => {
    expect(normalizeCategory("FUNCTIONAL")).toBe("functional");
    expect(normalizeCategory("Technical")).toBe("technical");
  });

  it("should default to 'functional' for undefined or unknown values", () => {
    expect(normalizeCategory(undefined)).toBe("functional");
    expect(normalizeCategory("unknown")).toBe("functional");
  });
});

describe("normalizePriority", () => {
  it("should normalize all priority types", () => {
    expect(normalizePriority("must_have")).toBe("must_have");
    expect(normalizePriority("must")).toBe("must_have");
    expect(normalizePriority("should_have")).toBe("should_have");
    expect(normalizePriority("should")).toBe("should_have");
    expect(normalizePriority("could_have")).toBe("could_have");
    expect(normalizePriority("could")).toBe("could_have");
    expect(normalizePriority("wont_have")).toBe("wont_have");
    expect(normalizePriority("wont")).toBe("wont_have");
  });

  it("should be case-insensitive", () => {
    expect(normalizePriority("MUST_HAVE")).toBe("must_have");
    expect(normalizePriority("SHOULD")).toBe("should_have");
  });

  it("should default to 'should_have' for undefined or unknown values", () => {
    expect(normalizePriority(undefined)).toBe("should_have");
    expect(normalizePriority("unknown")).toBe("should_have");
  });
});

describe("normalizeQuestionCategory", () => {
  it("should normalize all question category types", () => {
    expect(normalizeQuestionCategory("clarification")).toBe("clarification");
    expect(normalizeQuestionCategory("expansion")).toBe("expansion");
    expect(normalizeQuestionCategory("decision")).toBe("decision");
    expect(normalizeQuestionCategory("confirmation")).toBe("confirmation");
    expect(normalizeQuestionCategory("scope")).toBe("scope");
    expect(normalizeQuestionCategory("priority")).toBe("priority");
  });

  it("should be case-insensitive", () => {
    expect(normalizeQuestionCategory("CLARIFICATION")).toBe("clarification");
    expect(normalizeQuestionCategory("Expansion")).toBe("expansion");
  });

  it("should default to 'clarification' for undefined or unknown values", () => {
    expect(normalizeQuestionCategory(undefined)).toBe("clarification");
    expect(normalizeQuestionCategory("unknown")).toBe("clarification");
  });
});

describe("normalizeImportance", () => {
  it("should normalize all importance types", () => {
    expect(normalizeImportance("critical")).toBe("critical");
    expect(normalizeImportance("important")).toBe("important");
    expect(normalizeImportance("helpful")).toBe("helpful");
  });

  it("should be case-insensitive", () => {
    expect(normalizeImportance("CRITICAL")).toBe("critical");
    expect(normalizeImportance("Important")).toBe("important");
  });

  it("should default to 'helpful' for undefined or unknown values", () => {
    expect(normalizeImportance(undefined)).toBe("helpful");
    expect(normalizeImportance("unknown")).toBe("helpful");
  });
});

describe("normalizeConfidence", () => {
  it("should normalize all confidence types", () => {
    expect(normalizeConfidence("high")).toBe("high");
    expect(normalizeConfidence("medium")).toBe("medium");
    expect(normalizeConfidence("low")).toBe("low");
  });

  it("should be case-insensitive", () => {
    expect(normalizeConfidence("HIGH")).toBe("high");
    expect(normalizeConfidence("Low")).toBe("low");
  });

  it("should default to 'medium' for undefined or unknown values", () => {
    expect(normalizeConfidence(undefined)).toBe("medium");
    expect(normalizeConfidence("unknown")).toBe("medium");
  });
});

describe("parseRequirements", () => {
  it("should parse raw requirements", () => {
    const raw = [
      {
        category: "functional",
        priority: "must_have",
        title: "User Login",
        description: "Users can log in",
        explicit: true,
        acceptanceCriteria: ["AC1", "AC2"],
      },
    ];

    const result = parseRequirements(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "functional",
      priority: "must_have",
      title: "User Login",
      description: "Users can log in",
      explicit: true,
      acceptanceCriteria: ["AC1", "AC2"],
      status: "draft",
    });
    expect(result[0]?.id).toBeDefined();
  });

  it("should provide defaults for missing fields", () => {
    const raw = [{}];

    const result = parseRequirements(raw);

    expect(result[0]).toMatchObject({
      category: "functional",
      priority: "should_have",
      title: "Untitled",
      description: "",
      explicit: true,
      status: "draft",
    });
  });

  it("should handle explicit false", () => {
    const raw = [{ explicit: false }];

    const result = parseRequirements(raw);

    expect(result[0]?.explicit).toBe(false);
  });
});

describe("parseQuestions", () => {
  it("should parse raw questions", () => {
    const raw = [
      {
        category: "decision",
        question: "Which database?",
        context: "Need to choose",
        importance: "critical",
        defaultAnswer: "PostgreSQL",
        options: ["PostgreSQL", "MySQL"],
      },
    ];

    const result = parseQuestions(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "decision",
      question: "Which database?",
      context: "Need to choose",
      importance: "critical",
      defaultAnswer: "PostgreSQL",
      options: ["PostgreSQL", "MySQL"],
      asked: false,
    });
    expect(result[0]?.id).toBeDefined();
  });

  it("should provide defaults for missing fields", () => {
    const raw = [{}];

    const result = parseQuestions(raw);

    expect(result[0]).toMatchObject({
      category: "clarification",
      question: "",
      context: "",
      importance: "helpful",
      asked: false,
    });
    expect(result[0]?.defaultAnswer).toBeUndefined();
    expect(result[0]?.options).toBeUndefined();
  });

  it("should handle null defaultAnswer and options", () => {
    const raw = [{ defaultAnswer: null, options: null }];

    const result = parseQuestions(raw);

    expect(result[0]?.defaultAnswer).toBeUndefined();
    expect(result[0]?.options).toBeUndefined();
  });
});

describe("parseAssumptions", () => {
  it("should parse raw assumptions", () => {
    const raw = [
      {
        category: "technical",
        statement: "Using Node.js",
        confidence: "high",
        impactIfWrong: "Would need rewrite",
      },
    ];

    const result = parseAssumptions(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "technical",
      statement: "Using Node.js",
      confidence: "high",
      confirmed: false,
      impactIfWrong: "Would need rewrite",
    });
    expect(result[0]?.id).toBeDefined();
  });

  it("should provide defaults for missing fields", () => {
    const raw = [{}];

    const result = parseAssumptions(raw);

    expect(result[0]).toMatchObject({
      category: "general",
      statement: "",
      confidence: "medium",
      confirmed: false,
      impactIfWrong: "",
    });
  });
});

describe("parseTechHints", () => {
  it("should parse raw tech hints", () => {
    const raw = [
      {
        area: "backend",
        decision: "Use Express",
        alternatives: ["Fastify", "Koa"],
        rationale: "Most popular",
      },
    ];

    const result = parseTechHints(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      area: "backend",
      decision: "Use Express",
      alternatives: ["Fastify", "Koa"],
      rationale: "Most popular",
      explicit: false,
    });
  });

  it("should provide defaults for missing fields", () => {
    const raw = [{}];

    const result = parseTechHints(raw);

    expect(result[0]).toMatchObject({
      alternatives: [],
      explicit: false,
    });
  });
});
