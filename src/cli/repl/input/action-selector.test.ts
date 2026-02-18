/**
 * Tests for the inline action selector
 *
 * Mocks process.stdin to simulate keypress events and verifies
 * the correct action is returned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { showActionSelector, mapClassificationToAction } from "./action-selector.js";
import { InterruptionAction, InterruptionType } from "../interruptions/types.js";

/**
 * Helper: simulate a keypress by emitting data on stdin
 */
function simulateKey(key: string, delayMs = 10): void {
  setTimeout(() => {
    const listeners = (process.stdin.on as ReturnType<typeof vi.fn>).mock.calls
      .filter(([event]: [string]) => event === "data")
      .map(([, handler]: [string, (data: Buffer) => void]) => handler);

    for (const handler of listeners) {
      handler(Buffer.from(key, "utf-8"));
    }
  }, delayMs);
}

describe("Action Selector", () => {
  beforeEach(() => {
    vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "removeListener").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    if (!process.stdin.setRawMode) {
      (process.stdin as unknown as Record<string, unknown>).setRawMode = vi.fn().mockReturnValue(process.stdin);
    } else {
      vi.spyOn(process.stdin, "setRawMode").mockReturnValue(process.stdin);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (!(process.stdin as unknown as Record<string, unknown>)._originalSetRawMode) {
      delete (process.stdin as unknown as Record<string, unknown>).setRawMode;
    }
  });

  describe("Number key selection", () => {
    it("should return Modify when pressing 1", async () => {
      simulateKey("1");
      const result = await showActionSelector("test message", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Modify);
      expect(result!.message).toBe("test message");
    });

    it("should return Queue when pressing 2", async () => {
      simulateKey("2");
      const result = await showActionSelector("test message", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Queue);
    });

    it("should return Abort when pressing 3", async () => {
      simulateKey("3");
      const result = await showActionSelector("test message", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Abort);
    });
  });

  describe("Enter key confirmation", () => {
    it("should confirm the pre-selected option on Enter", async () => {
      simulateKey("\r");
      const result = await showActionSelector("test", InterruptionAction.Abort, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Abort);
    });

    it("should confirm Queue pre-selection on Enter", async () => {
      simulateKey("\r");
      const result = await showActionSelector("test", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Queue);
    });
  });

  describe("Escape key dismissal", () => {
    it("should return null on Escape", async () => {
      simulateKey("\x1b");
      const result = await showActionSelector("test", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).toBeNull();
    });
  });

  describe("Ctrl+C mapping", () => {
    it("should return Abort on Ctrl+C", async () => {
      simulateKey("\x03");
      const result = await showActionSelector("test", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Abort);
    });
  });

  describe("Timeout auto-selection", () => {
    it("should auto-select the pre-selected option after timeout", async () => {
      const result = await showActionSelector("test", InterruptionAction.Modify, null, { timeoutMs: 50 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Modify);
    });
  });

  describe("Arrow key navigation", () => {
    it("should move right and confirm with Enter", async () => {
      // Start at Queue (index 1), move right to Abort (index 2), then Enter
      setTimeout(() => {
        const listeners = (process.stdin.on as ReturnType<typeof vi.fn>).mock.calls
          .filter(([event]: [string]) => event === "data")
          .map(([, handler]: [string, (data: Buffer) => void]) => handler);

        // Right arrow
        for (const handler of listeners) {
          handler(Buffer.from("\x1b[C", "utf-8"));
        }

        // Then Enter
        setTimeout(() => {
          for (const handler of listeners) {
            handler(Buffer.from("\r", "utf-8"));
          }
        }, 10);
      }, 10);

      const result = await showActionSelector("test", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Abort);
    });

    it("should move left with wrapping", async () => {
      // Start at Modify (index 0), move left wraps to Abort (index 2), Enter
      setTimeout(() => {
        const listeners = (process.stdin.on as ReturnType<typeof vi.fn>).mock.calls
          .filter(([event]: [string]) => event === "data")
          .map(([, handler]: [string, (data: Buffer) => void]) => handler);

        // Left arrow (wraps from 0 to 2)
        for (const handler of listeners) {
          handler(Buffer.from("\x1b[D", "utf-8"));
        }

        setTimeout(() => {
          for (const handler of listeners) {
            handler(Buffer.from("\r", "utf-8"));
          }
        }, 10);
      }, 10);

      const result = await showActionSelector("test", InterruptionAction.Modify, null, { timeoutMs: 5000 });
      expect(result).not.toBeNull();
      expect(result!.action).toBe(InterruptionAction.Abort);
    });
  });

  describe("Spinner interaction", () => {
    it("should clear spinner before showing menu", async () => {
      const mockSpinner = {
        clear: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        update: vi.fn(),
        fail: vi.fn(),
        setToolCount: vi.fn(),
      };

      simulateKey("1");
      await showActionSelector("test", InterruptionAction.Queue, mockSpinner, { timeoutMs: 5000 });
      expect(mockSpinner.clear).toHaveBeenCalled();
    });
  });

  describe("Message handling", () => {
    it("should preserve the original message in the result", async () => {
      const longMessage = "this is a very long message that should be preserved in the result even though it might be truncated in the display";
      simulateKey("1");
      const result = await showActionSelector(longMessage, InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result!.message).toBe(longMessage);
    });

    it("should ignore unknown keys", async () => {
      // Press 'x' (ignored), then '2' (valid)
      setTimeout(() => {
        const listeners = (process.stdin.on as ReturnType<typeof vi.fn>).mock.calls
          .filter(([event]: [string]) => event === "data")
          .map(([, handler]: [string, (data: Buffer) => void]) => handler);

        for (const handler of listeners) {
          handler(Buffer.from("x", "utf-8"));
        }
        setTimeout(() => {
          for (const handler of listeners) {
            handler(Buffer.from("2", "utf-8"));
          }
        }, 10);
      }, 10);

      const result = await showActionSelector("test", InterruptionAction.Queue, null, { timeoutMs: 5000 });
      expect(result!.action).toBe(InterruptionAction.Queue);
    });
  });
});

describe("mapClassificationToAction", () => {
  it("should map Abort to Abort", () => {
    expect(mapClassificationToAction(InterruptionType.Abort)).toBe(InterruptionAction.Abort);
  });

  it("should map Modify to Modify", () => {
    expect(mapClassificationToAction(InterruptionType.Modify)).toBe(InterruptionAction.Modify);
  });

  it("should map Correct to Modify", () => {
    expect(mapClassificationToAction(InterruptionType.Correct)).toBe(InterruptionAction.Modify);
  });

  it("should map Info to Queue", () => {
    expect(mapClassificationToAction(InterruptionType.Info)).toBe(InterruptionAction.Queue);
  });
});
