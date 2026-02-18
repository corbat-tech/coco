/**
 * Concurrent Input Capture v2
 *
 * Captures user input from stdin while the agent is executing, without
 * interfering with the Ora spinner on stdout.
 *
 * Strategy:
 * - Enable raw mode on stdin to capture keystrokes
 * - Accumulate characters in a silent buffer (no echo to stdout)
 * - On Enter, enqueue the completed line into a MessageQueue
 * - Invoke an optional callback for feedback (e.g. update spinner text)
 * - Handle Backspace, Ctrl+C (ignored during capture), and other control keys
 *
 * Key design: We ONLY manage stdin. Stdout is left entirely to Ora.
 * This avoids the rendering conflicts that plagued the v1 implementation.
 *
 * @module cli/repl/input/concurrent-capture-v2
 */

import type {
  CaptureConfig,
  CaptureState,
  MessageCapturedCallback,
  BufferChangeCallback,
  QueuedMessage,
} from "./types.js";
import { createMessageQueue, type MessageQueue } from "./message-queue.js";

/** Debug logging — set COCO_DEBUG_CAPTURE=1 to enable */
const DEBUG = process.env.COCO_DEBUG_CAPTURE === "1";
function debugLog(msg: string): void {
  if (DEBUG) process.stderr.write(`[capture] ${msg}\n`);
}

/** Default configuration */
const DEFAULT_CONFIG: CaptureConfig = {
  bell: false,
  maxQueueSize: 50,
};

/**
 * Create a concurrent capture instance
 *
 * @param config - Optional capture configuration
 * @returns Concurrent capture controller
 */
export function createConcurrentCapture(config?: Partial<CaptureConfig>) {
  const cfg: CaptureConfig = { ...DEFAULT_CONFIG, ...config };
  const queue: MessageQueue = createMessageQueue(cfg.maxQueueSize);

  let state: CaptureState = "idle";
  let buffer = "";
  let onMessage: MessageCapturedCallback | null = null;
  let onBufferChange: BufferChangeCallback | null = null;
  let dataHandler: ((data: Buffer) => void) | null = null;

  /**
   * Process a raw stdin data chunk
   */
  function handleData(data: Buffer): void {
    debugLog(
      `handleData called, state=${state}, bytes=${data.length}, hex=${data.toString("hex").slice(0, 40)}`,
    );
    if (state !== "capturing") return;

    const str = data.toString("utf-8");

    for (let i = 0; i < str.length; i++) {
      const char = str[i]!;
      const code = char.charCodeAt(0);

      // Enter (CR or LF) — submit the buffered line
      if (char === "\r" || char === "\n") {
        const trimmed = buffer.trim();
        if (trimmed.length > 0) {
          const message: QueuedMessage = {
            text: trimmed,
            timestamp: Date.now(),
          };
          queue.enqueue(message);
          if (onMessage) {
            onMessage(message);
          }
          if (cfg.bell) {
            process.stdout.write("\x07");
          }
        }
        buffer = "";
        onBufferChange?.(buffer);
        continue;
      }

      // Backspace (0x7F or 0x08) — remove last character from buffer
      if (code === 0x7f || code === 0x08) {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          onBufferChange?.(buffer);
        }
        continue;
      }

      // Ctrl+U — clear the buffer
      if (code === 0x15) {
        buffer = "";
        onBufferChange?.(buffer);
        continue;
      }

      // Ctrl+W — delete previous word
      if (code === 0x17) {
        const trimmedBuf = buffer.trimEnd();
        const lastSpace = trimmedBuf.lastIndexOf(" ");
        buffer = lastSpace >= 0 ? trimmedBuf.slice(0, lastSpace + 1) : "";
        onBufferChange?.(buffer);
        continue;
      }

      // Skip escape sequences entirely — must be checked BEFORE the
      // generic control-char filter so we consume the full sequence
      if (code === 0x1b) {
        // Consume the rest of the escape sequence in this chunk
        if (i + 1 < str.length && str[i + 1] === "[") {
          // CSI sequence: skip until we find a letter (0x40-0x7E)
          i += 2; // skip \x1b[
          while (i < str.length && str.charCodeAt(i) < 0x40) {
            i++;
          }
          // i now points at the final byte of the sequence (or past end)
        } else if (i + 1 < str.length) {
          // Two-byte escape: skip next char
          i++;
        }
        continue;
      }

      // Ignore other control characters (< 0x20) except tab (0x09)
      if (code < 0x20 && code !== 0x09) {
        continue;
      }

      // Printable character — append to buffer
      buffer += char;
      onBufferChange?.(buffer);
    }
  }

  return {
    /**
     * Start capturing stdin input
     *
     * @param callback - Optional callback when a message is captured
     * @param bufferCallback - Optional callback invoked on each buffer change (keystroke echo)
     */
    start(callback?: MessageCapturedCallback, bufferCallback?: BufferChangeCallback): void {
      debugLog(
        `start() called, currentState=${state}, isTTY=${process.stdin.isTTY}, isPaused=${process.stdin.isPaused()}, isRaw=${process.stdin.isTTY ? process.stdin.isRaw : "N/A"}, listenerCount=${process.stdin.listenerCount("data")}`,
      );
      if (state === "capturing") return;

      onMessage = callback ?? null;
      onBufferChange = bufferCallback ?? null;
      buffer = "";
      state = "capturing";

      dataHandler = handleData;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      // Add listener BEFORE resume — per Node.js Readable spec, adding a
      // "data" listener triggers flowing mode. We add it first so the stream
      // is ready to emit events when resume() activates reading.
      process.stdin.on("data", dataHandler);
      process.stdin.resume();
      debugLog(
        `start() done, isRaw=${process.stdin.isTTY ? process.stdin.isRaw : "N/A"}, isPaused=${process.stdin.isPaused()}, listenerCount=${process.stdin.listenerCount("data")}, readableFlowing=${(process.stdin as NodeJS.ReadStream & { readableFlowing: boolean | null }).readableFlowing}`,
      );
    },

    /**
     * Stop capturing stdin input
     * Returns all queued messages and resets state.
     */
    stop(): QueuedMessage[] {
      debugLog(`stop() called, currentState=${state}, queueSize=${queue.size}`);
      if (state !== "capturing") return queue.drain();

      state = "stopped";

      if (dataHandler) {
        process.stdin.removeListener("data", dataHandler);
        dataHandler = null;
      }

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      onMessage = null;
      onBufferChange = null;
      buffer = "";

      return queue.drain();
    },

    /**
     * Temporarily suspend capture (e.g. during confirmation dialogs)
     * Removes the data listener and disables raw mode, but preserves state
     * so resume() can reactivate it.
     */
    suspend(): void {
      if (state !== "capturing") return;

      if (dataHandler) {
        process.stdin.removeListener("data", dataHandler);
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    },

    /**
     * Resume capture after a suspend()
     * Re-enables raw mode and the data listener.
     */
    resumeCapture(): void {
      if (state !== "capturing") return;

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      if (dataHandler) {
        process.stdin.on("data", dataHandler);
      }
    },

    /**
     * Get the current capture state
     */
    get state(): CaptureState {
      return state;
    },

    /**
     * Get a read-only view of the message queue
     */
    get queue(): MessageQueue {
      return queue;
    },

    /**
     * Whether there are pending messages in the queue
     */
    get hasMessages(): boolean {
      return !queue.isEmpty;
    },

    /**
     * Get the current buffer content (what the user has typed but not yet submitted)
     */
    get currentBuffer(): string {
      return buffer;
    },

    /**
     * Reset state to idle (for reuse across agent turns)
     */
    reset(): void {
      state = "idle";
      buffer = "";
      queue.clear();
      onMessage = null;
      onBufferChange = null;
    },
  };
}

/** Type alias for the concurrent capture instance */
export type ConcurrentCapture = ReturnType<typeof createConcurrentCapture>;
