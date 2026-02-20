/**
 * Tests for coco-mode.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("../../config/paths.js", () => ({
  CONFIG_PATHS: {
    config: "/tmp/test-coco-config.json",
  },
}));

import {
  isCocoMode,
  setCocoMode,
  toggleCocoMode,
  looksLikeFeatureRequest,
  formatCocoModeIndicator,
  formatCocoHint,
  formatQualityResult,
  getCocoModeSystemPrompt,
  parseCocoQualityReport,
  type CocoQualityResult,
} from "./coco-mode.js";

describe("coco-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCocoMode(false); // Reset state
  });

  describe("state management", () => {
    it("should allow setting coco mode", () => {
      setCocoMode(true);
      expect(isCocoMode()).toBe(true);

      setCocoMode(false);
      expect(isCocoMode()).toBe(false);
    });

    it("should toggle coco mode", () => {
      setCocoMode(false);
      const newState = toggleCocoMode();
      expect(newState).toBe(true);
      expect(isCocoMode()).toBe(true);

      const nextState = toggleCocoMode();
      expect(nextState).toBe(false);
      expect(isCocoMode()).toBe(false);
    });
  });

  describe("feature request detection", () => {
    it("should detect feature requests", () => {
      expect(
        looksLikeFeatureRequest("Implement user authentication with JWT tokens and refresh logic"),
      ).toBe(true);
      expect(looksLikeFeatureRequest("Create a new REST API endpoint for user registration")).toBe(
        true,
      );
    });

    it("should not detect questions as feature requests", () => {
      expect(looksLikeFeatureRequest("How does authentication work?")).toBe(false);
    });

    it("should not detect short commands as feature requests", () => {
      expect(looksLikeFeatureRequest("Help")).toBe(false);
      expect(looksLikeFeatureRequest("Show status")).toBe(false);
    });
  });

  describe("formatting", () => {
    it("should format coco mode indicator when enabled", () => {
      setCocoMode(true);
      const indicator = formatCocoModeIndicator();
      expect(indicator).toContain("[coco]");
    });

    it("should format empty indicator when disabled", () => {
      setCocoMode(false);
      const indicator = formatCocoModeIndicator();
      expect(indicator).toBe("");
    });

    it("should format hint message", () => {
      const hint = formatCocoHint();
      expect(hint).toContain("/coco");
    });

    it("should format quality result", () => {
      const result: CocoQualityResult = {
        converged: true,
        scoreHistory: [72, 84, 87, 88],
        finalScore: 88,
        iterations: 4,
        testsPassed: 10,
        testsTotal: 10,
        coverage: 85,
        securityScore: 100,
      };

      const formatted = formatQualityResult(result);
      expect(formatted).toContain("72");
      expect(formatted).toContain("88");
      expect(formatted).toContain("converged");
    });
  });

  describe("system prompt", () => {
    it("should generate coco mode system prompt", () => {
      const prompt = getCocoModeSystemPrompt();
      expect(prompt).toContain("COCO Quality Mode");
      expect(prompt).toContain("COCO_QUALITY_REPORT");
    });
  });

  describe("parseCocoQualityReport", () => {
    it("should parse a full valid report", () => {
      const content = `
COCO_QUALITY_REPORT
score_history: [72, 84, 87, 88]
tests_passed: 10
tests_total: 10
coverage: 85
security: 100
iterations: 4
converged: true
`;
      const result = parseCocoQualityReport(content);
      expect(result).not.toBeNull();
      expect(result!.scoreHistory).toEqual([72, 84, 87, 88]);
      expect(result!.finalScore).toBe(88);
      expect(result!.converged).toBe(true);
      expect(result!.testsPassed).toBe(10);
      expect(result!.testsTotal).toBe(10);
      expect(result!.coverage).toBe(85);
      expect(result!.securityScore).toBe(100);
      expect(result!.iterations).toBe(4);
    });

    it("should return null when score_history is missing", () => {
      const content = `
COCO_QUALITY_REPORT
tests_passed: 10
converged: true
`;
      expect(parseCocoQualityReport(content)).toBeNull();
    });

    it("should return null when marker is absent", () => {
      const content = "This response has no quality report.";
      expect(parseCocoQualityReport(content)).toBeNull();
    });

    it("should handle missing optional fields without crashing", () => {
      const content = `
COCO_QUALITY_REPORT
score_history: [80, 88]
converged: false
`;
      const result = parseCocoQualityReport(content);
      expect(result).not.toBeNull();
      expect(result!.testsPassed).toBeUndefined();
      expect(result!.testsTotal).toBeUndefined();
      expect(result!.coverage).toBeUndefined();
      expect(result!.securityScore).toBeUndefined();
    });

    it("should parse report embedded in a longer LLM response", () => {
      const content = `
Here is my implementation of the feature. I have written tests and verified coverage.

COCO_QUALITY_REPORT
score_history: [75, 86]
tests_passed: 8
tests_total: 8
coverage: 82
security: 100
iterations: 2
converged: true

The code is now at a senior-level quality threshold.
`;
      const result = parseCocoQualityReport(content);
      expect(result).not.toBeNull();
      expect(result!.scoreHistory).toEqual([75, 86]);
      expect(result!.converged).toBe(true);
    });

    it("should filter out non-numeric values from score array", () => {
      const content = `
COCO_QUALITY_REPORT
score_history: [72, NaN, 88, bad]
converged: true
`;
      const result = parseCocoQualityReport(content);
      expect(result).not.toBeNull();
      expect(result!.scoreHistory).toEqual([72, 88]);
      expect(result!.finalScore).toBe(88);
    });

    it("should return null for empty score array after filtering", () => {
      const content = `
COCO_QUALITY_REPORT
score_history: [NaN, bad, xyz]
converged: true
`;
      expect(parseCocoQualityReport(content)).toBeNull();
    });
  });
});
