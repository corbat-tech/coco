/**
 * Tests for complete phase module exports
 */

import { describe, it, expect } from "vitest";
import * as CompleteExports from "./index.js";

describe("Complete phase module exports", () => {
  describe("Code Generator", () => {
    it("should export CodeGenerator", () => {
      expect(CompleteExports.CodeGenerator).toBeDefined();
    });

    it("should export createCodeGenerator", () => {
      expect(CompleteExports.createCodeGenerator).toBeDefined();
      expect(typeof CompleteExports.createCodeGenerator).toBe("function");
    });
  });

  describe("Code Reviewer", () => {
    it("should export CodeReviewer", () => {
      expect(CompleteExports.CodeReviewer).toBeDefined();
    });

    it("should export createCodeReviewer", () => {
      expect(CompleteExports.createCodeReviewer).toBeDefined();
      expect(typeof CompleteExports.createCodeReviewer).toBe("function");
    });
  });

  describe("Task Iterator", () => {
    it("should export TaskIterator", () => {
      expect(CompleteExports.TaskIterator).toBeDefined();
    });

    it("should export createTaskIterator", () => {
      expect(CompleteExports.createTaskIterator).toBeDefined();
      expect(typeof CompleteExports.createTaskIterator).toBe("function");
    });
  });

  describe("Executor", () => {
    it("should export CompleteExecutor", () => {
      expect(CompleteExports.CompleteExecutor).toBeDefined();
    });

    it("should export createCompleteExecutor", () => {
      expect(CompleteExports.createCompleteExecutor).toBeDefined();
      expect(typeof CompleteExports.createCompleteExecutor).toBe("function");
    });
  });

  describe("Config defaults", () => {
    it("should export DEFAULT_QUALITY_CONFIG", () => {
      expect(CompleteExports.DEFAULT_QUALITY_CONFIG).toBeDefined();
    });

    it("should export DEFAULT_COMPLETE_CONFIG", () => {
      expect(CompleteExports.DEFAULT_COMPLETE_CONFIG).toBeDefined();
    });
  });

  describe("Prompts", () => {
    it("should export CODE_GENERATION_SYSTEM_PROMPT", () => {
      expect(CompleteExports.CODE_GENERATION_SYSTEM_PROMPT).toBeDefined();
      expect(typeof CompleteExports.CODE_GENERATION_SYSTEM_PROMPT).toBe("string");
    });

    it("should export CODE_REVIEW_SYSTEM_PROMPT", () => {
      expect(CompleteExports.CODE_REVIEW_SYSTEM_PROMPT).toBeDefined();
      expect(typeof CompleteExports.CODE_REVIEW_SYSTEM_PROMPT).toBe("string");
    });

    it("should export GENERATE_CODE_PROMPT", () => {
      expect(CompleteExports.GENERATE_CODE_PROMPT).toBeDefined();
      expect(typeof CompleteExports.GENERATE_CODE_PROMPT).toBe("string");
    });

    it("should export REVIEW_CODE_PROMPT", () => {
      expect(CompleteExports.REVIEW_CODE_PROMPT).toBeDefined();
      expect(typeof CompleteExports.REVIEW_CODE_PROMPT).toBe("string");
    });

    it("should export IMPROVE_CODE_PROMPT", () => {
      expect(CompleteExports.IMPROVE_CODE_PROMPT).toBeDefined();
      expect(typeof CompleteExports.IMPROVE_CODE_PROMPT).toBe("string");
    });

    it("should export fillPrompt", () => {
      expect(CompleteExports.fillPrompt).toBeDefined();
      expect(typeof CompleteExports.fillPrompt).toBe("function");
    });

    it("should export buildPreviousCodeSection", () => {
      expect(CompleteExports.buildPreviousCodeSection).toBeDefined();
      expect(typeof CompleteExports.buildPreviousCodeSection).toBe("function");
    });

    it("should export buildFeedbackSection", () => {
      expect(CompleteExports.buildFeedbackSection).toBeDefined();
      expect(typeof CompleteExports.buildFeedbackSection).toBe("function");
    });
  });
});

describe("Complete phase defaults", () => {
  describe("DEFAULT_QUALITY_CONFIG", () => {
    it("should have valid minimum score", () => {
      expect(CompleteExports.DEFAULT_QUALITY_CONFIG.minScore).toBeGreaterThan(0);
      expect(CompleteExports.DEFAULT_QUALITY_CONFIG.minScore).toBeLessThanOrEqual(100);
    });

    it("should have valid max iterations", () => {
      expect(CompleteExports.DEFAULT_QUALITY_CONFIG.maxIterations).toBeGreaterThan(0);
    });

    it("should have valid convergence threshold", () => {
      expect(CompleteExports.DEFAULT_QUALITY_CONFIG.convergenceThreshold).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_COMPLETE_CONFIG", () => {
    it("should have quality config", () => {
      expect(CompleteExports.DEFAULT_COMPLETE_CONFIG.quality).toBeDefined();
    });
  });
});

describe("Complete utility functions", () => {
  describe("fillPrompt", () => {
    it("should fill placeholders", () => {
      const template = "Task: {{taskTitle}}, Type: {{taskType}}";
      const filled = CompleteExports.fillPrompt(template, {
        taskTitle: "Create User",
        taskType: "feature",
      });

      expect(filled).toBe("Task: Create User, Type: feature");
    });
  });

  describe("buildPreviousCodeSection", () => {
    it("should build section for previous code", () => {
      const previousCode = `// src/user.ts
export class User {}

// src/user.test.ts
describe('User', () => {})`;

      const section = CompleteExports.buildPreviousCodeSection(previousCode);

      expect(section).toContain("src/user.ts");
      expect(section).toContain("export class User {}");
    });

    it("should return empty string for undefined", () => {
      const section = CompleteExports.buildPreviousCodeSection(undefined);
      expect(section).toBe("");
    });
  });

  describe("buildFeedbackSection", () => {
    it("should build feedback section from review", () => {
      const issues = [
        { severity: "high", message: "Missing null check" },
      ];

      const section = CompleteExports.buildFeedbackSection("Add JSDoc comments", issues);

      expect(section).toContain("Missing null check");
      expect(section).toContain("Add JSDoc comments");
    });

    it("should handle empty feedback", () => {
      const section = CompleteExports.buildFeedbackSection(undefined, []);

      expect(section).toBe("");
    });
  });
});
