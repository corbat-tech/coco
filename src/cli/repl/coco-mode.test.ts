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
});
