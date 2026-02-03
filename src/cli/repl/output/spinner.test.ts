/**
 * Tests for spinner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSpinner } from "./spinner.js";

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
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("creation", () => {
    it("should create a spinner with initial message", () => {
      const spinner = createSpinner("Loading...");

      expect(spinner).toBeDefined();
      expect(spinner.start).toBeDefined();
      expect(spinner.stop).toBeDefined();
      expect(spinner.update).toBeDefined();
      expect(spinner.fail).toBeDefined();
    });
  });

  describe("start", () => {
    it("should start animating", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(120); // 120ms interval (performance optimized)

      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls[0][0];
      expect(output).toContain("Loading...");

      spinner.stop();
    });

    it("should cycle through frames", () => {
      const spinner = createSpinner("Working...");

      spinner.start();
      vi.advanceTimersByTime(120 * 3); // Advance through 3 frames

      expect(stdoutWriteSpy.mock.calls.length).toBeGreaterThan(1);

      spinner.stop();
    });

    it("should not start twice", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      const callCount1 = stdoutWriteSpy.mock.calls.length;

      vi.advanceTimersByTime(120);
      spinner.start(); // Try to start again

      vi.advanceTimersByTime(120);
      // Should have advanced normally, not doubled
      expect(stdoutWriteSpy.mock.calls.length).toBe(callCount1 + 2);

      spinner.stop();
    });

    it("should show elapsed time after 1 second", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(1100); // Just over 1 second

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("1s");

      spinner.stop();
    });
  });

  describe("stop", () => {
    it("should stop animation and show success", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(80);

      spinner.stop();

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("[green]✓[/green]");
      expect(lastCall).toContain("Loading...");
    });

    it("should use final message if provided", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      spinner.stop("Done!");

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("Done!");
    });

    it("should show elapsed time", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(2000); // 2 seconds
      spinner.stop();

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("2s");
    });

    it("should not show elapsed time if less than 1 second", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(500);
      spinner.stop();

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain("[dim]");
    });
  });

  describe("update", () => {
    it("should update the message", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(80);

      spinner.update("Processing...");
      vi.advanceTimersByTime(80);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("Processing...");

      spinner.stop();
    });
  });

  describe("fail", () => {
    it("should stop animation and show failure", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(80);

      spinner.fail();

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("[red]✗[/red]");
    });

    it("should use failure message if provided", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      spinner.fail("Failed to load");

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("Failed to load");
    });

    it("should show elapsed time on failure", () => {
      const spinner = createSpinner("Loading...");

      spinner.start();
      vi.advanceTimersByTime(3000);
      spinner.fail();

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("3s");
    });
  });

  describe("edge cases", () => {
    it("should handle stop without start", () => {
      const spinner = createSpinner("Loading...");

      // Should not throw
      expect(() => spinner.stop()).not.toThrow();
    });

    it("should handle fail without start", () => {
      const spinner = createSpinner("Loading...");

      // Should not throw
      expect(() => spinner.fail()).not.toThrow();
    });

    it("should handle update without start", () => {
      const spinner = createSpinner("Loading...");

      // Should not throw
      expect(() => spinner.update("New message")).not.toThrow();
    });
  });
});
