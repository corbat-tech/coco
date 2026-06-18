import { getAgentMode, type AgentModeId } from "./agent-modes.js";
import type { ToolDefinition } from "../tools/registry.js";
import type { PermissionDecision, PermissionPolicy, RuntimeMode } from "./types.js";

const READ_ONLY_CATEGORIES = new Set(["search", "web", "document"]);
const WRITE_CATEGORIES = new Set(["file", "git", "test", "build", "memory"]);
const READ_ONLY_TOOL_NAMES = new Set([
  "glob",
  "read_file",
  "list_dir",
  "tree",
  "grep",
  "find_in_file",
  "semantic_search",
  "codebase_map",
  "repo_context",
  "lsp_status",
  "lsp_document_symbols",
  "lsp_workspace_symbols",
  "lsp_definition",
  "lsp_references",
  "git_status",
  "git_log",
  "git_diff",
  "git_show",
  "git_branch",
  "recall_memory",
  "list_memories",
  "list_checkpoints",
  "spawnSimpleAgent",
  "checkAgentCapability",
]);
const WRITE_CAPABLE_TOOL_NAMES = new Set(["run_linter"]);
const DESTRUCTIVE_TOOL_NAMES = new Set([
  "bash_exec",
  "write_file",
  "edit_file",
  "delete_file",
  "restore_checkpoint",
  "git_commit",
  "git_push",
]);

function riskForTool(tool: ToolDefinition): PermissionDecision["risk"] {
  if (READ_ONLY_TOOL_NAMES.has(tool.name)) return "read-only";
  if (DESTRUCTIVE_TOOL_NAMES.has(tool.name)) return "destructive";
  if (WRITE_CAPABLE_TOOL_NAMES.has(tool.name)) return "write";
  if (tool.category === "web") return "network";
  if (WRITE_CATEGORIES.has(tool.category)) return "write";
  if (tool.category === "quality") return "write";
  return "read-only";
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  canExecuteTool(mode: RuntimeMode, tool: ToolDefinition): PermissionDecision {
    const definition = getAgentMode(mode as AgentModeId);
    const risk = riskForTool(tool);

    const readOnlyTool =
      READ_ONLY_TOOL_NAMES.has(tool.name) || READ_ONLY_CATEGORIES.has(tool.category);

    if (definition.readOnly && !readOnlyTool) {
      return {
        allowed: false,
        reason: `${definition.label} mode is read-only; ${tool.name} is a ${tool.category} tool.`,
        risk,
      };
    }

    if (risk === "destructive") {
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: `${tool.name} can change repository state and should be confirmed.`,
        risk,
      };
    }

    return { allowed: true, risk };
  }

  canExecuteToolInput(
    mode: RuntimeMode,
    tool: ToolDefinition,
    input: Record<string, unknown>,
  ): PermissionDecision {
    if (tool.name !== "run_linter") {
      return this.canExecuteTool(mode, tool);
    }

    const definition = getAgentMode(mode as AgentModeId);
    const fixEnabled = input["fix"] === true;
    const decision: PermissionDecision = fixEnabled
      ? { allowed: true, risk: "write" }
      : { allowed: true, risk: "read-only" };

    if (definition.readOnly && fixEnabled) {
      return {
        allowed: false,
        reason: `${definition.label} mode is read-only; run_linter with fix=true can modify files.`,
        risk: "write",
      };
    }

    return decision;
  }
}

export function createPermissionPolicy(): PermissionPolicy {
  return new DefaultPermissionPolicy();
}
