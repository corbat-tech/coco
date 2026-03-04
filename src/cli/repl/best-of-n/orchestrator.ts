/**
 * Best-of-N Solution Orchestrator
 *
 * Runs N parallel solution attempts in isolated git worktrees,
 * evaluates each with the quality scorer, and selects the best.
 */

import { randomUUID } from "node:crypto";
import { WorktreeManager } from "../worktree/manager.js";
import { createQualityEvaluator } from "../../../quality/evaluator.js";
import { getLogger } from "../../../utils/logger.js";
import type { BestOfNConfig, BestOfNResult, SolutionAttempt, BestOfNCallbacks } from "./types.js";

const DEFAULT_CONFIG: BestOfNConfig = {
  attempts: 3,
  task: "",
  autoSelect: true,
  autoMerge: false,
  timeoutMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Execute a task function within a worktree directory.
 * The executor receives the worktree path and task, returning the agent output.
 */
export type TaskExecutor = (
  worktreePath: string,
  task: string,
  signal: AbortSignal,
) => Promise<{ output: string; filesChanged: string[] }>;

/**
 * Run N parallel solution attempts and return the best.
 *
 * @param projectRoot - Root directory of the git project
 * @param executor - Function that executes the task in a given worktree
 * @param config - Configuration (attempts, task, etc.)
 * @param callbacks - Optional progress callbacks
 * @returns Result with all attempts and the winner
 */
export async function runBestOfN(
  projectRoot: string,
  executor: TaskExecutor,
  config: Partial<BestOfNConfig> & { task: string },
  callbacks: BestOfNCallbacks = {},
): Promise<BestOfNResult> {
  const cfg: BestOfNConfig = { ...DEFAULT_CONFIG, ...config };
  const logger = getLogger();
  const startTime = Date.now();

  if (cfg.attempts < 2) {
    return {
      success: false,
      attempts: [],
      winner: null,
      totalDurationMs: 0,
      error: "Best-of-N requires at least 2 attempts",
    };
  }

  if (cfg.attempts > 10) {
    return {
      success: false,
      attempts: [],
      winner: null,
      totalDurationMs: 0,
      error: "Best-of-N supports at most 10 attempts",
    };
  }

  const worktreeManager = new WorktreeManager(projectRoot);
  const attempts: SolutionAttempt[] = [];

  try {
    // Phase 1: Create worktrees for all attempts
    logger.info(`Best-of-N: Creating ${cfg.attempts} worktrees...`);

    const worktrees = await Promise.all(
      Array.from({ length: cfg.attempts }, (_, i) =>
        worktreeManager.create(`best-of-n-${i + 1}`, {
          branchPrefix: "coco-best-of-n",
        }),
      ),
    );

    // Initialize attempt objects
    for (let i = 0; i < cfg.attempts; i++) {
      const wt = worktrees[i]!;
      attempts.push({
        id: randomUUID(),
        index: i + 1,
        worktreeId: wt.id,
        worktreePath: wt.path,
        branch: wt.branch,
        status: "pending",
        score: null,
        output: "",
        filesChanged: [],
        durationMs: 0,
      });
    }

    // Phase 2: Execute task in all worktrees in parallel
    logger.info(`Best-of-N: Running ${cfg.attempts} parallel attempts...`);

    await Promise.all(
      attempts.map(async (attempt) => {
        const attemptStart = Date.now();
        attempt.status = "running";
        callbacks.onAttemptStart?.(attempt);

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), cfg.timeoutMs);

        try {
          const result = await executor(attempt.worktreePath, cfg.task, abortController.signal);
          attempt.output = result.output;
          attempt.filesChanged = result.filesChanged;
          attempt.durationMs = Date.now() - attemptStart;
          attempt.status = "evaluating";
          callbacks.onEvaluating?.(attempt);

          // Phase 3: Evaluate quality
          try {
            const evaluator = createQualityEvaluator(attempt.worktreePath);
            const evaluation = await evaluator.evaluate();
            attempt.score = evaluation.scores.overall;
          } catch {
            // If quality eval fails, assign score 0
            attempt.score = 0;
          }

          attempt.status = "completed";
          callbacks.onAttemptComplete?.(attempt);
        } catch (error) {
          attempt.durationMs = Date.now() - attemptStart;
          attempt.status = "failed";
          attempt.error = error instanceof Error ? error.message : String(error);
          attempt.score = 0;
          callbacks.onAttemptFail?.(attempt);
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    // Phase 4: Select the winner (highest score)
    const completedAttempts = attempts.filter((a) => a.status === "completed");

    if (completedAttempts.length === 0) {
      return {
        success: false,
        attempts,
        winner: null,
        totalDurationMs: Date.now() - startTime,
        error: "All attempts failed",
      };
    }

    // Sort by score descending
    completedAttempts.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = completedAttempts[0]!;
    winner.status = "selected";
    callbacks.onWinnerSelected?.(winner);

    // Mark non-winners as discarded
    for (const attempt of attempts) {
      if (attempt.id !== winner.id && attempt.status === "completed") {
        attempt.status = "discarded";
      }
    }

    logger.info(`Best-of-N: Winner is attempt #${winner.index} with score ${winner.score}`);

    // Phase 5: Cleanup non-winner worktrees
    for (const attempt of attempts) {
      if (attempt.id !== winner.id) {
        try {
          await worktreeManager.remove(attempt.worktreeId, true);
        } catch {
          // Best effort cleanup
        }
      }
    }

    // Auto-merge if configured
    if (cfg.autoMerge) {
      const mergeResult = await worktreeManager.merge(winner.worktreeId, {
        strategy: "merge",
        message: `Best-of-N winner (attempt #${winner.index}, score: ${winner.score})`,
      });

      if (!mergeResult.success) {
        logger.warn(`Best-of-N: Auto-merge failed: ${mergeResult.error}`);
      }
    }

    return {
      success: true,
      attempts,
      winner,
      totalDurationMs: Date.now() - startTime,
    };
  } catch (error) {
    // Cleanup all worktrees on error
    await worktreeManager.cleanupAll().catch(() => {});

    return {
      success: false,
      attempts,
      winner: null,
      totalDurationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format a Best-of-N result as a human-readable summary
 */
export function formatBestOfNResult(result: BestOfNResult): string {
  const lines: string[] = [];

  lines.push(`\n## Best-of-N Results (${result.attempts.length} attempts)\n`);

  if (!result.success) {
    lines.push(`Error: ${result.error}\n`);
    return lines.join("\n");
  }

  // Sort by score descending for display
  const sorted = [...result.attempts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const attempt of sorted) {
    const medal = attempt.status === "selected" ? "🏆" : attempt.status === "failed" ? "❌" : "  ";
    const score = attempt.score !== null ? `${attempt.score.toFixed(1)}/100` : "N/A";
    const duration = (attempt.durationMs / 1000).toFixed(1);
    const files = attempt.filesChanged.length;

    lines.push(
      `${medal} #${attempt.index}: Score ${score} | ${files} files | ${duration}s${attempt.error ? ` (Error: ${attempt.error})` : ""}`,
    );
  }

  lines.push(`\nTotal time: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

  if (result.winner) {
    lines.push(
      `Winner: Attempt #${result.winner.index} (Score: ${result.winner.score?.toFixed(1)})`,
    );
  }

  return lines.join("\n");
}
