/**
 * Checkpoint tools for Corbat-Coco
 * Create and restore code snapshots using git stash
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

const fs = await import("node:fs/promises");
const crypto = await import("node:crypto");

/**
 * Checkpoint metadata file
 */
const CHECKPOINT_FILE = ".coco/checkpoints.json";

/**
 * Maximum checkpoints to keep
 */
const DEFAULT_MAX_CHECKPOINTS = 50;

/**
 * Checkpoint prefix for git stash messages
 */
const STASH_PREFIX = "coco-cp";

/**
 * Checkpoint entry
 */
export interface Checkpoint {
  id: string;
  description: string;
  timestamp: string;
  stashRef?: string;
  fileCount: number;
  files: string[];
}

/**
 * Ensure .coco directory exists
 */
async function ensureCocoDir(): Promise<void> {
  await fs.mkdir(".coco", { recursive: true });
}

/**
 * Load checkpoint metadata
 */
async function loadCheckpoints(): Promise<Checkpoint[]> {
  try {
    const content = await fs.readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(content) as Checkpoint[];
  } catch {
    return [];
  }
}

/**
 * Save checkpoint metadata
 */
async function saveCheckpoints(checkpoints: Checkpoint[]): Promise<void> {
  await ensureCocoDir();
  await fs.writeFile(
    CHECKPOINT_FILE,
    JSON.stringify(checkpoints, null, 2),
    "utf-8",
  );
}

/**
 * Execute a git command
 */
async function execGit(args: string[]): Promise<string> {
  const { execaCommand } = await import("execa");
  try {
    const result = await execaCommand(`git ${args.join(" ")}`, {
      cwd: process.cwd(),
      timeout: 30000,
    });
    return result.stdout;
  } catch (error) {
    throw new ToolError(
      `Git command failed: git ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}`,
      { tool: "checkpoint" },
    );
  }
}

/**
 * Get list of changed files
 */
async function getChangedFiles(): Promise<string[]> {
  try {
    const status = await execGit(["status", "--porcelain"]);
    return status
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim());
  } catch {
    return [];
  }
}

/**
 * Create checkpoint tool
 */
export const createCheckpointTool: ToolDefinition<
  { description: string },
  {
    id: string;
    description: string;
    fileCount: number;
    files: string[];
    method: "stash" | "clean";
  }
> = defineTool({
  name: "create_checkpoint",
  description: `Create a checkpoint (snapshot) of current changes for easy rollback.
Uses git stash internally. If no changes exist, creates a reference point at current HEAD.

Examples:
- Before refactoring: { "description": "before auth refactor" }
- Save progress: { "description": "working login implementation" }`,
  category: "memory",
  parameters: z.object({
    description: z
      .string()
      .min(1)
      .max(200)
      .describe("Description of this checkpoint"),
  }),
  async execute({ description }) {
    const id = crypto.randomUUID().slice(0, 8);
    const timestamp = new Date().toISOString();
    const stashMessage = `${STASH_PREFIX}-${id}-${description.replace(/\s+/g, "-").slice(0, 50)}`;

    // Get changed files
    const changedFiles = await getChangedFiles();

    let method: "stash" | "clean";

    if (changedFiles.length > 0) {
      // Stage all and stash
      await execGit(["add", "-A"]);
      await execGit(["stash", "push", "-m", stashMessage]);
      // Immediately apply (keep changes in working tree, stash stays in stack)
      await execGit(["stash", "apply"]);
      method = "stash";
    } else {
      // No changes, just record current state
      method = "clean";
    }

    // Save checkpoint metadata
    const checkpoints = await loadCheckpoints();

    const checkpoint: Checkpoint = {
      id,
      description,
      timestamp,
      stashRef: changedFiles.length > 0 ? stashMessage : undefined,
      fileCount: changedFiles.length,
      files: changedFiles.slice(0, 50), // Limit stored file list
    };

    checkpoints.unshift(checkpoint);

    // Trim old checkpoints
    if (checkpoints.length > DEFAULT_MAX_CHECKPOINTS) {
      checkpoints.splice(DEFAULT_MAX_CHECKPOINTS);
    }

    await saveCheckpoints(checkpoints);

    return {
      id,
      description,
      fileCount: changedFiles.length,
      files: changedFiles.slice(0, 20),
      method,
    };
  },
});

/**
 * Restore checkpoint tool
 */
export const restoreCheckpointTool: ToolDefinition<
  { id: string },
  {
    id: string;
    description: string;
    restored: boolean;
    message: string;
  }
> = defineTool({
  name: "restore_checkpoint",
  description: `Restore a previously created checkpoint, reverting changes to that state.

Examples:
- Restore by ID: { "id": "a1b2c3d4" }`,
  category: "memory",
  parameters: z.object({
    id: z.string().min(1).describe("Checkpoint ID to restore"),
  }),
  async execute({ id }) {
    const checkpoints = await loadCheckpoints();
    const checkpoint = checkpoints.find((cp) => cp.id === id);

    if (!checkpoint) {
      throw new ToolError(`Checkpoint '${id}' not found`, {
        tool: "restore_checkpoint",
      });
    }

    if (!checkpoint.stashRef) {
      return {
        id: checkpoint.id,
        description: checkpoint.description,
        restored: false,
        message:
          "This checkpoint was created with no changes (clean state). Nothing to restore.",
      };
    }

    // Find the stash by message
    try {
      const stashList = await execGit(["stash", "list"]);
      const stashLines = stashList.split("\n");
      let stashIndex = -1;

      for (const line of stashLines) {
        if (line.includes(checkpoint.stashRef ?? "")) {
          const match = line.match(/stash@\{(\d+)\}/);
          if (match?.[1]) {
            stashIndex = parseInt(match[1], 10);
            break;
          }
        }
      }

      if (stashIndex === -1) {
        return {
          id: checkpoint.id,
          description: checkpoint.description,
          restored: false,
          message:
            "Stash for this checkpoint was not found (may have been dropped).",
        };
      }

      // Discard current changes and apply stash
      await execGit(["checkout", "."]);
      await execGit(["clean", "-fd"]);
      await execGit(["stash", "apply", `stash@{${stashIndex}}`]);

      return {
        id: checkpoint.id,
        description: checkpoint.description,
        restored: true,
        message: `Restored checkpoint '${checkpoint.description}' (${checkpoint.fileCount} files)`,
      };
    } catch (error) {
      throw new ToolError(
        `Failed to restore checkpoint: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "restore_checkpoint" },
      );
    }
  },
});

/**
 * List checkpoints tool
 */
export const listCheckpointsTool: ToolDefinition<
  { limit?: number },
  { checkpoints: Checkpoint[]; total: number }
> = defineTool({
  name: "list_checkpoints",
  description: `List all available checkpoints.

Examples:
- List all: {}
- Limited: { "limit": 5 }`,
  category: "memory",
  parameters: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Maximum checkpoints to return"),
  }),
  async execute({ limit }) {
    const checkpoints = await loadCheckpoints();
    const limited = checkpoints.slice(0, limit);

    return {
      checkpoints: limited,
      total: checkpoints.length,
    };
  },
});

/**
 * All checkpoint tools
 */
export const checkpointTools = [
  createCheckpointTool,
  restoreCheckpointTool,
  listCheckpointsTool,
];
