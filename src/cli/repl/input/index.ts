/**
 * Input module exports
 */

export { createInputHandler, type InputHandler } from "./handler.js";
export { createConcurrentCapture, type ConcurrentCapture } from "./concurrent-capture-v2.js";
export { createMessageQueue, type MessageQueue } from "./message-queue.js";
export { showActionSelector, mapClassificationToAction, type ActionSelectorResult, type ActionSelectorConfig } from "./action-selector.js";
export { createInputEcho, type InputEcho, type InputEchoConfig } from "./input-echo.js";
export type { QueuedMessage, CaptureConfig, CaptureState, MessageCapturedCallback, BufferChangeCallback } from "./types.js";
