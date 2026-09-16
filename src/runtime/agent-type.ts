export const AGENT_TYPES = [
  "explore",
  "plan",
  "test",
  "debug",
  "review",
  "architect",
  "security",
  "tdd",
  "refactor",
  "e2e",
  "docs",
  "database",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];
const TYPES = new Set<string>(AGENT_TYPES);
const LEGACY_ROLES: Readonly<Record<string, AgentType>> = {
  researcher: "explore",
  coder: "debug",
  tester: "test",
  reviewer: "review",
  optimizer: "refactor",
  planner: "plan",
};

/** Shared role resolution for policy and validated delegation tool inputs. */
export function resolveAgentType(input: { type?: unknown; role?: unknown }): AgentType {
  if (typeof input.type === "string" && TYPES.has(input.type)) return input.type as AgentType;
  if (typeof input.role === "string" && Object.hasOwn(LEGACY_ROLES, input.role)) {
    return LEGACY_ROLES[input.role]!;
  }
  return "explore";
}
