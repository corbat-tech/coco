/**
 * Status command - Show current project status and progress
 */

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import type { CocoConfig } from "../../config/schema.js";

/**
 * Options for status command
 */
export interface StatusOptions {
  cwd?: string;
  verbose?: boolean;
  detailed?: boolean;
  json?: boolean;
}

/**
 * Phase status type
 */
export type PhaseStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * Phase names
 */
export type PhaseName = "converge" | "orchestrate" | "complete" | "output" | "idle";

/**
 * Project state
 */
export interface ProjectState {
  name: string;
  currentPhase: PhaseName;
  progress: number;
  currentTask?: {
    id: string;
    title: string;
    iteration: number;
    score: number;
  };
  sprint?: {
    id: string;
    name: string;
    completed: number;
    total: number;
    avgQuality: number;
    tasks: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed";
      score?: number;
    }>;
  };
  metrics?: {
    averageQuality: number;
    testCoverage: number;
    securityIssues: number;
  };
  checkpoints: string[];
  lastCheckpoint?: {
    timestamp: string;
    canResume: boolean;
  };
}

/**
 * Status result
 */
export interface StatusResult {
  project: string;
  phase: PhaseName;
  progress: number;
  sprint?: ProjectState["sprint"];
  metrics?: ProjectState["metrics"];
  checkpoints: string[];
}

/**
 * Register status command
 */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current project status and progress")
    .option("-d, --detailed", "Show detailed status")
    .option("-v, --verbose", "Show verbose output including checkpoints")
    .option("--json", "Output as JSON")
    .action(async (options: StatusOptions) => {
      try {
        await runStatus({ ...options, cwd: process.cwd() });
      } catch (error) {
        p.log.error(
          error instanceof Error ? error.message : "An error occurred"
        );
        process.exit(1);
      }
    });
}

/**
 * Run status command programmatically
 */
export async function runStatus(options: StatusOptions = {}): Promise<StatusResult> {
  const cwd = options.cwd || process.cwd();

  // Find configuration
  const configPath = await findConfigPath(cwd);

  if (!configPath) {
    p.log.warning("No project found. Run 'coco init' first.");
    return {
      project: "",
      phase: "idle",
      progress: 0,
      checkpoints: [],
    };
  }

  const config = await loadConfig(configPath);

  // Load state
  const state = await loadProjectState(cwd, config);

  // Output as JSON if requested
  if (options.json) {
    console.log(JSON.stringify(state, null, 2));
    return {
      project: state.name,
      phase: state.currentPhase,
      progress: state.progress,
      sprint: state.sprint,
      metrics: state.metrics,
      checkpoints: state.checkpoints,
    };
  }

  // Display status
  p.log.info(chalk.bold(`Project: ${state.name}`));
  p.log.info(`Phase: ${formatPhaseStatus(state.currentPhase, getPhaseStatusForPhase(state.currentPhase))}`);
  p.log.info(`Progress: ${formatProgress(state.progress)}`);

  // Show sprint info
  if (state.sprint) {
    p.log.info(`Sprint: ${state.sprint.name} (${state.sprint.completed}/${state.sprint.total} tasks)`);
  }

  // Show quality metrics if verbose
  if (options.verbose && state.metrics) {
    p.log.info(`Average Quality: ${state.metrics.averageQuality}/100`);
    p.log.info(`Test Coverage: ${state.metrics.testCoverage}%`);
    p.log.info(`Security Issues: ${state.metrics.securityIssues}`);
  }

  // Show checkpoints if verbose
  if (options.verbose && state.checkpoints.length > 0) {
    p.log.info(`Checkpoints: ${state.checkpoints.length} available (checkpoint: ${state.checkpoints[0]})`);
  }

  return {
    project: state.name,
    phase: state.currentPhase,
    progress: state.progress,
    sprint: state.sprint,
    metrics: state.metrics,
    checkpoints: state.checkpoints,
  };
}

/**
 * Format phase status with icons
 */
export function formatPhaseStatus(phase: string, status: PhaseStatus): string {
  const icons: Record<PhaseStatus, string> = {
    pending: "○",
    in_progress: "→",
    completed: "✓",
    failed: "✗",
  };

  const colors: Record<PhaseStatus, (s: string) => string> = {
    pending: chalk.gray,
    in_progress: chalk.yellow,
    completed: chalk.green,
    failed: chalk.red,
  };

  const icon = icons[status];
  const color = colors[status];
  const phaseName = phase.charAt(0).toUpperCase() + phase.slice(1);

  return color(`${icon} ${phaseName}`);
}

/**
 * Calculate progress percentage
 */
export function calculateProgress(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Format progress bar
 */
function formatProgress(progress: number): string {
  const percentage = Math.round(progress * 100);
  const barLength = 20;
  const filled = Math.round(barLength * progress);
  const empty = barLength - filled;
  const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(empty));
  return `[${bar}] ${percentage}%`;
}

/**
 * Get phase status based on current phase
 */
function getPhaseStatusForPhase(phase: PhaseName): PhaseStatus {
  if (phase === "idle") return "pending";
  return "in_progress";
}

/**
 * Load project state from disk
 */
async function loadProjectState(cwd: string, config: CocoConfig): Promise<ProjectState> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const statePath = path.join(cwd, ".coco", "state.json");
  const backlogPath = path.join(cwd, ".coco", "planning", "backlog.json");
  const checkpointDir = path.join(cwd, ".coco", "checkpoints");

  let currentPhase: PhaseName = "idle";
  let metrics: ProjectState["metrics"] | undefined;
  let sprint: ProjectState["sprint"] | undefined;
  let checkpoints: string[] = [];

  // Load state
  try {
    const stateContent = await fs.readFile(statePath, "utf-8");
    const stateData = JSON.parse(stateContent);
    currentPhase = stateData.currentPhase || "idle";
    metrics = stateData.metrics;
  } catch {
    // No state file yet
  }

  // Load backlog for sprint info
  try {
    const backlogContent = await fs.readFile(backlogPath, "utf-8");
    const backlogData = JSON.parse(backlogContent);

    if (backlogData.currentSprint) {
      const tasks = backlogData.tasks || [];
      const completedTasks = tasks.filter((t: { status: string }) => t.status === "completed");

      sprint = {
        id: backlogData.currentSprint.id,
        name: backlogData.currentSprint.name,
        completed: completedTasks.length,
        total: tasks.length,
        avgQuality: 0,
        tasks: tasks.map((t: { id: string; title?: string; status: string; score?: number }) => ({
          id: t.id,
          title: t.title || t.id,
          status: t.status as "pending" | "in_progress" | "completed",
          score: t.score,
        })),
      };
    }
  } catch {
    // No backlog yet
  }

  // Load checkpoints
  try {
    const files = await fs.readdir(checkpointDir);
    checkpoints = files
      .filter((f: string) => f.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    // No checkpoints yet
  }

  const totalTasks = sprint?.total || 0;
  const completedTasks = sprint?.completed || 0;
  const progress = totalTasks > 0 ? completedTasks / totalTasks : 0;

  return {
    name: config.project?.name || "my-project",
    currentPhase,
    progress,
    sprint,
    metrics,
    checkpoints,
    lastCheckpoint: checkpoints.length > 0
      ? {
          timestamp: new Date().toISOString(),
          canResume: true,
        }
      : undefined,
  };
}
