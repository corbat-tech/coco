/**
 * Tests for spinner
 *
 * Note: The spinner uses Ora internally, which manages its own output.
 * These tests focus on the public API behavior rather than stdout output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSpinner } from "./spinner.js";

// Mock ora
vi.mock("ora", () => {
  const mockOra = {
    text: "",
    start: vi.fn(function (this: typeof mockOra) {
      return this;
    }),
    stop: vi.fn(function (this: typeof mockOra) {
      return this;
    }),
    succeed: vi.fn(function (this: typeof mockOra, text?: string) {
      this.text = text || this.text;
      return this;
    }),
    fail: vi.fn(function (this: typeof mockOra, text?: string) {
      this.text = text || this.text;
      return this;
    }),
  };

  return {
    default: vi.fn(() => ({ ...mockOra })),
  };
});

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => `[dim]${s}[/dim]`,
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
    green: (s: string) => `[green]${s}[/green]`,
    red: (s: string) => `[red]${s}[/red]`,
  },
}));

describe("createSpinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("creation", () => {
    it("should create a spinner with all methods", () => {
      const spinner = createSpinner("Loading...");

      expect(spinner).toBeDefined();
      expect(spinner.start).toBeInstanceOf(Function);
      expect(spinner.stop).toBeInstanceOf(Function);
      expect(spinner.clear).toBeInstanceOf(Function);
      expect(spinner.update).toBeInstanceOf(Function);
      expect(spinner.fail).toBeInstanceOf(Function);
      expect(spinner.setToolCount).toBeInstanceOf(Function);
    });
  });

  describe("start", () => {
    it("should start without throwing", () => {
      const spinner = createSpinner("Loading...");

      expect(() => spinner.start()).not.toThrow();

      spinner.stop();
    });

    it("should not throw when started twice", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.start()).not.toThrow();

      spinner.stop();
    });
  });

  describe("stop", () => {
    it("should stop without throwing", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.stop()).not.toThrow();
    });

    it("should accept a final message", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.stop("Done!")).not.toThrow();
    });

    it("should handle stop without start", () => {
      const spinner = createSpinner("Loading...");

      expect(() => spinner.stop()).not.toThrow();
    });
  });

  describe("clear", () => {
    it("should clear without throwing", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.clear()).not.toThrow();
    });

    it("should handle clear without start", () => {
      const spinner = createSpinner("Loading...");

      expect(() => spinner.clear()).not.toThrow();
    });
  });

  describe("update", () => {
    it("should update without throwing", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.update("Processing...")).not.toThrow();

      spinner.stop();
    });

    it("should handle update without start", () => {
      const spinner = createSpinner("Loading...");

      expect(() => spinner.update("New message")).not.toThrow();
    });
  });

  describe("fail", () => {
    it("should fail without throwing", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.fail()).not.toThrow();
    });

    it("should accept a failure message", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.fail("Failed to load")).not.toThrow();
    });

    it("should handle fail without start", () => {
      const spinner = createSpinner("Loading...");

      expect(() => spinner.fail()).not.toThrow();
    });
  });

  describe("setToolCount", () => {
    it("should set tool count without throwing", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      expect(() => spinner.setToolCount(1)).not.toThrow();
      expect(() => spinner.setToolCount(2, 5)).not.toThrow();

      spinner.stop();
    });

    it("should handle setToolCount without start", () => {
      const spinner = createSpinner("Loading...");

      expect(() => spinner.setToolCount(1, 3)).not.toThrow();
    });
  });

  describe("elapsed time", () => {
    it("should handle time passing", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(5000);
      expect(() => spinner.stop()).not.toThrow();
    });
  });

  describe("tool count formatting", () => {
    it("should work with various tool counts", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();

      // No tool count
      spinner.setToolCount(0);
      vi.advanceTimersByTime(100);

      // Single tool
      spinner.setToolCount(1);
      vi.advanceTimersByTime(100);

      // Multiple tools with total
      spinner.setToolCount(2, 5);
      vi.advanceTimersByTime(100);

      // Multiple tools without total
      spinner.setToolCount(3);
      vi.advanceTimersByTime(100);

      expect(() => spinner.stop()).not.toThrow();
    });
  });
});
