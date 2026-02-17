/**
 * Simple interruption queue
 * Stores user messages sent during agent execution
 */

export interface QueuedInterruption {
  message: string;
  timestamp: number;
}

const interruptions: QueuedInterruption[] = [];

export function addInterruption(message: string): void {
  interruptions.push({
    message,
    timestamp: Date.now(),
  });
}

export function hasInterruptions(): boolean {
  return interruptions.length > 0;
}

export function consumeInterruptions(): QueuedInterruption[] {
  const all = [...interruptions];
  interruptions.length = 0;
  return all;
}
