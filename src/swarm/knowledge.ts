/**
 * Swarm Knowledge Base
 *
 * Append-only JSONL knowledge log at .coco/swarm/knowledge.jsonl.
 * Captures patterns — successes, failures, gotchas, optimizations — for
 * injection into future LLM prompts as context.
 */

import type { SwarmAgentRole } from "./agents/types.js";

/**
 * A knowledge entry capturing a pattern observed during swarm execution
 */
export interface KnowledgeEntry {
  timestamp: string;
  featureId: string;
  pattern: "success" | "failure" | "gotcha" | "optimization";
  description: string;
  agentRole: SwarmAgentRole;
  gate: string;
  tags: string[];
}

/**
 * Append a knowledge entry to the JSONL knowledge base.
 * Creates the file and parent directories if they don't exist.
 */
export async function appendKnowledge(projectPath: string, entry: KnowledgeEntry): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const knowledgeDir = path.join(projectPath, ".coco", "swarm");
  const knowledgeFile = path.join(knowledgeDir, "knowledge.jsonl");

  await fs.mkdir(knowledgeDir, { recursive: true });
  await fs.appendFile(knowledgeFile, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Read all knowledge entries from the JSONL knowledge base.
 * Returns an empty array if the file doesn't exist.
 */
export async function readKnowledge(projectPath: string): Promise<KnowledgeEntry[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const knowledgeFile = path.join(projectPath, ".coco", "swarm", "knowledge.jsonl");

  try {
    const content = await fs.readFile(knowledgeFile, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as KnowledgeEntry);
  } catch {
    return [];
  }
}

/**
 * Format knowledge entries for injection into an LLM prompt.
 *
 * Groups entries by pattern type and formats them as a readable context block.
 */
export function formatKnowledgeForContext(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  const grouped: Record<KnowledgeEntry["pattern"], KnowledgeEntry[]> = {
    success: [],
    failure: [],
    gotcha: [],
    optimization: [],
  };

  for (const entry of entries) {
    grouped[entry.pattern].push(entry);
  }

  const sections: string[] = [];

  if (grouped.failure.length > 0) {
    sections.push(
      `## Known Failures to Avoid\n` +
        grouped.failure.map((e) => `- [${e.featureId}/${e.gate}] ${e.description}`).join("\n"),
    );
  }

  if (grouped.gotcha.length > 0) {
    sections.push(
      `## Gotchas\n` +
        grouped.gotcha.map((e) => `- [${e.featureId}/${e.gate}] ${e.description}`).join("\n"),
    );
  }

  if (grouped.success.length > 0) {
    sections.push(
      `## Successful Patterns\n` +
        grouped.success.map((e) => `- [${e.featureId}/${e.gate}] ${e.description}`).join("\n"),
    );
  }

  if (grouped.optimization.length > 0) {
    sections.push(
      `## Optimizations\n` +
        grouped.optimization.map((e) => `- [${e.featureId}/${e.gate}] ${e.description}`).join("\n"),
    );
  }

  return `# Swarm Knowledge Base\n\n${sections.join("\n\n")}`;
}
