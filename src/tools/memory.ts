/**
 * Memory tools for Corbat-Coco
 * Persist learnings and context between sessions
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import { COCO_HOME } from "../config/paths.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");
const crypto = await import("node:crypto");

/**
 * Memory storage directories
 */
const GLOBAL_MEMORIES_DIR = path.join(COCO_HOME, "memories");
const PROJECT_MEMORIES_DIR = ".coco/memories";

/**
 * Maximum memories per scope
 */
const DEFAULT_MAX_MEMORIES = 1000;

/**
 * Memory entry interface
 */
export interface Memory {
  id: string;
  key: string;
  value: string;
  tags: string[];
  scope: "global" | "project";
  project?: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
}

/**
 * Memory index entry (lightweight for fast lookup)
 */
interface MemoryIndexEntry {
  id: string;
  key: string;
  tags: string[];
  scope: "global" | "project";
  createdAt: string;
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Get memories directory for scope
 */
function getMemoriesDir(scope: "global" | "project"): string {
  return scope === "global" ? GLOBAL_MEMORIES_DIR : PROJECT_MEMORIES_DIR;
}

/**
 * Load memory index
 */
async function loadIndex(
  scope: "global" | "project",
): Promise<MemoryIndexEntry[]> {
  const dir = getMemoriesDir(scope);
  const indexPath = path.join(dir, "index.json");

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(content) as MemoryIndexEntry[];
  } catch {
    return [];
  }
}

/**
 * Save memory index
 */
async function saveIndex(
  scope: "global" | "project",
  index: MemoryIndexEntry[],
): Promise<void> {
  const dir = getMemoriesDir(scope);
  await ensureDir(dir);
  const indexPath = path.join(dir, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Load a single memory
 */
async function loadMemory(
  scope: "global" | "project",
  id: string,
): Promise<Memory | null> {
  const dir = getMemoriesDir(scope);
  const memPath = path.join(dir, `${id}.json`);

  try {
    const content = await fs.readFile(memPath, "utf-8");
    return JSON.parse(content) as Memory;
  } catch {
    return null;
  }
}

/**
 * Save a single memory
 */
async function saveMemory(
  scope: "global" | "project",
  memory: Memory,
): Promise<void> {
  const dir = getMemoriesDir(scope);
  await ensureDir(dir);
  const memPath = path.join(dir, `${memory.id}.json`);
  await fs.writeFile(memPath, JSON.stringify(memory, null, 2), "utf-8");
}

/**
 * Create memory tool
 */
export const createMemoryTool: ToolDefinition<
  {
    key: string;
    value: string;
    tags?: string[];
    scope?: "global" | "project";
  },
  { id: string; key: string; scope: string; created: boolean }
> = defineTool({
  name: "create_memory",
  description: `Save a memory (key-value pair) that persists between sessions.
Use for storing project conventions, patterns, preferences, and learnings.

Examples:
- Save convention: { "key": "naming-convention", "value": "Use camelCase for variables", "tags": ["style"] }
- Save learning: { "key": "db-connection-pattern", "value": "Always use connection pooling with max 10", "tags": ["database", "performance"] }
- Global memory: { "key": "preferred-test-framework", "value": "vitest", "scope": "global" }`,
  category: "memory",
  parameters: z.object({
    key: z
      .string()
      .min(1)
      .max(200)
      .describe("Memory key/name (unique identifier)"),
    value: z.string().min(1).max(10000).describe("Memory content"),
    tags: z
      .array(z.string().max(50))
      .max(20)
      .optional()
      .default([])
      .describe("Tags for categorization and search"),
    scope: z
      .enum(["global", "project"])
      .optional()
      .default("project")
      .describe("Storage scope: global (~/.coco) or project-local (.coco)"),
  }),
  async execute({ key, value, tags, scope }) {
    const effectiveScope = scope ?? "project";
    const effectiveTags = tags ?? [];
    const index = await loadIndex(effectiveScope);

    // Check if key already exists (update if so)
    const existing = index.find((e) => e.key === key);
    const now = new Date().toISOString();

    if (existing) {
      // Update existing memory
      const memory = await loadMemory(effectiveScope, existing.id);
      if (memory) {
        memory.value = value;
        memory.tags = effectiveTags;
        memory.updatedAt = now;
        await saveMemory(effectiveScope, memory);

        // Update index
        existing.tags = effectiveTags;
        await saveIndex(effectiveScope, index);

        return { id: existing.id, key, scope: effectiveScope, created: false };
      }
    }

    // Check max memories
    if (index.length >= DEFAULT_MAX_MEMORIES) {
      throw new ToolError(
        `Maximum memories (${DEFAULT_MAX_MEMORIES}) reached for scope '${effectiveScope}'. Delete some memories first.`,
        { tool: "create_memory" },
      );
    }

    // Create new memory
    const id = crypto.randomUUID();
    const memory: Memory = {
      id,
      key,
      value,
      tags: effectiveTags,
      scope: effectiveScope,
      project: effectiveScope === "project" ? process.cwd() : undefined,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };

    await saveMemory(effectiveScope, memory);

    // Update index
    index.push({ id, key, tags: effectiveTags, scope: effectiveScope, createdAt: now });
    await saveIndex(effectiveScope, index);

    return { id, key, scope: effectiveScope, created: true };
  },
});

/**
 * Recall memory tool
 */
export const recallMemoryTool: ToolDefinition<
  {
    query?: string;
    tags?: string[];
    scope?: "global" | "project" | "all";
    limit?: number;
  },
  { memories: Memory[]; totalFound: number }
> = defineTool({
  name: "recall_memory",
  description: `Search and recall stored memories by key, tags, or free text query.

Examples:
- By key substring: { "query": "naming" }
- By tags: { "tags": ["database"] }
- All memories: { "scope": "all", "limit": 20 }
- Combined: { "query": "test", "tags": ["performance"], "scope": "project" }`,
  category: "memory",
  parameters: z.object({
    query: z
      .string()
      .optional()
      .describe("Search query (matches key and value)"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Filter by tags (matches any)"),
    scope: z
      .enum(["global", "project", "all"])
      .optional()
      .default("all")
      .describe("Which scope to search"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Maximum results"),
  }),
  async execute({ query, tags, scope, limit }) {
    const effectiveScope = scope ?? "all";
    const effectiveLimit = limit ?? 10;
    const scopes: Array<"global" | "project"> =
      effectiveScope === "all" ? ["global", "project"] : [effectiveScope as "global" | "project"];

    const allMemories: Memory[] = [];

    for (const s of scopes) {
      const index = await loadIndex(s);

      // Filter index entries
      let filtered = index;

      if (query) {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter((e) =>
          e.key.toLowerCase().includes(lowerQuery),
        );
      }

      if (tags && tags.length > 0) {
        filtered = filtered.filter((e) =>
          tags.some((tag) => e.tags.includes(tag)),
        );
      }

      // Load full memories for matching entries
      for (const entry of filtered) {
        const memory = await loadMemory(s, entry.id);
        if (memory) {
          // Also search in value if query specified
          if (query) {
            const lowerQuery = query.toLowerCase();
            if (
              !memory.key.toLowerCase().includes(lowerQuery) &&
              !memory.value.toLowerCase().includes(lowerQuery)
            ) {
              continue;
            }
          }

          // Update access count
          memory.accessCount++;
          await saveMemory(s, memory);

          allMemories.push(memory);
        }
      }
    }

    // If no filters provided, load all
    if (!query && (!tags || tags.length === 0)) {
      // Already loaded above through index, just slice
    }

    // Sort by most recently updated
    allMemories.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const limited = allMemories.slice(0, effectiveLimit);

    return {
      memories: limited,
      totalFound: allMemories.length,
    };
  },
});

/**
 * List memories tool
 */
export const listMemoriesTool: ToolDefinition<
  {
    scope?: "global" | "project" | "all";
    tags?: string[];
  },
  {
    memories: Array<{
      id: string;
      key: string;
      tags: string[];
      scope: string;
      createdAt: string;
    }>;
    total: number;
  }
> = defineTool({
  name: "list_memories",
  description: `List all stored memories with optional filtering. Returns lightweight index entries.

Examples:
- List all: { "scope": "all" }
- Project only: { "scope": "project" }
- By tags: { "tags": ["database", "config"] }`,
  category: "memory",
  parameters: z.object({
    scope: z
      .enum(["global", "project", "all"])
      .optional()
      .default("all")
      .describe("Which scope to list"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Filter by tags"),
  }),
  async execute({ scope, tags }) {
    const scopes: Array<"global" | "project"> =
      scope === "all" ? ["global", "project"] : [scope as "global" | "project"];

    const allEntries: MemoryIndexEntry[] = [];

    for (const s of scopes) {
      const index = await loadIndex(s);
      allEntries.push(...index);
    }

    // Filter by tags if provided
    let filtered = allEntries;
    if (tags && tags.length > 0) {
      filtered = allEntries.filter((e) =>
        tags.some((tag) => e.tags.includes(tag)),
      );
    }

    return {
      memories: filtered.map((e) => ({
        id: e.id,
        key: e.key,
        tags: e.tags,
        scope: e.scope,
        createdAt: e.createdAt,
      })),
      total: filtered.length,
    };
  },
});

/**
 * All memory tools
 */
export const memoryTools = [createMemoryTool, recallMemoryTool, listMemoriesTool];
