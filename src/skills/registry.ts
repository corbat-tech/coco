/**
 * Unified Skill Registry
 *
 * Central registry supporting both markdown (SKILL.md) and native (TypeScript) skills.
 * Metadata is loaded eagerly at startup; full content is loaded lazily on demand.
 */

import type {
  SkillMetadata,
  LoadedSkill,
  SkillCategory,
  SkillScope,
  SkillMatch,
  SkillExecutionContext,
  SkillExecutionResult,
} from "./types.js";
import { isNativeContent } from "./types.js";
import { discoverAllSkills } from "./discovery.js";
import { loadFullSkill, nativeSkillToLoaded } from "./loader/index.js";
import { matchSkills } from "./matcher.js";
import type { LegacySkill } from "./loader/typescript-loader.js";

/** Skills configuration (mirrors SkillsConfigSchema from config/schema.ts) */
export interface SkillsRuntimeConfig {
  enabled?: boolean;
  globalDir?: string;
  projectDir?: string;
  autoActivate?: boolean;
  maxActiveSkills?: number;
  disabled?: string[];
}

/** Default max active skills if config not set */
const DEFAULT_MAX_ACTIVE_SKILLS = 3;

export class UnifiedSkillRegistry {
  /** Skill metadata indexed by ID (loaded eagerly) */
  private metadata: Map<string, SkillMetadata> = new Map();

  /** Alias -> skill ID mapping */
  private aliases: Map<string, string> = new Map();

  /** Cached loaded skills (loaded lazily) */
  private loadedCache: Map<string, LoadedSkill> = new Map();

  /** Currently active markdown skill IDs (injected into system prompt) */
  private activeSkillIds: Set<string> = new Set();

  /** Runtime configuration from CocoConfig.skills */
  private _config: SkillsRuntimeConfig = {};

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Set runtime configuration for skills behavior
   */
  setConfig(config: SkillsRuntimeConfig): void {
    this._config = config;
  }

  /** Get current configuration (read-only) */
  get config(): Readonly<SkillsRuntimeConfig> {
    return this._config;
  }

  // ============================================================================
  // Discovery
  // ============================================================================

  /**
   * Discover and register all skills across all scopes
   */
  async discoverAndRegister(
    projectPath: string,
    builtinSkills: LegacySkill[] = [],
    globalDir?: string,
  ): Promise<void> {
    // Respect enabled flag — skip discovery entirely if disabled
    if (this._config.enabled === false) {
      return;
    }

    // Build discovery options from config + explicit params
    const discoveryOptions = {
      globalDir: globalDir ?? this._config.globalDir,
      projectDir: this._config.projectDir,
    };

    const discovered = await discoverAllSkills(projectPath, builtinSkills, discoveryOptions);

    // Filter out disabled skills
    const disabledSet = new Set(this._config.disabled ?? []);

    for (const meta of discovered) {
      if (!disabledSet.has(meta.id)) {
        this.registerMetadata(meta);
      }
    }

    // Pre-cache native builtins since they're already in memory
    for (const skill of builtinSkills) {
      const loaded = nativeSkillToLoaded(skill, "builtin");
      if (!disabledSet.has(loaded.metadata.id)) {
        this.loadedCache.set(loaded.metadata.id, loaded);
      }
    }
  }

  /**
   * Register skill metadata (and its aliases)
   */
  registerMetadata(meta: SkillMetadata): void {
    // Clean up old aliases if re-registering
    const existing = this.metadata.get(meta.id);
    if (existing?.aliases) {
      for (const alias of existing.aliases) {
        this.aliases.delete(alias);
      }
    }

    this.metadata.set(meta.id, meta);

    if (meta.aliases) {
      for (const alias of meta.aliases) {
        this.aliases.set(alias, meta.id);
      }
    }
  }

  // ============================================================================
  // Metadata Access
  // ============================================================================

  /** Get metadata by ID or alias */
  getMetadata(idOrAlias: string): SkillMetadata | undefined {
    const meta = this.metadata.get(idOrAlias);
    if (meta) return meta;

    const resolvedId = this.aliases.get(idOrAlias);
    if (resolvedId) return this.metadata.get(resolvedId);

    return undefined;
  }

  /** Check if a skill exists */
  has(idOrAlias: string): boolean {
    return this.metadata.has(idOrAlias) || this.aliases.has(idOrAlias);
  }

  /** Get all skill metadata */
  getAllMetadata(): SkillMetadata[] {
    return Array.from(this.metadata.values());
  }

  /** Get skills by category */
  getByCategory(category: SkillCategory): SkillMetadata[] {
    return this.getAllMetadata().filter((m) => m.category === category);
  }

  /** Get skills by scope */
  getByScope(scope: SkillScope): SkillMetadata[] {
    return this.getAllMetadata().filter((m) => m.scope === scope);
  }

  /** Get total skill count */
  get size(): number {
    return this.metadata.size;
  }

  // ============================================================================
  // Content Loading (lazy)
  // ============================================================================

  /**
   * Load full skill content by ID (cached)
   */
  async loadSkill(id: string): Promise<LoadedSkill | null> {
    // Check cache first
    const cached = this.loadedCache.get(id);
    if (cached) return cached;

    const meta = this.metadata.get(id);
    if (!meta) return null;

    const loaded = await loadFullSkill(meta);
    if (loaded) {
      this.loadedCache.set(id, loaded);
    }
    return loaded;
  }

  // ============================================================================
  // Activation (for markdown skills injected into system prompt)
  // ============================================================================

  /**
   * Activate a markdown skill (loads content and marks as active)
   *
   * Respects maxActiveSkills config: if limit would be exceeded,
   * the oldest active skill (FIFO) is deactivated to make room.
   */
  async activateSkill(id: string): Promise<boolean> {
    const meta = this.metadata.get(id);
    if (!meta || meta.kind !== "markdown") return false;

    const loaded = await this.loadSkill(id);
    if (!loaded) return false;

    // Enforce maxActiveSkills limit with FIFO eviction.
    // Set iteration order is guaranteed to be insertion order (ES2015 spec),
    // so the first element is always the oldest activated skill.
    const maxActive = this._config.maxActiveSkills ?? DEFAULT_MAX_ACTIVE_SKILLS;
    while (this.activeSkillIds.size >= maxActive && !this.activeSkillIds.has(id)) {
      const oldest = this.activeSkillIds.values().next().value;
      if (oldest) {
        this.activeSkillIds.delete(oldest);
      } else {
        break;
      }
    }

    this.activeSkillIds.add(id);
    return true;
  }

  /** Deactivate a skill */
  deactivateSkill(id: string): void {
    this.activeSkillIds.delete(id);
  }

  /** Deactivate all skills */
  deactivateAll(): void {
    this.activeSkillIds.clear();
  }

  /** Get all currently active loaded skills */
  getActiveSkills(): LoadedSkill[] {
    const result: LoadedSkill[] = [];
    for (const id of this.activeSkillIds) {
      const loaded = this.loadedCache.get(id);
      if (loaded) result.push(loaded);
    }
    return result;
  }

  /** Get active skill IDs */
  getActiveSkillIds(): string[] {
    return Array.from(this.activeSkillIds);
  }

  // ============================================================================
  // Execution (for native skills invoked via slash commands)
  // ============================================================================

  /**
   * Execute a skill by ID or alias
   */
  async execute(
    idOrAlias: string,
    args: string,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const meta = this.getMetadata(idOrAlias);
    if (!meta) {
      return {
        success: false,
        error: `Unknown skill: ${idOrAlias}. Use /help to see available skills.`,
      };
    }

    const loaded = await this.loadSkill(meta.id);
    if (!loaded) {
      return {
        success: false,
        error: `Failed to load skill: ${meta.name}`,
      };
    }

    if (isNativeContent(loaded.content)) {
      try {
        return await loaded.content.execute(args, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Error in /${meta.name}: ${message}` };
      }
    }

    // Check if skill should run in a forked/agent context (subagent)
    if (meta.context === "fork" || meta.context === "agent") {
      // Load full content for the subagent prompt
      const content = loaded.content as import("./types.js").MarkdownSkillContent;
      let body = content.instructions;
      body = body.replace(/\$ARGUMENTS/g, args);

      return {
        success: true,
        output: body,
        // Signal to the REPL that this should be run as a subagent
        shouldFork: true,
      };
    }

    // Inline markdown skills get activated and injected into system prompt
    await this.activateSkill(meta.id);
    return {
      success: true,
      output: `Skill "${meta.name}" activated. Its instructions are now guiding the conversation.`,
    };
  }

  // ============================================================================
  // Matching
  // ============================================================================

  /**
   * Find skills relevant to a user message
   */
  findRelevantSkills(
    userMessage: string,
    maxResults?: number,
    minScore?: number,
  ): SkillMatch[] {
    return matchSkills(userMessage, this.getAllMetadata(), { maxResults, minScore });
  }
}

/**
 * Factory: create a new UnifiedSkillRegistry
 */
export function createUnifiedSkillRegistry(): UnifiedSkillRegistry {
  return new UnifiedSkillRegistry();
}
