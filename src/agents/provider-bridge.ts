/**
 * Provider Bridge - Singleton for agent access to LLM provider and tool registry
 *
 * Agents need access to the LLM provider and tool registry but tools are
 * registered as static constants. This bridge allows tools like delegateTask
 * and spawnSimpleAgent to access the provider at runtime.
 */

import type { LLMProvider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";

let agentProvider: LLMProvider | null = null;
let agentToolRegistry: ToolRegistry | null = null;

/**
 * Set the LLM provider for agent execution
 */
export function setAgentProvider(provider: LLMProvider): void {
  agentProvider = provider;
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
}

/**
 * Get the tool registry for agent execution
 */
export function getAgentToolRegistry(): ToolRegistry | null {
  return agentToolRegistry;
}
