/**
 * Visual diff tool for Corbat-Coco
 *
 * Provides visual diff rendering that the agent can invoke from chat.
 * Supports: unstaged, staged, branch comparison, file-to-file, and arbitrary refs.
 */

import { z } from "zod";
import { simpleGit, type SimpleGit } from "simple-git";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import {
  parseDiff,
  renderDiff,
  type ParsedDiff,
  type DiffRenderOptions,
} from "../cli/repl/output/diff-renderer.js";

function getGit(cwd?: string): SimpleGit {
  return simpleGit(cwd ?? process.cwd());
}

/**
 * Show diff — visual rendering of git diffs in the terminal.
 *
 * Modes:
 *   1. Unstaged changes (default): no args
 *   2. Staged changes: { staged: true }
 *   3. Branch comparison: { base: "main" }
 *   4. Between two refs: { base: "main", ref: "feature" }
 *   5. Specific files: { files: ["src/app.ts"] }
 */
export const showDiffTool: ToolDefinition<
  {
    cwd?: string;
    staged?: boolean;
    base?: string;
    ref?: string;
    files?: string[];
    compact?: boolean;
  },
  { filesChanged: number; additions: number; deletions: number; rendered: true }
> = defineTool({
  name: "show_diff",
  description: `Show a visual diff in the terminal with syntax highlighting and box-style formatting.

Modes:
- Unstaged changes: {}
- Staged changes: { "staged": true }
- Branch comparison: { "base": "main" } (compares main...HEAD)
- Between two refs: { "base": "main", "ref": "feature/x" }
- Specific files: { "files": ["src/app.ts"] }
- Combined: { "base": "develop", "files": ["src/app.ts"], "compact": true }

Examples:
- Show all unstaged changes: {}
- Show staged: { "staged": true }
- Compare current branch vs main: { "base": "main" }
- Compare two branches: { "base": "main", "ref": "develop" }
- Diff specific file vs main: { "base": "main", "files": ["src/auth/flow.ts"] }`,
  category: "git",
  parameters: z.object({
    cwd: z.string().optional().describe("Repository directory"),
    staged: z.boolean().optional().default(false).describe("Show staged changes"),
    base: z.string().optional().describe("Base ref for comparison (e.g. 'main', 'HEAD~3', commit hash)"),
    ref: z.string().optional().describe("Target ref (defaults to HEAD if base is set)"),
    files: z.array(z.string()).optional().describe("Limit diff to specific files"),
    compact: z.boolean().optional().default(false).describe("Compact output (hide first hunk header)"),
  }),
  async execute({ cwd, staged, base, ref, files, compact }) {
    const projectDir = cwd ?? process.cwd();
    const git = getGit(projectDir);

    try {
      const args: string[] = [];

      if (base) {
        // Branch/ref comparison
        const target = ref ?? "HEAD";
        args.push(`${base}...${target}`);
      } else if (staged) {
        args.push("--staged");
      }
      // else: default unstaged diff

      if (files && files.length > 0) {
        args.push("--", ...files);
      }

      const rawDiff = await git.diff(args);

      if (!rawDiff.trim()) {
        const mode = base ? `${base}...${ref ?? "HEAD"}` : staged ? "staged" : "unstaged";
        console.log(`\n  No ${mode} changes\n`);
        return { filesChanged: 0, additions: 0, deletions: 0, rendered: true };
      }

      const parsed: ParsedDiff = parseDiff(rawDiff);

      const options: DiffRenderOptions = { compact: compact ?? false };
      renderDiff(parsed, options);

      return {
        filesChanged: parsed.stats.filesChanged,
        additions: parsed.stats.additions,
        deletions: parsed.stats.deletions,
        rendered: true,
      };
    } catch (error) {
      throw new ToolError(
        `Diff failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "show_diff", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

export const diffTools = [showDiffTool];
