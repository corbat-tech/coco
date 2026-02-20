/**
 * Swarm Event Log
 *
 * Append-only JSONL event log written to .coco/swarm/events.jsonl.
 * Each line is a valid JSON object representing one SwarmEvent.
 */

import type { SwarmAgentRole } from "./agents/types.js";

/**
 * A single event in the swarm execution log
 */
export interface SwarmEvent {
  id: string;
  timestamp: string;
  agentRole: SwarmAgentRole;
  agentTurn: number;
  featureId?: string;
  taskId?: string;
  action: "tool_call" | "llm_request" | "gate_check" | "handoff" | "reflection";
  input: unknown;
  output: unknown;
  durationMs: number;
  tokensUsed?: number;
}

/**
 * Append a single event to the JSONL event log.
 * Creates the file and parent directories if they don't exist.
 */
export async function appendSwarmEvent(
  projectPath: string,
  event: SwarmEvent,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const eventsDir = path.join(projectPath, ".coco", "swarm");
  const eventsFile = path.join(eventsDir, "events.jsonl");

  await fs.mkdir(eventsDir, { recursive: true });
  await fs.appendFile(eventsFile, JSON.stringify(event) + "\n", "utf-8");
}

/**
 * Read all events from the JSONL event log.
 * Returns an empty array if the file doesn't exist.
 */
export async function readSwarmEvents(projectPath: string): Promise<SwarmEvent[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const eventsFile = path.join(projectPath, ".coco", "swarm", "events.jsonl");

  try {
    const content = await fs.readFile(eventsFile, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as SwarmEvent);
  } catch {
    return [];
  }
}

/**
 * Generate a unique event ID using timestamp + random suffix
 */
export function createEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
