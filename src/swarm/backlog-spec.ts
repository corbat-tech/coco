/**
 * Backlog types for the /build-app sprint runner.
 *
 * Intentionally simpler than SwarmBoard — no JSONL, no complex state machine.
 * Just plain JSON-serialisable data structures for sprint planning.
 */

/** Roles available in AgentExecutor (subset that sprint runner uses) */
export type SprintTaskRole = "researcher" | "coder" | "tester" | "reviewer" | "optimizer";

/** A single unit of work assigned to one agent role */
export interface BacklogTask {
  id: string; // e.g. "T001"
  title: string;
  description: string;
  role: SprintTaskRole;
  /** IDs of tasks that must complete before this one starts */
  dependencies: string[];
  acceptanceCriteria: string[];
  /** Rough turn estimate (informative, not enforced) */
  estimatedTurns: number;
}

/** A sprint groups related tasks and has a clear, testable goal */
export interface Sprint {
  id: string; // e.g. "S001"
  name: string;
  goal: string;
  tasks: BacklogTask[];
}

/** Full project plan produced by the spec interview */
export interface BacklogSpec {
  projectName: string;
  description: string;
  /** e.g. ["TypeScript", "Node.js", "Express", "Vitest"] */
  techStack: string[];
  /** Absolute path where the project will be generated */
  outputPath: string;
  sprints: Sprint[];
  /** Minimum quality score (0-100) to consider a sprint done. Default: 85 */
  qualityThreshold: number;
  /** Max retry iterations per sprint before giving up. Default: 3 */
  maxIterationsPerSprint: number;
}

/** Result of executing one sprint */
export interface SprintResult {
  sprintId: string;
  success: boolean;
  testsTotal: number;
  testsPassing: number;
  qualityScore: number;
  durationMs: number;
  /** How many fix-iterate cycles ran before success/give-up */
  iterations: number;
  errors: string[];
}

/**
 * Coerce an unknown string to a valid SprintTaskRole.
 * Returns "coder" for any value that is not a recognised role.
 * Exported so callers (e.g. spec-agent) can import it and it can be tested in isolation.
 */
export function safeRole(role: string): SprintTaskRole {
  const valid: SprintTaskRole[] = ["researcher", "coder", "tester", "reviewer", "optimizer"];
  return valid.includes(role as SprintTaskRole) ? (role as SprintTaskRole) : "coder";
}

/** Aggregated result of the full /build-app run */
export interface BuildResult {
  success: boolean;
  sprintResults: SprintResult[];
  totalTests: number;
  totalDurationMs: number;
  finalQualityScore: number;
  outputPath: string;
}
