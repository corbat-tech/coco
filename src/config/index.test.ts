/**
 * Tests for config module exports
 */

import { describe, it, expect } from "vitest";
import * as ConfigExports from "./index.js";

describe("Config module exports", () => {
  describe("loader functions", () => {
    it("should export loadConfig", () => {
      expect(ConfigExports.loadConfig).toBeDefined();
      expect(typeof ConfigExports.loadConfig).toBe("function");
    });

    it("should export saveConfig", () => {
      expect(ConfigExports.saveConfig).toBeDefined();
      expect(typeof ConfigExports.saveConfig).toBe("function");
    });

    it("should export createDefaultConfig", () => {
      expect(ConfigExports.createDefaultConfig).toBeDefined();
      expect(typeof ConfigExports.createDefaultConfig).toBe("function");
    });

    it("should export configExists", () => {
      expect(ConfigExports.configExists).toBeDefined();
      expect(typeof ConfigExports.configExists).toBe("function");
    });

    it("should export getConfigValue", () => {
      expect(ConfigExports.getConfigValue).toBeDefined();
      expect(typeof ConfigExports.getConfigValue).toBe("function");
    });

    it("should export setConfigValue", () => {
      expect(ConfigExports.setConfigValue).toBeDefined();
      expect(typeof ConfigExports.setConfigValue).toBe("function");
    });

    it("should export mergeWithDefaults", () => {
      expect(ConfigExports.mergeWithDefaults).toBeDefined();
      expect(typeof ConfigExports.mergeWithDefaults).toBe("function");
    });

    it("should export findConfigPath", () => {
      expect(ConfigExports.findConfigPath).toBeDefined();
      expect(typeof ConfigExports.findConfigPath).toBe("function");
    });
  });

  describe("createDefaultConfig", () => {
    it("should create a valid default configuration", () => {
      const config = ConfigExports.createDefaultConfig();

      expect(config).toBeDefined();
      expect(config.provider).toBeDefined();
      expect(config.quality).toBeDefined();
      expect(config.persistence).toBeDefined();
    });

    it("should have default provider settings", () => {
      const config = ConfigExports.createDefaultConfig();

      expect(config.provider.type).toBe("anthropic");
      expect(config.provider.model).toBeDefined();
    });

    it("should have default quality settings", () => {
      const config = ConfigExports.createDefaultConfig();

      expect(config.quality.minScore).toBeGreaterThan(0);
      expect(config.quality.maxIterations).toBeGreaterThan(0);
      expect(config.quality.convergenceThreshold).toBeGreaterThan(0);
    });
  });

  describe("mergeWithDefaults", () => {
    it("should merge partial config with defaults", () => {
      const partial = {
        provider: {
          model: "custom-model",
        },
      };

      const merged = ConfigExports.mergeWithDefaults(partial);

      expect(merged.provider.model).toBe("custom-model");
      expect(merged.provider.type).toBe("anthropic");
      expect(merged.quality).toBeDefined();
    });

    it("should preserve all provided values", () => {
      const partial = {
        quality: {
          minimumScore: 90,
          maxIterations: 5,
          convergenceThreshold: 1,
          testCoverage: 85,
        },
      };

      const merged = ConfigExports.mergeWithDefaults(partial);

      expect(merged.quality.minimumScore).toBe(90);
      expect(merged.quality.maxIterations).toBe(5);
    });
  });

  describe("getConfigValue and setConfigValue", () => {
    it("should get nested config values", () => {
      const config = ConfigExports.createDefaultConfig();
      const value = ConfigExports.getConfigValue(config, "provider.type");

      expect(value).toBe("anthropic");
    });

    it("should set nested config values", () => {
      const config = ConfigExports.createDefaultConfig();
      const updated = ConfigExports.setConfigValue(config, "provider.model", "new-model");

      expect(updated.provider.model).toBe("new-model");
    });

    it("should return undefined for non-existent paths", () => {
      const config = ConfigExports.createDefaultConfig();
      const value = ConfigExports.getConfigValue(config, "nonexistent.path");

      expect(value).toBeUndefined();
    });
  });
});
