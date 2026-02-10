/**
 * Authorize Path Tool
 *
 * Allows the LLM to request user authorization for directories
 * outside the project root, via an interactive prompt.
 *
 * The tool shows the user a confirmation dialog with options
 * (session/persistent, read/write). The user decides — the LLM
 * never bypasses the prompt.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { getAllowedPaths, isWithinAllowedPath } from "./allowed-paths.js";

/**
 * System paths that can never be authorized
 */
const BLOCKED_SYSTEM_PATHS = [
  "/etc",
  "/var",
  "/usr",
  "/root",
  "/sys",
  "/proc",
  "/boot",
  "/bin",
  "/sbin",
];

interface AuthorizePathInput {
  path: string;
  reason?: string;
}

interface AuthorizePathOutput {
  authorized: boolean;
  path: string;
  level?: "read" | "write";
  message: string;
}

export const authorizePathTool: ToolDefinition<AuthorizePathInput, AuthorizePathOutput> =
  defineTool({
    name: "authorize_path",
    description: `Request user permission to access a directory outside the project root.

Use this BEFORE attempting file operations on external directories. The user will see
an interactive prompt where they choose to allow or deny access.

Returns whether the path was authorized. If authorized, subsequent file operations
on that directory will succeed.

Examples:
- Need to read config from another project: authorize_path({ path: "/home/user/other-project" })
- Need to access shared libraries: authorize_path({ path: "/opt/shared/libs", reason: "Read shared type definitions" })`,
    category: "config",
    parameters: z.object({
      path: z.string().min(1).describe("Absolute path to the directory to authorize"),
      reason: z.string().optional().describe("Why access is needed (shown to user for context)"),
    }),
    async execute({ path: dirPath, reason }) {
      const absolute = path.resolve(dirPath);

      // Check if already authorized
      if (isWithinAllowedPath(absolute, "read")) {
        return {
          authorized: true,
          path: absolute,
          message: "Path is already authorized.",
        };
      }

      // Block system paths
      for (const blocked of BLOCKED_SYSTEM_PATHS) {
        const normalizedBlocked = path.normalize(blocked);
        if (absolute === normalizedBlocked || absolute.startsWith(normalizedBlocked + path.sep)) {
          return {
            authorized: false,
            path: absolute,
            message: `System path '${blocked}' cannot be authorized for security reasons.`,
          };
        }
      }

      // Check if within project directory (already accessible)
      const cwd = process.cwd();
      if (absolute === path.normalize(cwd) || absolute.startsWith(path.normalize(cwd) + path.sep)) {
        return {
          authorized: true,
          path: absolute,
          message: "Path is within the project directory — already accessible.",
        };
      }

      // Validate directory exists
      try {
        const stat = await fs.stat(absolute);
        if (!stat.isDirectory()) {
          return {
            authorized: false,
            path: absolute,
            message: `Not a directory: ${absolute}`,
          };
        }
      } catch {
        return {
          authorized: false,
          path: absolute,
          message: `Directory not found: ${absolute}`,
        };
      }

      // Check if already in allowed paths (duplicate check after validation)
      const existing = getAllowedPaths();
      if (existing.some((e) => path.normalize(e.path) === path.normalize(absolute))) {
        return {
          authorized: true,
          path: absolute,
          message: "Path is already authorized.",
        };
      }

      // Delegate to the interactive prompt
      // Import dynamically to avoid circular dependency with CLI modules
      const { promptAllowPath } = await import("../cli/repl/allow-path-prompt.js");

      const wasAuthorized = await promptAllowPath(absolute);

      if (wasAuthorized) {
        return {
          authorized: true,
          path: absolute,
          message: `Access granted to ${absolute}.${reason ? ` Reason: ${reason}` : ""}`,
        };
      }

      return {
        authorized: false,
        path: absolute,
        message: "User denied access to this directory.",
      };
    },
  });

/**
 * All authorize-path tools (for registry)
 */
export const authorizePathTools = [authorizePathTool];
