/**
 * Input module exports
 */

export { createInputHandler, type InputHandler } from "./handler.js";
export { createConcurrentCapture, type ConcurrentCapture } from "./concurrent-capture-v2.js";
export { createMessageQueue, type MessageQueue } from "./message-queue.js";
export type { QueuedMessage, CaptureConfig, CaptureState, MessageCapturedCallback } from "./types.js";
