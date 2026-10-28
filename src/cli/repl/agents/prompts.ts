/** Compatibility adapter: distributed profiles live in the runtime catalogue. */
import { getAgentProfile, listAgentProfiles } from "../../../runtime/agent-profiles.js";
import type { AgentType, AgentConfig } from "./types.js";

const profiles = listAgentProfiles();
export const AGENT_PROMPTS = Object.fromEntries(
  profiles.map((p) => [p.id, p.instructions]),
) as Record<AgentType, string>;
export const AGENT_TOOLS = Object.fromEntries(
  profiles.map((p) => [p.id, p.allowedTools]),
) as Record<AgentType, string[]>;
export const AGENT_MAX_TURNS = Object.fromEntries(
  profiles.map((p) => [p.id, p.maxTurns]),
) as Record<AgentType, number>;
export const AGENT_NAMES = Object.fromEntries(profiles.map((p) => [p.id, p.name])) as Record<
  AgentType,
  string
>;
export const AGENT_DESCRIPTIONS = Object.fromEntries(
  profiles.map((p) => [p.id, p.description]),
) as Record<AgentType, string>;

export function getAgentConfig(type: AgentType): AgentConfig {
  const profile = getAgentProfile(type);
  return {
    type,
    role: profile.role,
    systemPrompt: profile.instructions,
    tools: profile.allowedTools,
    maxTurns: profile.maxTurns,
  };
}

export function createAgentConfig(
  type: AgentType,
  overrides?: Partial<Omit<AgentConfig, "type">>,
): AgentConfig {
  return { ...getAgentConfig(type), ...overrides, type };
}
