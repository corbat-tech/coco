/**
 * Subagent system for Corbat-Coco
 * Exports all agent-related types, configurations, and the manager
 */

// Types
export type {
  AgentType,
  AgentStatus,
  SubAgent,
  AgentConfig,
  SpawnAgentOptions,
  AgentResult,
  AgentRegistryEntry,
  AgentEventType,
  AgentEvent,
} from "./types.js";

// Prompts and configurations
export {
  AGENT_PROMPTS,
  AGENT_TOOLS,
  AGENT_MAX_TURNS,
  AGENT_NAMES,
  AGENT_DESCRIPTIONS,
  getAgentConfig,
  createAgentConfig,
} from "./prompts.js";

// Manager
export { AgentManager, createAgentManager } from "./manager.js";
