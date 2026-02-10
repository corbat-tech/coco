/**
 * Ship Skill Type Definitions
 *
 * Types for the /ship workflow — the complete release pipeline
 * from code review through merge, tag, and GitHub release.
 */

import { z } from "zod";

// ============================================================================
// Version & Project Detection
// ============================================================================

/** Semantic version bump classification */
export type VersionBump = "patch" | "minor" | "major";

/** Detected project stack */
export type ProjectStack = "node" | "rust" | "python" | "go" | "java" | "unknown";

/** Version file location and format */
export interface VersionFile {
  path: string;
  stack: ProjectStack;
  currentVersion: string;
  /** Field name within the file (e.g., "version") */
  field: string;
}

/** Changelog file metadata */
export interface ChangelogFile {
  path: string;
  format: "keep-a-changelog" | "conventional" | "custom";
}

/** Detected CI system */
export interface CISystem {
  type: "github-actions" | "gitlab-ci" | "circle-ci" | "none";
  workflowFiles: string[];
  hasCodeQL: boolean;
  hasLinting: boolean;
}

/** Project profile gathered during preflight */
export interface ProjectProfile {
  stack: ProjectStack;
  versionFile: VersionFile | null;
  changelog: ChangelogFile | null;
  ci: CISystem;
  defaultBranch: string;
  currentBranch: string;
  hasUncommittedChanges: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "pip" | "go" | null;
  lintCommand: string | null;
  testCommand: string | null;
  buildCommand: string | null;
}

// ============================================================================
// Ship Step Types
// ============================================================================

/** Ship step status */
export type ShipStepStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "cancelled";

/** Individual step result */
export interface ShipStepResult {
  step: string;
  status: ShipStepStatus;
  message: string;
  details?: string;
  durationMs: number;
}

/** Overall ship workflow result */
export interface ShipResult {
  success: boolean;
  steps: ShipStepResult[];
  version?: string;
  prUrl?: string;
  prNumber?: number;
  releaseUrl?: string;
  tagName?: string;
  error?: string;
  abortedAt?: string;
}

// ============================================================================
// Ship Context (shared across steps)
// ============================================================================

/** Mutable context passed through the step pipeline */
export interface ShipContext {
  cwd: string;
  profile: ProjectProfile;
  options: ShipOptions;
  /** Version determined during the version step */
  newVersion?: string;
  /** Branch name created/used */
  branchName?: string;
  /** Commit message used */
  commitMessage?: string;
  /** PR number after creation */
  prNumber?: number;
  /** PR URL after creation */
  prUrl?: string;
  /** Step results accumulated */
  steps: ShipStepResult[];
}

// ============================================================================
// Ship Options (parsed from CLI args)
// ============================================================================

/** Parsed /ship arguments */
export interface ShipOptions {
  skipTests: boolean;
  skipReview: boolean;
  draft: boolean;
  forceBump?: VersionBump;
  noVersion: boolean;
  noChangelog: boolean;
  baseBranch?: string;
  commitMessage?: string;
}

// ============================================================================
// Ship Configuration (Zod schema for .corbat.yml)
// ============================================================================

export const ShipConfigSchema = z.object({
  /** Default base branch for PRs */
  defaultBaseBranch: z.string().default("main"),
  /** Auto-detect version bump from commit history */
  autoDetectBump: z.boolean().default(true),
  /** Use squash merge for PRs */
  squashMerge: z.boolean().default(true),
  /** Delete feature branch after merge */
  deleteBranchAfterMerge: z.boolean().default(true),
  /** Create PRs as draft by default */
  draftPr: z.boolean().default(false),
  /** CI check timeout in ms (default 10 minutes) */
  ciCheckTimeoutMs: z.number().default(600_000),
  /** CI check poll interval in ms (default 15 seconds) */
  ciCheckPollMs: z.number().default(15_000),
});

export type ShipConfig = z.infer<typeof ShipConfigSchema>;

/** Default ship configuration */
export const DEFAULT_SHIP_CONFIG: ShipConfig = ShipConfigSchema.parse({});
