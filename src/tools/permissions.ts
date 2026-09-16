/**
 * Permissions management tool
 *
 * Allows the LLM to modify tool permissions conversationally.
 * The user says "block git push" or "allow npm install" in natural language,
 * Coco invokes this tool, and the confirmation system shows the user
 * what will change (with risk info) before applying.
 *
 * The tool itself only validates and returns risk info.
 * The actual trust modification is done by agent-loop.ts after
 * the user confirms via the standard confirmation UI.
 *
 * Supports two scopes:
 * - "project" (default): per-project overrides (deny overrides global allow)
 * - "global": affects all projects
 */

import { z } from "zod";
import { ToolError } from "../utils/errors.js";
import { defineTool, type ToolDefinition } from "./registry.js";
import {
  RECOMMENDED_GLOBAL,
  RECOMMENDED_PROJECT,
  ALWAYS_ASK,
  RECOMMENDED_DENY,
} from "../cli/repl/recommended-permissions.js";

// ============================================================================
// Risk Assessment
// ============================================================================

export type RiskLevel = "low" | "medium" | "high" | "unknown";

/**
 * Assess the risk level of a permission pattern based on recommended lists.
 */
export function getRiskLevel(pattern: string): RiskLevel {
  if (RECOMMENDED_DENY.includes(pattern)) return "high";
  if (ALWAYS_ASK.includes(pattern)) return "medium";
  if (RECOMMENDED_GLOBAL.includes(pattern) || RECOMMENDED_PROJECT.includes(pattern)) return "low";
  return "unknown";
}

/**
 * Get a human-readable risk description for a pattern.
 */
export function getRiskDescription(pattern: string): string {
  const level = getRiskLevel(pattern);
  switch (level) {
    case "high":
      return "HIGH — Dangerous pattern (destructive/irreversible)";
    case "medium":
      return "MEDIUM — Involves network, deletion, or remote operations";
    case "low":
      return "LOW — Standard safe pattern";
    case "unknown":
      return "UNKNOWN — Custom pattern, not in recommended lists";
  }
}

/**
 * Get a description of what the action will do.
 */
export function getEffectDescription(
  action: "allow" | "deny" | "ask",
  pattern: string,
  scope?: "global" | "project",
): string {
  if (
    (pattern.startsWith("bash:") && !pattern.startsWith("bash:exact:")) ||
    pattern === "bash_exec" ||
    pattern === "bash_background"
  ) {
    return "Legacy shell prefix grants are inactive; only exact call approvals authorize shell execution";
  }
  const scopeLabel = scope === "global" ? " (all projects)" : " (this project)";
  switch (action) {
    case "allow":
      return `Coco will auto-approve ${pattern} without asking${scopeLabel}`;
    case "deny":
    case "ask":
      return `Coco will ask for confirmation before running ${pattern}${scopeLabel}`;
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

interface ManagePermissionsInput {
  action: "allow" | "deny" | "ask";
  patterns: string[];
  scope?: "global" | "project";
  reason?: string;
}

interface PermissionChange {
  pattern: string;
  action: string;
  risk: string;
  effect: string;
}

interface ManagePermissionsOutput {
  changes: PermissionChange[];
  summary: string;
}

export const managePermissionsTool: ToolDefinition<
  ManagePermissionsInput,
  ManagePermissionsOutput
> = defineTool({
  name: "manage_permissions",
  description: `Manage tool permission settings. Add or remove patterns from the auto-approved list.

Use this when the user asks to allow, block, deny, or change permissions for specific tools or commands.

Actions:
- "allow": Auto-approve the pattern (no confirmation prompt)
- "deny": Remove from auto-approved (will always ask for confirmation)
- "ask": Same as deny — always prompt before executing

Scope:
- "project" (default): Only affects the current project.
  - deny: adds to project deny list (overrides global allow for this project only)
  - allow: adds to project allow list
- "global": Affects all projects.
  - deny: removes from the global allow list entirely
  - allow: adds to the global allow list

Pattern format:
- Coco tools: "write_file", "edit_file", "git_push", "delete_file"
- Shell approvals can only be created by confirming the visible shell call. This tool can revoke them with deny/ask using their bash:exact:<fingerprint> keys.
- Legacy bash command/subcommand prefixes no longer authorize shell execution. Approve the exact call in its confirmation prompt.

Examples:
- Ask before native git push: { "action": "ask", "patterns": ["git_push"], "scope": "project" }
- Allow native edits in this project: { "action": "allow", "patterns": ["edit_file"], "scope": "project" }`,
  category: "config",
  parameters: z.object({
    action: z.enum(["allow", "deny", "ask"]).describe("What to do with these patterns"),
    patterns: z
      .array(z.string().min(1))
      .min(1)
      .describe("Tool patterns to modify (e.g. 'git_push', 'write_file')"),
    scope: z
      .enum(["global", "project"])
      .default("project")
      .describe("Scope: 'project' (default) affects only current project, 'global' affects all"),
    reason: z.string().optional().describe("Why this change is being made (shown to user)"),
  }),
  async execute({ action, patterns, scope, reason }) {
    const effectiveScope = scope ?? "project";
    if (
      action === "allow" &&
      patterns.some(
        (pattern) =>
          pattern.startsWith("bash:") || pattern === "bash_exec" || pattern === "bash_background",
      )
    ) {
      throw new ToolError(
        "Shell permissions can only be granted in the confirmation prompt for the visible command.",
        { tool: "manage_permissions" },
      );
    }

    // Validate and assess risk for each pattern
    const changes: PermissionChange[] = patterns.map((pattern) => ({
      pattern,
      action,
      risk: getRiskDescription(pattern),
      effect: getEffectDescription(action, pattern, effectiveScope),
    }));

    // Build summary
    const verb = action === "allow" ? "auto-approve" : "require confirmation for";
    const scopeLabel = effectiveScope === "global" ? " (global)" : " (project)";
    const patternList = patterns.join(", ");
    const reasonSuffix = reason ? ` — ${reason}` : "";
    const summary = `Will ${verb}: ${patternList}${scopeLabel}${reasonSuffix}. ${changes.map((change) => change.effect).join("; ")}`;

    return { changes, summary };
  },
});

/**
 * All permissions tools (for registry)
 */
export const permissionsTools = [managePermissionsTool];
