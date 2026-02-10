/**
 * Tests for coco-mode.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("../../config/paths.js", () => ({
  CONFIG_PATHS: {
    config: "/tmp/test-coco-config.json",
  },
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

import {
  isCocoMode,
  setCocoMode,
  toggleCocoMode,
  wasHintShown,
  markHintShown,
  looksLikeFeatureRequest,
  formatCocoModeIndicator,
  formatCocoHint,
  formatQualityResult,
  loadCocoModePreference,
  saveCocoModePreference,
  getCocoModeSystemPrompt,
  type CocoQualityResult,
} from "./coco-mode.js";

describe("coco-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCocoMode(false);
  });

  describe("isCocoMode / setCocoMode", () => {
    it("should default to false", () => {
      expect(isCocoMode()).toBe(false);
    });

    it("should set mode to true", () => {
      setCocoMode(true);
      expect(isCocoMode()).toBe(true);
    });

    it("should set mode back to false", () => {
      setCocoMode(true);
      setCocoMode(false);
      expect(isCocoMode()).toBe(false);
    });
  });

  describe("toggleCocoMode", () => {
    it("should toggle from false to true", () => {
      const result = toggleCocoMode();
      expect(result).toBe(true);
      expect(isCocoMode()).toBe(true);
    });

    it("should toggle from true to false", () => {
      setCocoMode(true);
      const result = toggleCocoMode();
      expect(result).toBe(false);
      expect(isCocoMode()).toBe(false);
    });
  });

  describe("wasHintShown / markHintShown", () => {
    it("should track hint shown state", () => {
      // Note: hintShown is module-level state, may be true from previous tests
      markHintShown();
      expect(wasHintShown()).toBe(true);
    });
  });

  describe("looksLikeFeatureRequest", () => {
    it("should return false for short input", () => {
      expect(looksLikeFeatureRequest("fix bug")).toBe(false);
    });

    it("should return false for short questions", () => {
      expect(looksLikeFeatureRequest("What does this function do?")).toBe(false);
    });

    it("should return true for implement keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "implement a new authentication system with JWT tokens and refresh",
        ),
      ).toBe(true);
    });

    it("should return true for create keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "create a new user registration form with email validation and password strength",
        ),
      ).toBe(true);
    });

    it("should return true for build keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "build the payment processing pipeline with Stripe integration here",
        ),
      ).toBe(true);
    });

    it("should return true for add feature keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "add a feature for exporting data to CSV with custom column selection",
        ),
      ).toBe(true);
    });

    it("should return true for refactor keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "refactor the authentication module to use the strategy pattern instead of if-else",
        ),
      ).toBe(true);
    });

    it("should return true for write code keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "write a function that validates email addresses using RFC 5322 compliant regex",
        ),
      ).toBe(true);
    });

    it("should return true for migrate keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "migrate the database from PostgreSQL to MySQL with data transformation",
        ),
      ).toBe(true);
    });

    it("should return true for integrate keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "integrate the Stripe payment gateway with our checkout flow and webhooks",
        ),
      ).toBe(true);
    });

    it("should return true for setup keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "setup the CI/CD pipeline with GitHub Actions for automated deployment",
        ),
      ).toBe(true);
    });

    it("should return true for develop keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "develop a REST API for the user management system with CRUD operations",
        ),
      ).toBe(true);
    });

    it("should return true for design keywords", () => {
      expect(
        looksLikeFeatureRequest(
          "design the database schema for the e-commerce product catalog system",
        ),
      ).toBe(true);
    });

    it("should return false for non-feature text", () => {
      expect(
        looksLikeFeatureRequest(
          "the weather today is really nice and I enjoy walking in the park a lot",
        ),
      ).toBe(false);
    });
  });

  describe("formatCocoModeIndicator", () => {
    it("should return empty string when disabled", () => {
      setCocoMode(false);
      expect(formatCocoModeIndicator()).toBe("");
    });

    it("should return indicator when enabled", () => {
      setCocoMode(true);
      const result = formatCocoModeIndicator();
      expect(result).toContain("[coco]");
    });
  });

  describe("formatCocoHint", () => {
    it("should return hint text", () => {
      const result = formatCocoHint();
      expect(result).toContain("/coco");
      expect(result).toContain("quality");
    });
  });

  describe("formatQualityResult", () => {
    it("should format converged result with all fields", () => {
      const result: CocoQualityResult = {
        converged: true,
        scoreHistory: [65, 78, 88],
        finalScore: 88,
        iterations: 3,
        testsPassed: 42,
        testsTotal: 42,
        coverage: 95,
        securityScore: 100,
        durationMs: 12500,
      };
      const output = formatQualityResult(result);
      expect(output).toContain("65");
      expect(output).toContain("78");
      expect(output).toContain("88");
      expect(output).toContain("converged");
      expect(output).toContain("42/42");
      expect(output).toContain("95%");
      expect(output).toContain("100");
      expect(output).toContain("12.5s");
    });

    it("should format non-converged result", () => {
      const result: CocoQualityResult = {
        converged: false,
        scoreHistory: [50, 60],
        finalScore: 60,
        iterations: 10,
      };
      const output = formatQualityResult(result);
      expect(output).toContain("max iterations");
      expect(output).toContain("10");
    });

    it("should handle partial tests info", () => {
      const result: CocoQualityResult = {
        converged: true,
        scoreHistory: [90],
        finalScore: 90,
        iterations: 1,
        testsPassed: 10,
        testsTotal: 12,
      };
      const output = formatQualityResult(result);
      expect(output).toContain("10/12");
    });

    it("should handle partial coverage info", () => {
      const result: CocoQualityResult = {
        converged: true,
        scoreHistory: [85],
        finalScore: 85,
        iterations: 2,
        coverage: 70,
      };
      const output = formatQualityResult(result);
      expect(output).toContain("70%");
    });

    it("should handle low security score", () => {
      const result: CocoQualityResult = {
        converged: true,
        scoreHistory: [80],
        finalScore: 80,
        iterations: 1,
        securityScore: 50,
      };
      const output = formatQualityResult(result);
      expect(output).toContain("50");
    });
  });

  describe("loadCocoModePreference", () => {
    it("should load true from config", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ cocoMode: true }));
      const result = await loadCocoModePreference();
      expect(result).toBe(true);
      expect(isCocoMode()).toBe(true);
    });

    it("should load false from config", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ cocoMode: false }));
      const result = await loadCocoModePreference();
      expect(result).toBe(false);
    });

    it("should return false on read error", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const result = await loadCocoModePreference();
      expect(result).toBe(false);
    });

    it("should return false when cocoMode not in config", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ otherSetting: true }));
      const result = await loadCocoModePreference();
      expect(result).toBe(false);
    });
  });

  describe("saveCocoModePreference", () => {
    it("should save preference to config", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ existing: "value" }));
      mockWriteFile.mockResolvedValue(undefined);
      await saveCocoModePreference(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"cocoMode": true'),
      );
    });

    it("should create new config if file does not exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockResolvedValue(undefined);
      await saveCocoModePreference(false);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"cocoMode": false'),
      );
    });

    it("should not throw on write error", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockRejectedValue(new Error("EACCES"));
      await expect(saveCocoModePreference(true)).resolves.toBeUndefined();
    });
  });

  describe("getCocoModeSystemPrompt", () => {
    it("should return system prompt string", () => {
      const prompt = getCocoModeSystemPrompt();
      expect(prompt).toContain("COCO Quality Mode");
      expect(prompt).toContain("COCO_QUALITY_REPORT");
      expect(prompt).toContain("score_history");
      expect(prompt).toContain("12 quality dimensions");
    });
  });
});
