/**
 * Tests for utils module exports
 */

import { describe, it, expect } from "vitest";
import * as UtilsExports from "./index.js";

describe("Utils module exports", () => {
  describe("logger", () => {
    it("should export createLogger", () => {
      expect(UtilsExports.createLogger).toBeDefined();
      expect(typeof UtilsExports.createLogger).toBe("function");
    });

    it("should export createChildLogger", () => {
      expect(UtilsExports.createChildLogger).toBeDefined();
      expect(typeof UtilsExports.createChildLogger).toBe("function");
    });

    it("should export getLogger", () => {
      expect(UtilsExports.getLogger).toBeDefined();
      expect(typeof UtilsExports.getLogger).toBe("function");
    });

    it("should export setLogger", () => {
      expect(UtilsExports.setLogger).toBeDefined();
      expect(typeof UtilsExports.setLogger).toBe("function");
    });

    it("should export initializeLogging", () => {
      expect(UtilsExports.initializeLogging).toBeDefined();
      expect(typeof UtilsExports.initializeLogging).toBe("function");
    });

    it("should export logEvent", () => {
      expect(UtilsExports.logEvent).toBeDefined();
      expect(typeof UtilsExports.logEvent).toBe("function");
    });

    it("should export logTiming", () => {
      expect(UtilsExports.logTiming).toBeDefined();
      expect(typeof UtilsExports.logTiming).toBe("function");
    });
  });

  describe("errors", () => {
    it("should export CocoError", () => {
      expect(UtilsExports.CocoError).toBeDefined();
    });

    it("should export ConfigError", () => {
      expect(UtilsExports.ConfigError).toBeDefined();
    });

    it("should export FileSystemError", () => {
      expect(UtilsExports.FileSystemError).toBeDefined();
    });

    it("should export ProviderError", () => {
      expect(UtilsExports.ProviderError).toBeDefined();
    });

    it("should export ValidationError", () => {
      expect(UtilsExports.ValidationError).toBeDefined();
    });

    it("should export PhaseError", () => {
      expect(UtilsExports.PhaseError).toBeDefined();
    });

    it("should export TaskError", () => {
      expect(UtilsExports.TaskError).toBeDefined();
    });

    it("should export QualityError", () => {
      expect(UtilsExports.QualityError).toBeDefined();
    });

    it("should export RecoveryError", () => {
      expect(UtilsExports.RecoveryError).toBeDefined();
    });

    it("should export ToolError", () => {
      expect(UtilsExports.ToolError).toBeDefined();
    });

    it("should export TimeoutError", () => {
      expect(UtilsExports.TimeoutError).toBeDefined();
    });

    it("should export isCocoError", () => {
      expect(UtilsExports.isCocoError).toBeDefined();
      expect(typeof UtilsExports.isCocoError).toBe("function");
    });

    it("should export formatError", () => {
      expect(UtilsExports.formatError).toBeDefined();
      expect(typeof UtilsExports.formatError).toBe("function");
    });

    it("should export withErrorHandling", () => {
      expect(UtilsExports.withErrorHandling).toBeDefined();
      expect(typeof UtilsExports.withErrorHandling).toBe("function");
    });

    it("should export withRetry", () => {
      expect(UtilsExports.withRetry).toBeDefined();
      expect(typeof UtilsExports.withRetry).toBe("function");
    });
  });

  describe("validation", () => {
    it("should export validate", () => {
      expect(UtilsExports.validate).toBeDefined();
      expect(typeof UtilsExports.validate).toBe("function");
    });

    it("should export safeValidate", () => {
      expect(UtilsExports.safeValidate).toBeDefined();
      expect(typeof UtilsExports.safeValidate).toBe("function");
    });

    it("should export CommonSchemas", () => {
      expect(UtilsExports.CommonSchemas).toBeDefined();
    });

    it("should export createIdGenerator", () => {
      expect(UtilsExports.createIdGenerator).toBeDefined();
      expect(typeof UtilsExports.createIdGenerator).toBe("function");
    });

    it("should export assertDefined", () => {
      expect(UtilsExports.assertDefined).toBeDefined();
      expect(typeof UtilsExports.assertDefined).toBe("function");
    });

    it("should export assert", () => {
      expect(UtilsExports.assert).toBeDefined();
      expect(typeof UtilsExports.assert).toBe("function");
    });

    it("should export coerce", () => {
      expect(UtilsExports.coerce).toBeDefined();
      expect(typeof UtilsExports.coerce).toBe("function");
    });

    it("should export validateFileExtension", () => {
      expect(UtilsExports.validateFileExtension).toBeDefined();
      expect(typeof UtilsExports.validateFileExtension).toBe("function");
    });

    it("should export isValidJson", () => {
      expect(UtilsExports.isValidJson).toBeDefined();
      expect(typeof UtilsExports.isValidJson).toBe("function");
    });

    it("should export parseJsonSafe", () => {
      expect(UtilsExports.parseJsonSafe).toBeDefined();
      expect(typeof UtilsExports.parseJsonSafe).toBe("function");
    });
  });

  describe("async utilities", () => {
    it("should export sleep", () => {
      expect(UtilsExports.sleep).toBeDefined();
      expect(typeof UtilsExports.sleep).toBe("function");
    });

    it("should export timeout", () => {
      expect(UtilsExports.timeout).toBeDefined();
      expect(typeof UtilsExports.timeout).toBe("function");
    });

    it("should export debounce", () => {
      expect(UtilsExports.debounce).toBeDefined();
      expect(typeof UtilsExports.debounce).toBe("function");
    });

    it("should export throttle", () => {
      expect(UtilsExports.throttle).toBeDefined();
      expect(typeof UtilsExports.throttle).toBe("function");
    });

    it("should export retry", () => {
      expect(UtilsExports.retry).toBeDefined();
      expect(typeof UtilsExports.retry).toBe("function");
    });

    it("should export parallel", () => {
      expect(UtilsExports.parallel).toBeDefined();
      expect(typeof UtilsExports.parallel).toBe("function");
    });

    it("should export sequential", () => {
      expect(UtilsExports.sequential).toBeDefined();
      expect(typeof UtilsExports.sequential).toBe("function");
    });
  });

  describe("string utilities", () => {
    it("should export truncate", () => {
      expect(UtilsExports.truncate).toBeDefined();
      expect(typeof UtilsExports.truncate).toBe("function");
    });

    it("should export slugify", () => {
      expect(UtilsExports.slugify).toBeDefined();
      expect(typeof UtilsExports.slugify).toBe("function");
    });

    it("should export capitalize", () => {
      expect(UtilsExports.capitalize).toBeDefined();
      expect(typeof UtilsExports.capitalize).toBe("function");
    });

    it("should export camelToKebab", () => {
      expect(UtilsExports.camelToKebab).toBeDefined();
      expect(typeof UtilsExports.camelToKebab).toBe("function");
    });

    it("should export kebabToCamel", () => {
      expect(UtilsExports.kebabToCamel).toBeDefined();
      expect(typeof UtilsExports.kebabToCamel).toBe("function");
    });

    it("should export indent", () => {
      expect(UtilsExports.indent).toBeDefined();
      expect(typeof UtilsExports.indent).toBe("function");
    });

    it("should export dedent", () => {
      expect(UtilsExports.dedent).toBeDefined();
      expect(typeof UtilsExports.dedent).toBe("function");
    });

    it("should export pluralize", () => {
      expect(UtilsExports.pluralize).toBeDefined();
      expect(typeof UtilsExports.pluralize).toBe("function");
    });
  });

  describe("file utilities", () => {
    it("should export ensureDir", () => {
      expect(UtilsExports.ensureDir).toBeDefined();
      expect(typeof UtilsExports.ensureDir).toBe("function");
    });

    it("should export fileExists", () => {
      expect(UtilsExports.fileExists).toBeDefined();
      expect(typeof UtilsExports.fileExists).toBe("function");
    });

    it("should export readJsonFile", () => {
      expect(UtilsExports.readJsonFile).toBeDefined();
      expect(typeof UtilsExports.readJsonFile).toBe("function");
    });

    it("should export writeJsonFile", () => {
      expect(UtilsExports.writeJsonFile).toBeDefined();
      expect(typeof UtilsExports.writeJsonFile).toBe("function");
    });

    it("should export copyFile", () => {
      expect(UtilsExports.copyFile).toBeDefined();
      expect(typeof UtilsExports.copyFile).toBe("function");
    });

    it("should export removeFile", () => {
      expect(UtilsExports.removeFile).toBeDefined();
      expect(typeof UtilsExports.removeFile).toBe("function");
    });

    it("should export getFileHash", () => {
      expect(UtilsExports.getFileHash).toBeDefined();
      expect(typeof UtilsExports.getFileHash).toBe("function");
    });
  });
});

describe("Utils integration", () => {
  describe("error creation and checking", () => {
    it("should create and check CocoError", () => {
      const error = new UtilsExports.CocoError("Test", { code: "TEST" });
      expect(UtilsExports.isCocoError(error)).toBe(true);
    });

    it("should format errors correctly", () => {
      const error = new UtilsExports.ConfigError("Invalid config");
      const formatted = UtilsExports.formatError(error);
      expect(formatted).toContain("Invalid config");
    });
  });

  describe("string utilities work correctly", () => {
    it("should truncate strings", () => {
      const result = UtilsExports.truncate("Hello World", 5);
      expect(result.length).toBeLessThanOrEqual(8); // 5 + "..."
    });

    it("should slugify strings", () => {
      const result = UtilsExports.slugify("Hello World!");
      expect(result).toBe("hello-world");
    });

    it("should capitalize strings", () => {
      const result = UtilsExports.capitalize("hello");
      expect(result).toBe("Hello");
    });
  });

  describe("validation utilities work correctly", () => {
    it("should validate with assert", () => {
      expect(() => UtilsExports.assert(true, "Should pass")).not.toThrow();
      expect(() => UtilsExports.assert(false, "Should fail")).toThrow();
    });

    it("should validate JSON", () => {
      expect(UtilsExports.isValidJson('{"key": "value"}')).toBe(true);
      expect(UtilsExports.isValidJson("invalid")).toBe(false);
    });

    it("should parse JSON safely", () => {
      const result = UtilsExports.parseJsonSafe('{"key": "value"}');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key: "value" });
      }

      const invalid = UtilsExports.parseJsonSafe("invalid");
      expect(invalid.success).toBe(false);
    });
  });
});
