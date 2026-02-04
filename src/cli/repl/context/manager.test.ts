/**
 * Tests for ContextManager
 */

import { describe, it, expect, beforeEach } from "vitest";

describe("ContextManager", () => {
  beforeEach(async () => {
    // Reset modules to ensure clean state
  });

  describe("constructor", () => {
    it("should create with default config", async () => {
      const { ContextManager, DEFAULT_CONTEXT_CONFIG } = await import(
        "./manager.js"
      );

      const manager = new ContextManager();
      const config = manager.getConfig();

      expect(config.maxTokens).toBe(DEFAULT_CONTEXT_CONFIG.maxTokens);
      expect(config.compactionThreshold).toBe(
        DEFAULT_CONTEXT_CONFIG.compactionThreshold
      );
      expect(config.reservedTokens).toBe(DEFAULT_CONTEXT_CONFIG.reservedTokens);
    });

    it("should create with custom config", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 100000,
        compactionThreshold: 0.7,
        reservedTokens: 2048,
      });

      const config = manager.getConfig();
      expect(config.maxTokens).toBe(100000);
      expect(config.compactionThreshold).toBe(0.7);
      expect(config.reservedTokens).toBe(2048);
    });

    it("should merge partial config with defaults", async () => {
      const { ContextManager, DEFAULT_CONTEXT_CONFIG } = await import(
        "./manager.js"
      );

      const manager = new ContextManager({
        maxTokens: 50000,
      });

      const config = manager.getConfig();
      expect(config.maxTokens).toBe(50000);
      expect(config.compactionThreshold).toBe(
        DEFAULT_CONTEXT_CONFIG.compactionThreshold
      );
    });
  });

  describe("addTokens", () => {
    it("should add tokens to usage", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();
      manager.addTokens(1000);

      expect(manager.getUsedTokens()).toBe(1000);
    });

    it("should accumulate token additions", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();
      manager.addTokens(1000);
      manager.addTokens(500);
      manager.addTokens(250);

      expect(manager.getUsedTokens()).toBe(1750);
    });

    it("should throw error for negative token count", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();

      expect(() => manager.addTokens(-100)).toThrow(
        "Token count cannot be negative"
      );
    });
  });

  describe("removeTokens", () => {
    it("should remove tokens from usage", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();
      manager.addTokens(1000);
      manager.removeTokens(300);

      expect(manager.getUsedTokens()).toBe(700);
    });

    it("should not go below zero", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();
      manager.addTokens(100);
      manager.removeTokens(500);

      expect(manager.getUsedTokens()).toBe(0);
    });

    it("should throw error for negative token count", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();

      expect(() => manager.removeTokens(-100)).toThrow(
        "Token count cannot be negative"
      );
    });
  });

  describe("setUsedTokens", () => {
    it("should set used tokens directly", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();
      manager.setUsedTokens(5000);

      expect(manager.getUsedTokens()).toBe(5000);
    });

    it("should throw error for negative value", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();

      expect(() => manager.setUsedTokens(-100)).toThrow(
        "Token count cannot be negative"
      );
    });
  });

  describe("getUsagePercent", () => {
    it("should calculate usage percentage correctly", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 0,
      });
      manager.addTokens(5000);

      expect(manager.getUsagePercent()).toBe(50);
    });

    it("should account for reserved tokens", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 2000, // Effective max is 8000
      });
      manager.addTokens(4000);

      // 4000 / 8000 = 50%
      expect(manager.getUsagePercent()).toBe(50);
    });

    it("should cap at 100%", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 0,
      });
      manager.addTokens(15000); // Over capacity

      expect(manager.getUsagePercent()).toBe(100);
    });

    it("should return 100% when effective max is zero or negative", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 1000,
        reservedTokens: 1000, // Effective max is 0
      });

      expect(manager.getUsagePercent()).toBe(100);
    });
  });

  describe("getAvailableTokens", () => {
    it("should calculate available tokens", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 1000,
      });
      manager.addTokens(3000);

      // Effective max: 9000, Used: 3000, Available: 6000
      expect(manager.getAvailableTokens()).toBe(6000);
    });

    it("should not return negative available tokens", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 1000,
      });
      manager.addTokens(15000); // Over capacity

      expect(manager.getAvailableTokens()).toBe(0);
    });
  });

  describe("shouldCompact", () => {
    it("should return true when threshold is exceeded", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 0,
        compactionThreshold: 0.8, // 80%
      });
      manager.addTokens(8500); // 85%

      expect(manager.shouldCompact()).toBe(true);
    });

    it("should return false when below threshold", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 0,
        compactionThreshold: 0.8,
      });
      manager.addTokens(7000); // 70%

      expect(manager.shouldCompact()).toBe(false);
    });

    it("should return true when exactly at threshold", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 0,
        compactionThreshold: 0.8,
      });
      manager.addTokens(8000); // Exactly 80%

      expect(manager.shouldCompact()).toBe(true);
    });
  });

  describe("getUsageStats", () => {
    it("should return complete usage statistics", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 100000,
        reservedTokens: 4096,
        compactionThreshold: 0.8,
      });
      manager.addTokens(50000);

      const stats = manager.getUsageStats();

      expect(stats.used).toBe(50000);
      expect(stats.total).toBe(95904); // 100000 - 4096
      expect(stats.available).toBe(45904); // 95904 - 50000
      expect(stats.percentage).toBeCloseTo(52.13, 1);
      expect(stats.shouldCompact).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset token counter to zero", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager();
      manager.addTokens(10000);
      manager.reset();

      expect(manager.getUsedTokens()).toBe(0);
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 100000,
      });

      manager.updateConfig({
        maxTokens: 200000,
        compactionThreshold: 0.9,
      });

      const config = manager.getConfig();
      expect(config.maxTokens).toBe(200000);
      expect(config.compactionThreshold).toBe(0.9);
    });

    it("should preserve non-updated config values", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 100000,
        compactionThreshold: 0.7,
        reservedTokens: 2048,
      });

      manager.updateConfig({
        maxTokens: 150000,
      });

      const config = manager.getConfig();
      expect(config.maxTokens).toBe(150000);
      expect(config.compactionThreshold).toBe(0.7);
      expect(config.reservedTokens).toBe(2048);
    });
  });

  describe("formatUsage", () => {
    it("should format usage as human-readable string", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 100000,
        reservedTokens: 4096,
      });
      manager.addTokens(50000);

      const formatted = manager.formatUsage();

      expect(formatted).toContain("50.0k");
      expect(formatted).toContain("95.9k");
      expect(formatted).toContain("tokens");
      expect(formatted).toContain("%");
    });

    it("should handle small token counts", async () => {
      const { ContextManager } = await import("./manager.js");

      const manager = new ContextManager({
        maxTokens: 10000,
        reservedTokens: 0,
      });
      manager.addTokens(500);

      const formatted = manager.formatUsage();

      expect(formatted).toContain("0.5k");
      expect(formatted).toContain("10.0k");
    });
  });
});

describe("createContextManager", () => {
  it("should create context manager with maxTokens", async () => {
    const { createContextManager } = await import("./manager.js");

    const manager = createContextManager(128000);

    const config = manager.getConfig();
    expect(config.maxTokens).toBe(128000);
  });

  it("should create context manager with additional config", async () => {
    const { createContextManager } = await import("./manager.js");

    const manager = createContextManager(128000, {
      compactionThreshold: 0.75,
      reservedTokens: 8192,
    });

    const config = manager.getConfig();
    expect(config.maxTokens).toBe(128000);
    expect(config.compactionThreshold).toBe(0.75);
    expect(config.reservedTokens).toBe(8192);
  });
});
