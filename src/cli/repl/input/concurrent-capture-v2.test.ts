/**
 * Tests for ConcurrentCapture v2
 *
 * Since this module interacts heavily with process.stdin (TTY),
 * we test the internal logic via the public API by mocking stdin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createConcurrentCapture } from "./concurrent-capture-v2.js";
import type { QueuedMessage } from "./types.js";

/**
 * Helper to simulate stdin data events.
 * We capture the 'data' event handler registered by the capture system.
 */
function getDataHandler(): ((data: Buffer) => void) | undefined {
  const calls = (process.stdin.on as ReturnType<typeof vi.fn>).mock.calls;
  for (const call of calls) {
    if (call[0] === "data") return call[1] as (data: Buffer) => void;
  }
  return undefined;
}

function sendData(handler: (data: Buffer) => void, text: string): void {
  handler(Buffer.from(text, "utf-8"));
}

describe("createConcurrentCapture", () => {
  beforeEach(() => {
    // Mock stdin TTY methods
    vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "removeListener").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);

    // Mock isTTY and setRawMode — in test environment stdin is not a TTY
    // so setRawMode doesn't exist. We need to add it as a mock function.
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    if (!process.stdin.setRawMode) {
      (process.stdin as unknown as Record<string, unknown>).setRawMode = vi.fn().mockReturnValue(process.stdin);
    } else {
      vi.spyOn(process.stdin, "setRawMode").mockReturnValue(process.stdin);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up the mock setRawMode if we added it
    if (!(process.stdin as unknown as Record<string, unknown>)._originalSetRawMode) {
      delete (process.stdin as unknown as Record<string, unknown>).setRawMode;
    }
  });

  it("starts in idle state", () => {
    const capture = createConcurrentCapture();
    expect(capture.state).toBe("idle");
    expect(capture.hasMessages).toBe(false);
  });

  it("transitions to capturing state on start", () => {
    const capture = createConcurrentCapture();
    capture.start();
    expect(capture.state).toBe("capturing");
    capture.stop();
  });

  it("enables raw mode on start", () => {
    const capture = createConcurrentCapture();
    capture.start();
    expect(process.stdin.setRawMode).toHaveBeenCalledWith(true);
    capture.stop();
  });

  it("disables raw mode on stop", () => {
    const capture = createConcurrentCapture();
    capture.start();
    capture.stop();
    expect(process.stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("transitions to stopped state on stop", () => {
    const capture = createConcurrentCapture();
    capture.start();
    capture.stop();
    expect(capture.state).toBe("stopped");
  });

  it("captures a line when Enter is received", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler();
    expect(handler).toBeDefined();

    sendData(handler!, "hello\r");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toBe("hello");
    expect(capture.hasMessages).toBe(true);

    capture.stop();
  });

  it("handles LF (newline) as line terminator", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    sendData(handler, "world\n");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toBe("world");
    capture.stop();
  });

  it("ignores empty lines (whitespace only)", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    sendData(handler, "   \r");

    expect(captured).toHaveLength(0);
    capture.stop();
  });

  it("handles backspace correctly", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    // Type "helloo" then backspace, then Enter
    sendData(handler, "helloo\x7f\r");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toBe("hello");
    capture.stop();
  });

  it("handles Ctrl+U to clear buffer", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    // Type "wrong", Ctrl+U, then type "right", Enter
    sendData(handler, "wrong\x15right\r");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toBe("right");
    capture.stop();
  });

  it("handles Ctrl+W to delete previous word", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    // Type "hello world", Ctrl+W removes "world", Enter
    sendData(handler, "hello world\x17\r");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toBe("hello");
    capture.stop();
  });

  it("captures multiple messages", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    sendData(handler, "first\rsecond\rthird\r");

    expect(captured).toHaveLength(3);
    expect(captured[0]?.text).toBe("first");
    expect(captured[1]?.text).toBe("second");
    expect(captured[2]?.text).toBe("third");
    capture.stop();
  });

  it("stop returns all queued messages", () => {
    const capture = createConcurrentCapture();
    capture.start();

    const handler = getDataHandler()!;
    sendData(handler, "msg1\rmsg2\r");

    const messages = capture.stop();
    expect(messages).toHaveLength(2);
    expect(messages[0]?.text).toBe("msg1");
    expect(messages[1]?.text).toBe("msg2");
  });

  it("ignores data when not in capturing state", () => {
    const capture = createConcurrentCapture();
    capture.start();
    capture.stop();

    // Manually invoke the handler after stop — should be a no-op
    const handler = getDataHandler();
    if (handler) {
      sendData(handler, "should be ignored\r");
    }

    expect(capture.hasMessages).toBe(false);
  });

  it("skips escape sequences", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    // Type "a", then an arrow key (escape sequence), then "b", then Enter
    sendData(handler, "a\x1b[Ab\r");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toBe("ab");
    capture.stop();
  });

  it("does not start twice", () => {
    const capture = createConcurrentCapture();
    capture.start();
    capture.start(); // Should be no-op

    // setRawMode should only have been called once
    expect(process.stdin.setRawMode).toHaveBeenCalledTimes(1);
    capture.stop();
  });

  it("reset returns to idle state", () => {
    const capture = createConcurrentCapture();
    capture.start();
    capture.stop();
    capture.reset();

    expect(capture.state).toBe("idle");
    expect(capture.hasMessages).toBe(false);
    expect(capture.currentBuffer).toBe("");
  });

  it("exposes current buffer content", () => {
    const capture = createConcurrentCapture();
    capture.start();

    const handler = getDataHandler()!;
    sendData(handler, "partial");

    expect(capture.currentBuffer).toBe("partial");
    capture.stop();
  });

  it("trims captured messages", () => {
    const capture = createConcurrentCapture();
    const captured: QueuedMessage[] = [];
    capture.start((msg) => captured.push(msg));

    const handler = getDataHandler()!;
    sendData(handler, "  spaced  \r");

    expect(captured[0]?.text).toBe("spaced");
    capture.stop();
  });

  it("handles backspace on empty buffer gracefully", () => {
    const capture = createConcurrentCapture();
    capture.start();

    const handler = getDataHandler()!;
    // Backspace on empty buffer should not error
    sendData(handler, "\x7f\x7f\x7f");

    expect(capture.currentBuffer).toBe("");
    capture.stop();
  });
});
