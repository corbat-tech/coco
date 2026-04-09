/**
 * Tests for quality-loop.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";

// Mock dependencies before imports
vi.mock("../../config/paths.js", () => ({
  CONFIG_PATHS: {
    config: "/tmp/test-coco-config.json",
  },
}));

import {
  isQualityLoop,
  setQualityLoop,
  toggleQualityLoop,
  looksLikeFeatureRequest,
  formatQualityLoopIndicator,
  formatQualityLoopHint,
  formatQualityResult,
  getQualityLoopSystemPrompt,
  parseQualityLoopReport,
  loadQualityLoopPreference,
  saveQualityLoopPreference,
  type QualityLoopResult,
} from "./quality-loop.js";

describe("quality-loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQualityLoop(false); // Reset state
  });

  describe("state management", () => {
    it("should allow setting quality loop", () => {
      setQualityLoop(true);
      expect(isQualityLoop()).toBe(true);

      setQualityLoop(false);
      expect(isQualityLoop()).toBe(false);
    });

    it("should toggle quality loop", () => {
      setQualityLoop(false);
      const newState = toggleQualityLoop();
      expect(newState).toBe(true);
      expect(isQualityLoop()).toBe(true);

      const nextState = toggleQualityLoop();
      expect(nextState).toBe(false);
      expect(isQualityLoop()).toBe(false);
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
    it("should format quality loop indicator when enabled", () => {
      setQualityLoop(true);
      const indicator = formatQualityLoopIndicator();
      expect(indicator).toContain("[quality loop]");
    });

    it("should format empty indicator when disabled", () => {
      setQualityLoop(false);
      const indicator = formatQualityLoopIndicator();
      expect(indicator).toBe("");
    });

    it("should format hint message", () => {
      const hint = formatQualityLoopHint();
      expect(hint).toContain("/quality");
    });

    it("should format quality result", () => {
      const result: QualityLoopResult = {
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
    it("should generate quality loop system prompt", () => {
      const prompt = getQualityLoopSystemPrompt();
      expect(prompt).toContain("Quality Loop Mode");
      expect(prompt).toContain("QUALITY_LOOP_REPORT");
    });
  });

  describe("parseQualityLoopReport", () => {
    it("should parse a full valid report", () => {
      const content = `
QUALITY_LOOP_REPORT
score_history: [72, 84, 87, 88]
tests_passed: 10
tests_total: 10
coverage: 85
security: 100
iterations: 4
converged: true
`;
      const result = parseQualityLoopReport(content);
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
QUALITY_LOOP_REPORT
tests_passed: 10
converged: true
`;
      expect(parseQualityLoopReport(content)).toBeNull();
    });

    it("should return null when marker is absent", () => {
      const content = "This response has no quality report.";
      expect(parseQualityLoopReport(content)).toBeNull();
    });

    it("should handle missing optional fields without crashing", () => {
      const content = `
QUALITY_LOOP_REPORT
score_history: [80, 88]
converged: false
`;
      const result = parseQualityLoopReport(content);
      expect(result).not.toBeNull();
      expect(result!.testsPassed).toBeUndefined();
      expect(result!.testsTotal).toBeUndefined();
      expect(result!.coverage).toBeUndefined();
      expect(result!.securityScore).toBeUndefined();
    });

    it("should parse report embedded in a longer LLM response", () => {
      const content = `
Here is my implementation of the feature. I have written tests and verified coverage.

QUALITY_LOOP_REPORT
score_history: [75, 86]
tests_passed: 8
tests_total: 8
coverage: 82
security: 100
iterations: 2
converged: true

The code is now at a senior-level quality threshold.
`;
      const result = parseQualityLoopReport(content);
      expect(result).not.toBeNull();
      expect(result!.scoreHistory).toEqual([75, 86]);
      expect(result!.converged).toBe(true);
    });

    it("should filter out non-numeric values from score array", () => {
      const content = `
QUALITY_LOOP_REPORT
score_history: [72, NaN, 88, bad]
converged: true
`;
      const result = parseQualityLoopReport(content);
      expect(result).not.toBeNull();
      expect(result!.scoreHistory).toEqual([72, 88]);
      expect(result!.finalScore).toBe(88);
    });

    it("should return null for empty score array after filtering", () => {
      const content = `
QUALITY_LOOP_REPORT
score_history: [NaN, bad, xyz]
converged: true
`;
      expect(parseQualityLoopReport(content)).toBeNull();
    });
  });

  describe("persistence", () => {
    const CONFIG_FILE = "/tmp/test-coco-config.json";

    afterEach(async () => {
      // Clean up temp config file between tests
      try {
        await fs.unlink(CONFIG_FILE);
      } catch {
        // File may not exist
      }
    });

    it("should save and load quality loop preference (false)", async () => {
      await saveQualityLoopPreference(false);
      setQualityLoop(true); // Reset in-memory state to ensure load overwrites it
      const loaded = await loadQualityLoopPreference();
      expect(loaded).toBe(false);
      expect(isQualityLoop()).toBe(false);
    });

    it("should save and load quality loop preference (true)", async () => {
      await saveQualityLoopPreference(true);
      setQualityLoop(false); // Reset in-memory state
      const loaded = await loadQualityLoopPreference();
      expect(loaded).toBe(true);
      expect(isQualityLoop()).toBe(true);
    });

    it("should fall back to legacy cocoMode key for backward compat", async () => {
      await fs.writeFile(CONFIG_FILE, JSON.stringify({ cocoMode: false }));
      setQualityLoop(true); // Reset in-memory state
      const loaded = await loadQualityLoopPreference();
      expect(loaded).toBe(false);
    });

    it("should prefer qualityLoop key over legacy cocoMode key", async () => {
      await fs.writeFile(CONFIG_FILE, JSON.stringify({ cocoMode: false, qualityLoop: true }));
      setQualityLoop(false); // Reset in-memory state
      const loaded = await loadQualityLoopPreference();
      expect(loaded).toBe(true);
    });

    it("should default to false when config file is missing", async () => {
      setQualityLoop(true); // Reset in-memory state
      const loaded = await loadQualityLoopPreference();
      expect(loaded).toBe(false);
      expect(isQualityLoop()).toBe(false);
    });

    it("should preserve existing config keys when saving", async () => {
      await fs.writeFile(CONFIG_FILE, JSON.stringify({ someOtherKey: "value" }));
      await saveQualityLoopPreference(false);
      const content = await fs.readFile(CONFIG_FILE, "utf-8");
      const config = JSON.parse(content);
      expect(config.someOtherKey).toBe("value");
      expect(config.qualityLoop).toBe(false);
    });
  });
});
