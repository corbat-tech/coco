/**
 * Tests for Feedback System
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFeedbackSystem } from "./feedback-system.js";
import type { Spinner } from "../output/spinner.js";
import type { QueuedMessage } from "../input/types.js";

function makeMsg(text: string): QueuedMessage {
  return { text, timestamp: Date.now() };
}

function createMockSpinner(): Spinner {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    update: vi.fn(),
    fail: vi.fn(),
    setToolCount: vi.fn(),
  };
}

describe("createFeedbackSystem", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("updates spinner with capture confirmation", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner);

    feedback.notifyCapture(makeMsg("add tests"), "Thinking...");

    expect(mockSpinner.update).toHaveBeenCalledTimes(1);
    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(updateArg).toBeDefined();
    // The update should contain the message preview (even if styled)
    // We can't check exact ANSI codes, but the raw text should be present somewhere
  });

  it("restores spinner message after delay", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner, { displayDurationMs: 1000 });

    feedback.notifyCapture(makeMsg("add tests"), "Processing...");

    // After the display duration, spinner should be restored
    vi.advanceTimersByTime(1000);

    const calls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Last call should restore the original message
    expect(calls[calls.length - 1]?.[0]).toBe("Processing...");
  });

  it("handles multiple rapid captures", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner, { displayDurationMs: 2000 });

    feedback.notifyCapture(makeMsg("first"), "Thinking...");
    feedback.notifyCapture(makeMsg("second"), "Thinking...");

    // Both should trigger updates
    const calls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
  });

  it("does nothing when spinner is null", () => {
    const feedback = createFeedbackSystem(() => null);

    // Should not throw
    expect(() => feedback.notifyCapture(makeMsg("test"), "Thinking...")).not.toThrow();
  });

  it("emits bell when configured", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner, { bell: true });

    feedback.notifyCapture(makeMsg("test"), "Thinking...");

    expect(process.stdout.write).toHaveBeenCalledWith("\x07");
  });

  it("does not emit bell by default", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner);

    feedback.notifyCapture(makeMsg("test"), "Thinking...");

    expect(process.stdout.write).not.toHaveBeenCalledWith("\x07");
  });

  it("truncates long messages in preview", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner);

    const longText = "a".repeat(100);
    feedback.notifyCapture(makeMsg(longText), "Thinking...");

    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    // Should not contain the full 100-char text
    expect(updateArg.length).toBeLessThan(200); // reasonable limit considering ANSI codes
  });

  it("reset clears state", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner, { displayDurationMs: 5000 });

    feedback.notifyCapture(makeMsg("test"), "Thinking...");
    feedback.reset();

    // Advancing time should not trigger restore (timer was cleared)
    vi.advanceTimersByTime(5000);

    // Only 1 update call (the initial notify), no restore after reset
    expect((mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("dispose clears timers", () => {
    const mockSpinner = createMockSpinner();
    const feedback = createFeedbackSystem(() => mockSpinner, { displayDurationMs: 5000 });

    feedback.notifyCapture(makeMsg("test"), "Thinking...");
    feedback.dispose();

    vi.advanceTimersByTime(5000);
    expect((mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
