/**
 * FIFO message queue for concurrent input capture
 *
 * Stores messages captured from stdin while the agent is executing.
 * Thread-safe (single-threaded Node.js) with configurable max size.
 *
 * @module cli/repl/input/message-queue
 */

import type { QueuedMessage } from "./types.js";

/**
 * Create a FIFO message queue with bounded capacity
 *
 * @param maxSize - Maximum number of messages to store (oldest dropped when exceeded)
 * @returns Message queue interface
 */
export function createMessageQueue(maxSize = 50) {
  let messages: QueuedMessage[] = [];

  return {
    /**
     * Add a message to the queue
     * If queue is at capacity, the oldest message is dropped.
     */
    enqueue(message: QueuedMessage): void {
      messages.push(message);
      if (messages.length > maxSize) {
        messages.shift();
      }
    },

    /**
     * Remove and return the oldest message, or undefined if empty
     */
    dequeue(): QueuedMessage | undefined {
      return messages.shift();
    },

    /**
     * Return all messages and clear the queue
     */
    drain(): QueuedMessage[] {
      const result = messages;
      messages = [];
      return result;
    },

    /**
     * Peek at the oldest message without removing it
     */
    peek(): QueuedMessage | undefined {
      return messages[0];
    },

    /**
     * Number of messages currently in the queue
     */
    get size(): number {
      return messages.length;
    },

    /**
     * Whether the queue is empty
     */
    get isEmpty(): boolean {
      return messages.length === 0;
    },

    /**
     * Clear all messages from the queue
     */
    clear(): void {
      messages = [];
    },
  };
}

/** Type alias for the message queue instance */
export type MessageQueue = ReturnType<typeof createMessageQueue>;
