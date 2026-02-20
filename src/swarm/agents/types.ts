/**
 * Swarm Agent Types
 *
 * Defines the roles, gates, and agent definitions for the swarm orchestrator.
 */

/**
 * Roles that swarm agents can take on
 */
export type SwarmAgentRole =
  | "pm"
  | "architect"
  | "best-practices"
  | "tdd-developer"
  | "qa"
  | "external-reviewer"
  | "security-auditor"
  | "integrator";

/**
 * Gates in the swarm pipeline that must be passed
 */
export type SwarmGate =
  | "plan"
  | "acceptance-test-red"
  | "test"
  | "coverage"
  | "review"
  | "integration"
  | "global-score";

/**
 * Definition of a swarm agent
 */
export interface SwarmAgentDefinition {
  role: SwarmAgentRole;
  goal: string;
  backstory: string;
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  /** Max tokens for summary returned to orchestrator (~2000) */
  contextBudget: number;
}
