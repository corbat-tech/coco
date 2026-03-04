/**
 * Provider Bridge - Singleton for agent access to LLM provider and tool registry
 *
 * Agents need access to the LLM provider and tool registry but tools are
 * registered as static constants. This bridge allows tools like delegateTask
 * and spawnSimpleAgent to access the provider at runtime.
 */

import type { LLMProvider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { AgentManager } from "../cli/repl/agents/manager.js";

let agentProvider: LLMProvider | null = null;
let agentToolRegistry: ToolRegistry | null = null;
let agentManagerInstance: AgentManager | null = null;

/**
 * Set the LLM provider for agent execution
 */
export function setAgentProvider(provider: LLMProvider): void {
  agentProvider = provider;
  // Reset manager so it gets recreated with new provider
  agentManagerInstance = null;
}

/**
 * Get the LLM provider for agent execution
 */
export function getAgentProvider(): LLMProvider | null {
  return agentProvider;
}

/**
 * Set the tool registry for agent execution
 */
export function setAgentToolRegistry(registry: ToolRegistry): void {
  agentToolRegistry = registry;
  // Reset manager so it gets recreated with new registry
  agentManagerInstance = null;
}

/**
 * Get the tool registry for agent execution
 */
export function getAgentToolRegistry(): ToolRegistry | null {
  return agentToolRegistry;
}

/**
 * Get or create the singleton AgentManager instance.
 * Returns null if provider or tool registry are not initialized.
 */
export function getAgentManager(): AgentManager | null {
  if (!agentProvider || !agentToolRegistry) {
    return null;
  }
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager(agentProvider, agentToolRegistry);
  }
  return agentManagerInstance;
}
