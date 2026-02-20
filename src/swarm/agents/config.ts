/**
 * Swarm Agent Configuration
 *
 * Allows per-agent model/temperature overrides, stored in .coco/swarm/agents.json
 */

import type { SwarmAgentRole } from "./types.js";

/**
 * Per-agent model configuration overrides
 */
export interface AgentModelConfig {
  /** Override model for this agent (empty = use main provider model) */
  model?: string;
  maxTurns?: number;
  temperature?: number;
}

/**
 * Map of role to model config
 */
export type AgentConfigMap = Record<SwarmAgentRole, AgentModelConfig>;

/**
 * Default configuration for each agent role
 */
export const DEFAULT_AGENT_CONFIG: AgentConfigMap = {
  pm: { maxTurns: 15, temperature: 0.3 },
  architect: { maxTurns: 20, temperature: 0.3 },
  "best-practices": { maxTurns: 10, temperature: 0.5 },
  "tdd-developer": { maxTurns: 30, temperature: 0.2 },
  qa: { maxTurns: 20, temperature: 0.2 },
  "external-reviewer": { maxTurns: 15, temperature: 0.4 },
  "security-auditor": { maxTurns: 10, temperature: 0.2 },
  integrator: { maxTurns: 20, temperature: 0.2 },
};

/**
 * Load agent configuration from .coco/swarm/agents.json, merged with defaults.
 * Missing keys fall back to DEFAULT_AGENT_CONFIG.
 */
export async function loadAgentConfig(projectPath: string): Promise<AgentConfigMap> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const configPath = path.join(projectPath, ".coco", "swarm", "agents.json");

  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AgentConfigMap>;

    // Deep merge: defaults first, then override with persisted values
    const merged: AgentConfigMap = { ...DEFAULT_AGENT_CONFIG };
    for (const role of Object.keys(DEFAULT_AGENT_CONFIG) as SwarmAgentRole[]) {
      if (parsed[role]) {
        merged[role] = { ...DEFAULT_AGENT_CONFIG[role], ...parsed[role] };
      }
    }
    return merged;
  } catch {
    // File doesn't exist or is invalid — use defaults
    return { ...DEFAULT_AGENT_CONFIG };
  }
}

/**
 * Write the default agent config to .coco/swarm/agents.json with a comment header.
 */
export async function saveDefaultAgentConfig(projectPath: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const configDir = path.join(projectPath, ".coco", "swarm");
  const configPath = path.join(configDir, "agents.json");

  await fs.mkdir(configDir, { recursive: true });

  const content = JSON.stringify(DEFAULT_AGENT_CONFIG, null, 2);
  const withComment =
    `// Swarm agent configuration — customize model, maxTurns, temperature per role\n` +
    `// Remove the comment lines before parsing as strict JSON\n` +
    content;

  await fs.writeFile(configPath, withComment, "utf-8");
}
