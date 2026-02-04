/**
 * Hook Registry for Corbat-Coco
 *
 * Manages hook registration, lookup, and persistence.
 * Hooks allow extending agent behavior at various lifecycle points.
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { HookDefinition, HookEvent } from "./types.js";
import { HOOK_EVENTS, isHookEvent, isHookType } from "./types.js";

/**
 * Hook registry configuration stored in file
 */
interface HookRegistryConfig {
  /** Config version for future migrations */
  version: number;
  /** Registered hooks */
  hooks: HookDefinition[];
}

/**
 * Registry for managing hooks
 *
 * Stores hooks by event type for fast lookup and supports
 * glob-like pattern matching for tool matchers.
 *
 * @example
 * ```typescript
 * const registry = createHookRegistry();
 * registry.register({
 *   id: 'log-bash-commands',
 *   event: 'PreToolUse',
 *   type: 'command',
 *   matcher: 'Bash',
 *   command: 'echo "Running bash command"',
 *   enabled: true
 * });
 * ```
 */
export class HookRegistry {
  /** Hooks indexed by event type for O(1) lookup */
  private hooksByEvent: Map<HookEvent, HookDefinition[]>;
  /** Hooks indexed by ID for quick access */
  private hooksById: Map<string, HookDefinition>;

  constructor() {
    this.hooksByEvent = new Map();
    this.hooksById = new Map();
  }

  /**
   * Register a hook
   *
   * @param hook - Hook definition to register
   * @throws Error if hook with same ID already exists
   */
  register(hook: HookDefinition): void {
    if (this.hooksById.has(hook.id)) {
      throw new Error(`Hook with ID '${hook.id}' already exists`);
    }

    // Store by ID
    this.hooksById.set(hook.id, hook);

    // Store by event type
    const eventHooks = this.hooksByEvent.get(hook.event) ?? [];
    eventHooks.push(hook);
    this.hooksByEvent.set(hook.event, eventHooks);
  }

  /**
   * Unregister a hook by ID
   *
   * @param hookId - ID of hook to remove
   * @returns true if hook was removed, false if not found
   */
  unregister(hookId: string): boolean {
    const hook = this.hooksById.get(hookId);
    if (!hook) {
      return false;
    }

    // Remove from ID map
    this.hooksById.delete(hookId);

    // Remove from event map
    const eventHooks = this.hooksByEvent.get(hook.event);
    if (eventHooks) {
      const index = eventHooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        eventHooks.splice(index, 1);
      }
      // Clean up empty arrays
      if (eventHooks.length === 0) {
        this.hooksByEvent.delete(hook.event);
      }
    }

    return true;
  }

  /**
   * Get all hooks for an event type
   *
   * @param event - Event type to query
   * @returns Array of hooks for the event (empty if none)
   */
  getHooksForEvent(event: HookEvent): HookDefinition[] {
    return this.hooksByEvent.get(event) ?? [];
  }

  /**
   * Get hooks that match a specific event and optionally a tool
   *
   * Filters hooks by:
   * 1. Event type match
   * 2. Hook enabled status
   * 3. Tool name pattern match (if toolName provided)
   *
   * @param event - Event type to match
   * @param toolName - Optional tool name to match against matcher patterns
   * @returns Array of matching enabled hooks
   */
  getMatchingHooks(event: HookEvent, toolName?: string): HookDefinition[] {
    const eventHooks = this.getHooksForEvent(event);

    // Filter by enabled status and tool matcher
    return eventHooks.filter((hook) => {
      // Skip disabled hooks (enabled defaults to true)
      if (hook.enabled === false) {
        return false;
      }

      // If no matcher specified, hook applies to all tools
      if (!hook.matcher) {
        return true;
      }

      // If no tool name provided but hook has matcher, skip
      if (!toolName) {
        return !hook.matcher;
      }

      // Check if tool name matches the pattern
      return this.matchesPattern(toolName, hook.matcher);
    });
  }

  /**
   * Load hooks from a config file
   *
   * Expects a JSON file with structure:
   * ```json
   * {
   *   "version": 1,
   *   "hooks": [...]
   * }
   * ```
   *
   * @param filePath - Path to hooks config file (JSON)
   * @throws Error if file cannot be read or parsed
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      await access(filePath);
      const content = await readFile(filePath, "utf-8");
      const config = JSON.parse(content) as HookRegistryConfig;

      // Validate version
      if (typeof config.version !== "number") {
        throw new Error("Invalid hooks config: missing version");
      }

      // Validate and register hooks
      if (!Array.isArray(config.hooks)) {
        throw new Error("Invalid hooks config: hooks must be an array");
      }

      // Clear existing hooks
      this.clear();

      // Register each hook
      for (const hook of config.hooks) {
        this.validateHookDefinition(hook);
        this.register(hook);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, that's okay
        return;
      }
      throw error;
    }
  }

  /**
   * Save hooks to a config file
   *
   * Creates the directory if it doesn't exist.
   *
   * @param filePath - Path to save hooks config
   */
  async saveToFile(filePath: string): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    const config: HookRegistryConfig = {
      version: 1,
      hooks: this.getAllHooks(),
    };

    await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
  }

  /**
   * Clear all registered hooks
   */
  clear(): void {
    this.hooksByEvent.clear();
    this.hooksById.clear();
  }

  /**
   * Get all registered hooks
   *
   * @returns Array of all hook definitions
   */
  getAllHooks(): HookDefinition[] {
    return Array.from(this.hooksById.values());
  }

  /**
   * Get a hook by ID
   *
   * @param hookId - Hook ID to find
   * @returns Hook definition or undefined if not found
   */
  getHookById(hookId: string): HookDefinition | undefined {
    return this.hooksById.get(hookId);
  }

  /**
   * Check if registry has any hooks for an event
   *
   * @param event - Event to check
   * @returns true if any hooks are registered for the event
   */
  hasHooksForEvent(event: HookEvent): boolean {
    const hooks = this.hooksByEvent.get(event);
    return hooks !== undefined && hooks.length > 0;
  }

  /**
   * Update an existing hook
   *
   * @param hookId - ID of hook to update
   * @param updates - Partial hook definition with updates
   * @returns true if hook was updated, false if not found
   */
  updateHook(
    hookId: string,
    updates: Partial<Omit<HookDefinition, "id">>
  ): boolean {
    const existing = this.hooksById.get(hookId);
    if (!existing) {
      return false;
    }

    // If event is changing, we need to re-index
    const eventChanging = updates.event && updates.event !== existing.event;
    const oldEvent = existing.event;

    // Apply updates
    Object.assign(existing, updates);

    // Re-index if event changed
    if (eventChanging && updates.event) {
      // Remove from old event
      const oldEventHooks = this.hooksByEvent.get(oldEvent);
      if (oldEventHooks) {
        const index = oldEventHooks.findIndex((h) => h.id === hookId);
        if (index !== -1) {
          oldEventHooks.splice(index, 1);
        }
        if (oldEventHooks.length === 0) {
          this.hooksByEvent.delete(oldEvent);
        }
      }

      // Add to new event
      const newEventHooks = this.hooksByEvent.get(updates.event) ?? [];
      newEventHooks.push(existing);
      this.hooksByEvent.set(updates.event, newEventHooks);
    }

    return true;
  }

  /**
   * Enable or disable a hook
   *
   * @param hookId - ID of hook to toggle
   * @param enabled - New enabled state
   * @returns true if hook was updated, false if not found
   */
  setEnabled(hookId: string, enabled: boolean): boolean {
    return this.updateHook(hookId, { enabled });
  }

  /**
   * Get count of registered hooks
   */
  get size(): number {
    return this.hooksById.size;
  }

  /**
   * Check if a tool name matches a glob-like pattern
   *
   * Supported patterns:
   * - `*` matches any tool
   * - `Edit*` matches Edit, EditFile, etc. (prefix match)
   * - `*File` matches ReadFile, WriteFile, etc. (suffix match)
   * - `*Code*` matches anything containing "Code"
   * - `Bash` exact match
   *
   * @param toolName - Tool name to check
   * @param pattern - Glob-like pattern
   * @returns true if tool name matches pattern
   */
  private matchesPattern(toolName: string, pattern: string): boolean {
    // Exact match for single asterisk (matches everything)
    if (pattern === "*") {
      return true;
    }

    // No wildcards means exact match
    if (!pattern.includes("*")) {
      return toolName === pattern;
    }

    // Convert glob pattern to regex
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    // Convert * to .*
    const regexPattern = escaped.replace(/\*/g, ".*");
    // Create regex with anchors for full match
    const regex = new RegExp(`^${regexPattern}$`);

    return regex.test(toolName);
  }

  /**
   * Validate a hook definition has required fields
   *
   * @param hook - Hook to validate
   * @throws Error if hook is invalid
   */
  private validateHookDefinition(hook: unknown): asserts hook is HookDefinition {
    if (!hook || typeof hook !== "object") {
      throw new Error("Hook definition must be an object");
    }

    const h = hook as Record<string, unknown>;

    if (typeof h.id !== "string" || h.id.length === 0) {
      throw new Error("Hook definition must have a non-empty id");
    }

    if (typeof h.event !== "string") {
      throw new Error("Hook definition must have an event type");
    }

    // Validate event is a known type
    if (!isHookEvent(h.event)) {
      throw new Error(
        `Invalid hook event type: ${h.event}. Valid events: ${HOOK_EVENTS.join(", ")}`
      );
    }

    if (typeof h.type !== "string") {
      throw new Error("Hook definition must have a type (command or prompt)");
    }

    // Validate type is valid
    if (!isHookType(h.type)) {
      throw new Error(
        `Invalid hook type: ${h.type}. Valid types: command, prompt`
      );
    }

    // Validate type-specific fields
    if (h.type === "command" && typeof h.command !== "string") {
      throw new Error("Command hooks must have a command string");
    }

    if (h.type === "prompt" && typeof h.prompt !== "string") {
      throw new Error("Prompt hooks must have a prompt string");
    }
  }
}

/**
 * Create a new hook registry instance
 *
 * @returns New HookRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createHookRegistry();
 *
 * // Load existing hooks
 * await registry.loadFromFile('.coco/hooks.json');
 *
 * // Register new hook
 * registry.register({
 *   id: 'audit-writes',
 *   event: 'PostToolUse',
 *   type: 'command',
 *   matcher: '*File',
 *   command: 'echo "File operation completed"',
 *   enabled: true
 * });
 *
 * // Save to file
 * await registry.saveToFile('.coco/hooks.json');
 * ```
 */
export function createHookRegistry(): HookRegistry {
  return new HookRegistry();
}
