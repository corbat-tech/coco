/**
 * Tests for MessageQueue
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMessageQueue } from "./message-queue.js";
import type { QueuedMessage } from "./types.js";

function makeMsg(text: string, timestamp?: number): QueuedMessage {
  return { text, timestamp: timestamp ?? Date.now() };
}

describe("createMessageQueue", () => {
  let queue: ReturnType<typeof createMessageQueue>;

  beforeEach(() => {
    queue = createMessageQueue(5);
  });

  it("starts empty", () => {
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
  });

  it("enqueues and dequeues messages in FIFO order", () => {
    queue.enqueue(makeMsg("first"));
    queue.enqueue(makeMsg("second"));
    queue.enqueue(makeMsg("third"));

    expect(queue.size).toBe(3);
    expect(queue.dequeue()?.text).toBe("first");
    expect(queue.dequeue()?.text).toBe("second");
    expect(queue.dequeue()?.text).toBe("third");
    expect(queue.isEmpty).toBe(true);
  });

  it("returns undefined when dequeuing empty queue", () => {
    expect(queue.dequeue()).toBeUndefined();
  });

  it("peeks without removing", () => {
    queue.enqueue(makeMsg("hello"));
    expect(queue.peek()?.text).toBe("hello");
    expect(queue.size).toBe(1);
  });

  it("peek returns undefined for empty queue", () => {
    expect(queue.peek()).toBeUndefined();
  });

  it("drains all messages and clears queue", () => {
    queue.enqueue(makeMsg("a"));
    queue.enqueue(makeMsg("b"));
    queue.enqueue(makeMsg("c"));

    const drained = queue.drain();
    expect(drained).toHaveLength(3);
    expect(drained[0]?.text).toBe("a");
    expect(drained[2]?.text).toBe("c");
    expect(queue.isEmpty).toBe(true);
  });

  it("drops oldest messages when exceeding maxSize", () => {
    // maxSize = 5
    for (let i = 0; i < 8; i++) {
      queue.enqueue(makeMsg(`msg-${i}`));
    }

    expect(queue.size).toBe(5);
    // Oldest 3 should have been dropped
    const drained = queue.drain();
    expect(drained[0]?.text).toBe("msg-3");
    expect(drained[4]?.text).toBe("msg-7");
  });

  it("clears all messages", () => {
    queue.enqueue(makeMsg("a"));
    queue.enqueue(makeMsg("b"));
    queue.clear();
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
  });

  it("works with default maxSize", () => {
    const defaultQueue = createMessageQueue();
    for (let i = 0; i < 60; i++) {
      defaultQueue.enqueue(makeMsg(`msg-${i}`));
    }
    // Default maxSize is 50
    expect(defaultQueue.size).toBe(50);
  });

  it("preserves timestamp in messages", () => {
    const ts = 1700000000000;
    queue.enqueue(makeMsg("test", ts));
    expect(queue.dequeue()?.timestamp).toBe(ts);
  });
});
