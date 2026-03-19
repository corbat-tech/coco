/**
 * Prompt Enhancers — Public API
 *
 * Provides request-adaptive prompt enhancement for the Coco system prompt.
 * The main entry point is `getEnhancersForRequest()` which classifies user
 * input and returns composed enhancer text to inject into the system prompt.
 */

export { classifyRequest } from "./classifier.js";
export type { RequestType, PromptEnhancer } from "./enhancers/types.js";
export { ALL_REQUEST_TYPES } from "./enhancers/types.js";
export { EnhancerRegistry, createEnhancerRegistry } from "./enhancers/registry.js";
export { composeEnhancers } from "./enhancers/composer.js";

import type { EnhancerRegistry } from "./enhancers/registry.js";
import { classifyRequest } from "./classifier.js";
import { createEnhancerRegistry } from "./enhancers/registry.js";
import { composeEnhancers } from "./enhancers/composer.js";

/**
 * Singleton registry instance — created once, reused across calls.
 * Lazy-initialized on first call to getEnhancersForRequest().
 */
let registryInstance: EnhancerRegistry | null = null;

function getRegistry(): EnhancerRegistry {
  if (!registryInstance) {
    registryInstance = createEnhancerRegistry();
  }
  return registryInstance;
}

/**
 * Classify a user request and return the composed enhancer prompt text.
 *
 * This is the main entry point for the prompt enhancers system.
 * Call this with the user's last message to get context-adaptive
 * behavioral directives for the system prompt.
 *
 * @param input - The user's message text
 * @param registry - Optional registry override for testing
 * @returns Composed enhancer text to inject, or empty string if none apply
 */
export function getEnhancersForRequest(input: string, registry?: EnhancerRegistry): string {
  const requestType = classifyRequest(input);
  const reg = registry ?? getRegistry();
  const enhancers = reg.getForType(requestType);
  return composeEnhancers(enhancers);
}
