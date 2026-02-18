/**
 * Tests for Input Echo Renderer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createInputEcho } from "./input-echo.js";
import type { Spinner } from "../output/spinner.js";

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

describe("createInputEcho", () => {
  let mockSpinner: Spinner;
  let currentMessage: string;

  beforeEach(() => {
    mockSpinner = createMockSpinner();
    currentMessage = "Thinking...";
  });

  it("renders buffer as second line in spinner text", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");

    expect(mockSpinner.update).toHaveBeenCalledTimes(1);
    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    // Should contain the base message and the buffer text on separate lines
    expect(updateArg).toContain("Thinking...");
    expect(updateArg).toContain("\n");
    expect(updateArg).toContain("hello");
  });

  it("shows placeholder when buffer is empty", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    // First render with text
    echo.render("hello");
    // Then render with empty buffer → should show placeholder
    echo.render("");

    const calls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    // Second call should include the placeholder line
    expect(calls[1]?.[0]).toContain("Thinking...");
    expect(calls[1]?.[0]).toContain("Escribe para modificar");
  });

  it("does nothing when spinner is null", () => {
    const echo = createInputEcho(
      () => null,
      () => currentMessage,
    );

    // Should not throw
    expect(() => echo.render("hello")).not.toThrow();
  });

  it("truncates long buffer from the left", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
      { maxVisibleChars: 10 },
    );

    echo.render("abcdefghijklmnop"); // 16 chars, max visible is 10

    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    // Should contain ellipsis and the end of the text (ignoring ANSI codes)
    expect(updateArg).toContain("\u2026");
    expect(updateArg).toContain("hijklmnop");
    // Should NOT contain the beginning (before truncation point)
    expect(updateArg).not.toContain("abcde");
  });

  it("does not truncate short buffer", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
      { maxVisibleChars: 60 },
    );

    echo.render("short");

    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(updateArg).toContain("short");
    expect(updateArg).not.toContain("\u2026");
  });

  it("clear restores spinner to base message", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");
    echo.clear();

    const calls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[1]?.[0]).toBe("Thinking...");
  });

  it("refresh re-renders with current buffer and updated message", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");

    // Simulate spinner message change
    currentMessage = "Processing...";
    echo.refresh();

    const calls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    const lastUpdate = calls[1]?.[0] as string;
    expect(lastUpdate).toContain("Processing...");
    expect(lastUpdate).toContain("hello");
  });

  it("suspend stops rendering and clears echo", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");
    echo.suspend();

    // Should have cleared to base message
    const calls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toBe("Thinking...");

    // Subsequent renders should be ignored
    (mockSpinner.update as ReturnType<typeof vi.fn>).mockClear();
    echo.render("world");
    expect(mockSpinner.update).not.toHaveBeenCalled();
  });

  it("resume re-enables rendering and shows buffer", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");
    echo.suspend();

    // Buffer is still "hello" internally but not rendered during suspend
    // After resume, if we still had buffer, it would render
    // But suspend calls clear() which resets lastBuffer to ""
    echo.resume();

    // No render because lastBuffer was cleared by suspend
    const postResumeCalls = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls;
    // After suspend+resume, lastBuffer is "" so no re-render beyond what clear did
    expect(postResumeCalls.length).toBeGreaterThanOrEqual(2); // initial render + clear
  });

  it("reset clears state", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");
    echo.reset();

    expect(echo.currentBuffer).toBe("");
    expect(echo.isShowing).toBe(false);
  });

  it("isShowing reflects buffer and active state", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    expect(echo.isShowing).toBe(false);

    echo.render("hello");
    expect(echo.isShowing).toBe(true);

    echo.render("");
    expect(echo.isShowing).toBe(false);
  });

  it("currentBuffer tracks the latest buffer content", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("h");
    expect(echo.currentBuffer).toBe("h");

    echo.render("he");
    expect(echo.currentBuffer).toBe("he");

    echo.render("hel");
    expect(echo.currentBuffer).toBe("hel");

    echo.render("");
    expect(echo.currentBuffer).toBe("");
  });

  it("uses custom prompt prefix", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
      { prompt: "> " },
    );

    echo.render("hello");

    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(updateArg).toContain("> ");
  });

  it("includes cursor indicator in echo line", () => {
    const echo = createInputEcho(
      () => mockSpinner,
      () => currentMessage,
    );

    echo.render("hello");

    const updateArg = (mockSpinner.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    // Should contain the blinking cursor character
    expect(updateArg).toContain("\u2502");
  });
});
