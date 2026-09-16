/**
 * Authorize Path Tool
 *
 * Checks canonical read authority. Interactive permission requests belong to
 * the shared REPL boundary, so embedded/headless execution never opens a dialog.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { resolvePathSecurely } from "./file-path-policy.js";
import { ToolError } from "../utils/errors.js";

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
    description: `Check read access to a directory outside the project root. If permission is missing, interactive Coco can offer a canonical path grant and retry; non-interactive callers receive an access error without a prompt.

The tool itself never grants access. An authorized result means read access is available; writes still require a write grant. Use /allow-path to grant access explicitly.`,
    category: "config",
    parameters: z.object({
      path: z.string().min(1).describe("Absolute path to the directory to authorize"),
      reason: z.string().optional().describe("Why access is needed (shown to user for context)"),
    }),
    async execute({ path: dirPath, reason }) {
      if (dirPath.includes("\0"))
        throw new ToolError("Path contains invalid characters", { tool: "authorize_path" });
      const absolute = path.resolve(dirPath);
      const blockedPath = (candidate: string) =>
        BLOCKED_SYSTEM_PATHS.find(
          (blocked) => candidate === blocked || candidate.startsWith(blocked + path.sep),
        );
      const blockedResult = (candidate: string): AuthorizePathOutput => ({
        authorized: false,
        path: candidate,
        message: "System path cannot be authorized for security reasons.",
      });
      if (blockedPath(absolute)) return blockedResult(absolute);
      let canonical: string;
      try {
        canonical = await fs.realpath(absolute);
        if (blockedPath(canonical)) return blockedResult(canonical);
        if (!(await fs.stat(canonical)).isDirectory()) {
          return { authorized: false, path: canonical, message: `Not a directory: ${canonical}` };
        }
      } catch (error) {
        return {
          authorized: false,
          path: absolute,
          message:
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? `Directory not found: ${absolute}`
              : `Cannot access directory: ${absolute}`,
        };
      }
      try {
        await resolvePathSecurely(absolute, "read");
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        throw new ToolError(
          `Directory requires read permission.${reason ? ` Reason: ${reason}.` : ""} Use /allow-path ${canonical} to grant access.`,
          { tool: "authorize_path", cause: error },
        );
      }
      return {
        authorized: true,
        path: canonical,
        message: `Directory is already accessible with current read permissions.${reason ? ` Reason: ${reason}` : ""}`,
      };
    },
  });

/**
 * All authorize-path tools (for registry)
 */
export const authorizePathTools = [authorizePathTool];
