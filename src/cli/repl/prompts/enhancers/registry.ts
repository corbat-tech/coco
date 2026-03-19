/**
 * Enhancer Registry — maps request types to applicable prompt enhancers.
 *
 * Manages registration, lookup, and enable/disable of prompt enhancers.
 * The registry is created with all built-in enhancers pre-registered.
 */

import type { PromptEnhancer, RequestType } from "./types.js";
import { VERIFICATION_ENHANCER } from "./verification.js";
import { PARALLEL_ENHANCER } from "./parallel.js";
import { RESEARCH_ENHANCER } from "./research.js";
import { DEBUGGING_ENHANCER } from "./debugging.js";
import { TESTING_ENHANCER } from "./testing.js";
import { PLANNING_ENHANCER } from "./planning.js";

/**
 * Registry for prompt enhancers.
 * Stores enhancers and retrieves the applicable ones for a given request type.
 */
export class EnhancerRegistry {
  private enhancers = new Map<string, PromptEnhancer>();

  /**
   * Register a prompt enhancer.
   * @param enhancer - The enhancer to register
   * @throws If an enhancer with the same name is already registered
   */
  register(enhancer: PromptEnhancer): void {
    if (this.enhancers.has(enhancer.name)) {
      throw new Error(`Enhancer "${enhancer.name}" is already registered`);
    }
    // Store a shallow copy to avoid mutating the module-level constant
    this.enhancers.set(enhancer.name, { ...enhancer });
  }

  /**
   * Get all enabled enhancers applicable to a request type, sorted by priority.
   *
   * An enhancer applies if its triggers include the given type OR if its
   * triggers cover all types (i.e., it's a universal enhancer).
   *
   * @param type - The classified request type
   * @returns Sorted array of applicable enhancers (lowest priority number first)
   */
  getForType(type: RequestType): PromptEnhancer[] {
    const result: PromptEnhancer[] = [];
    for (const enhancer of this.enhancers.values()) {
      if (!enhancer.enabled) continue;
      if (enhancer.triggers.includes(type) || enhancer.triggers.includes("general")) {
        result.push(enhancer);
      }
    }
    return result.sort((a, b) => a.priority - b.priority);
  }

  /** Get all registered enhancers (enabled and disabled) */
  getAll(): PromptEnhancer[] {
    return [...this.enhancers.values()];
  }

  /** Enable an enhancer by name */
  enable(name: string): void {
    const enhancer = this.enhancers.get(name);
    if (enhancer) enhancer.enabled = true;
  }

  /** Disable an enhancer by name */
  disable(name: string): void {
    const enhancer = this.enhancers.get(name);
    if (enhancer) enhancer.enabled = false;
  }

  /** Check if an enhancer is registered */
  has(name: string): boolean {
    return this.enhancers.has(name);
  }
}

/** All built-in enhancers in registration order */
const BUILTIN_ENHANCERS: readonly PromptEnhancer[] = [
  VERIFICATION_ENHANCER,
  PARALLEL_ENHANCER,
  RESEARCH_ENHANCER,
  DEBUGGING_ENHANCER,
  TESTING_ENHANCER,
  PLANNING_ENHANCER,
];

/**
 * Create a new EnhancerRegistry with all built-in enhancers pre-registered.
 */
export function createEnhancerRegistry(): EnhancerRegistry {
  const registry = new EnhancerRegistry();
  for (const enhancer of BUILTIN_ENHANCERS) {
    registry.register(enhancer);
  }
  return registry;
}
