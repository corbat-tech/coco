/**
 * Agent mode registry.
 *
 * Modes describe the intended control flow for a turn without changing the
 * provider interface. The REPL can route prompts, tools, and confirmations
 * through these definitions while keeping compatibility with existing plan
 * mode and quality loop behavior.
 */

export type AgentModeId = "ask" | "plan" | "build" | "debug" | "review" | "architect";

export interface AgentModeDefinition {
  id: AgentModeId;
  label: string;
  description: string;
  readOnly: boolean;
  preferredTools: string[];
  requiresVerification: boolean;
}

export const AGENT_MODES: Record<AgentModeId, AgentModeDefinition> = {
  ask: {
    id: "ask",
    label: "Ask",
    description: "Answer questions and explain code without modifying files.",
    readOnly: true,
    preferredTools: ["read_file", "grep", "glob", "codebase_map", "lsp_definition"],
    requiresVerification: false,
  },
  plan: {
    id: "plan",
    label: "Plan",
    description: "Explore and produce an implementation plan with read-only tools.",
    readOnly: true,
    preferredTools: ["read_file", "grep", "glob", "codebase_map", "lsp_workspace_symbols"],
    requiresVerification: false,
  },
  build: {
    id: "build",
    label: "Build",
    description: "Implement code changes and verify them.",
    readOnly: false,
    preferredTools: ["read_file", "edit_file", "write_file", "bash_exec", "run_tests"],
    requiresVerification: true,
  },
  debug: {
    id: "debug",
    label: "Debug",
    description: "Reproduce failures, trace root cause, patch, and verify.",
    readOnly: false,
    preferredTools: ["bash_exec", "read_file", "grep", "lsp_references", "edit_file"],
    requiresVerification: true,
  },
  review: {
    id: "review",
    label: "Review",
    description: "Inspect code quality, security, behavior changes, and test gaps.",
    readOnly: true,
    preferredTools: ["git_diff", "read_file", "grep", "review_code", "calculate_quality"],
    requiresVerification: false,
  },
  architect: {
    id: "architect",
    label: "Architect",
    description: "Design architecture and split work for architect/editor execution.",
    readOnly: true,
    preferredTools: ["codebase_map", "lsp_workspace_symbols", "grep", "create_agent_plan"],
    requiresVerification: false,
  },
};

export function getAgentMode(mode: AgentModeId): AgentModeDefinition {
  return AGENT_MODES[mode];
}

export function listAgentModes(): AgentModeDefinition[] {
  return Object.values(AGENT_MODES);
}

export function isAgentMode(value: string): value is AgentModeId {
  return value in AGENT_MODES;
}
