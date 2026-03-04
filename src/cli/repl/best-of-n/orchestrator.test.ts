import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock WorktreeManager
vi.mock("../worktree/manager.js", () => ({
  WorktreeManager: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      merge: vi.fn().mockResolvedValue({ success: true }),
      cleanupAll: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Mock quality evaluator
vi.mock("../../../quality/evaluator.js", () => ({
  createQualityEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockResolvedValue({
      scores: { overall: 85 },
      meetsMinimum: true,
    }),
  })),
}));

// Mock logger
vi.mock("../../../utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { WorktreeManager } from "../worktree/manager.js";
import { createQualityEvaluator } from "../../../quality/evaluator.js";
import { runBestOfN, formatBestOfNResult } from "./orchestrator.js";
import type { TaskExecutor } from "./orchestrator.js";

function createMockWorktreeManager(scores: number[]) {
  let createIndex = 0;
  const mockManager = {
    create: vi.fn().mockImplementation((name: string) => {
      const idx = createIndex++;
      return Promise.resolve({
        id: `wt-${idx}`,
        name,
        path: `/project/.worktrees/${name}`,
        branch: `coco-best-of-n/${name}-abc12345`,
        status: "active",
        createdAt: new Date(),
      });
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue({ success: true }),
    cleanupAll: vi.fn().mockResolvedValue(undefined),
  };

  vi.mocked(WorktreeManager).mockImplementation(function () {
    return mockManager as any;
  });

  // Mock quality evaluator scores per worktree
  let evalIndex = 0;
  vi.mocked(createQualityEvaluator).mockImplementation(
    () =>
      ({
        evaluate: vi.fn().mockResolvedValue({
          scores: { overall: scores[evalIndex++] ?? 50 },
          meetsMinimum: true,
          meetsTarget: false,
          converged: false,
          issues: [],
          suggestions: [],
        }),
      }) as any,
  );

  return mockManager;
}

describe("Best-of-N Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject fewer than 2 attempts", async () => {
    const executor: TaskExecutor = vi.fn();
    const result = await runBestOfN("/project", executor, { task: "fix bug", attempts: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("at least 2");
  });

  it("should reject more than 10 attempts", async () => {
    const executor: TaskExecutor = vi.fn();
    const result = await runBestOfN("/project", executor, { task: "fix bug", attempts: 11 });

    expect(result.success).toBe(false);
    expect(result.error).toContain("at most 10");
  });

  it("should run N parallel attempts and select the highest scoring", async () => {
    const mockManager = createMockWorktreeManager([70, 92, 85]);

    const executor: TaskExecutor = vi.fn().mockImplementation(async (path: string) => ({
      output: `Solution for ${path}`,
      filesChanged: ["file.ts"],
    }));

    const result = await runBestOfN("/project", executor, { task: "fix the bug", attempts: 3 });

    expect(result.success).toBe(true);
    expect(result.attempts).toHaveLength(3);
    expect(result.winner).not.toBeNull();
    // Winner should be attempt #2 (score 92)
    expect(result.winner!.index).toBe(2);
    expect(result.winner!.score).toBe(92);
    expect(result.winner!.status).toBe("selected");

    // Non-winners should be discarded
    const discarded = result.attempts.filter((a) => a.status === "discarded");
    expect(discarded).toHaveLength(2);

    // Executor should have been called 3 times
    expect(executor).toHaveBeenCalledTimes(3);

    // Worktrees created for each attempt
    expect(mockManager.create).toHaveBeenCalledTimes(3);

    // Non-winner worktrees should be cleaned up
    expect(mockManager.remove).toHaveBeenCalledTimes(2);
  });

  it("should handle all attempts failing", async () => {
    createMockWorktreeManager([]);

    const executor: TaskExecutor = vi.fn().mockRejectedValue(new Error("execution failed"));

    const result = await runBestOfN("/project", executor, { task: "impossible task", attempts: 2 });

    expect(result.success).toBe(false);
    expect(result.error).toBe("All attempts failed");
    expect(result.winner).toBeNull();
    expect(result.attempts.every((a) => a.status === "failed")).toBe(true);
  });

  it("should handle partial failures (some attempts succeed)", async () => {
    // Only one attempt will reach evaluation (the successful one)
    createMockWorktreeManager([88]);

    let callIndex = 0;
    const executor: TaskExecutor = vi.fn().mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        throw new Error("first attempt failed");
      }
      return { output: "success", filesChanged: ["a.ts"] };
    });

    const result = await runBestOfN("/project", executor, { task: "risky task", attempts: 2 });

    expect(result.success).toBe(true);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.score).toBe(88);

    // One failed, one completed
    const failed = result.attempts.filter((a) => a.status === "failed");
    expect(failed).toHaveLength(1);
  });

  it("should call callbacks during execution", async () => {
    createMockWorktreeManager([90, 85]);

    const executor: TaskExecutor = vi.fn().mockResolvedValue({
      output: "done",
      filesChanged: [],
    });

    const callbacks = {
      onAttemptStart: vi.fn(),
      onAttemptComplete: vi.fn(),
      onEvaluating: vi.fn(),
      onWinnerSelected: vi.fn(),
    };

    await runBestOfN("/project", executor, { task: "test", attempts: 2 }, callbacks);

    expect(callbacks.onAttemptStart).toHaveBeenCalledTimes(2);
    expect(callbacks.onAttemptComplete).toHaveBeenCalledTimes(2);
    expect(callbacks.onEvaluating).toHaveBeenCalledTimes(2);
    expect(callbacks.onWinnerSelected).toHaveBeenCalledTimes(1);
  });

  it("should auto-merge when configured", async () => {
    const mockManager = createMockWorktreeManager([95, 80]);

    const executor: TaskExecutor = vi.fn().mockResolvedValue({
      output: "done",
      filesChanged: ["main.ts"],
    });

    await runBestOfN("/project", executor, {
      task: "fix everything",
      attempts: 2,
      autoMerge: true,
    });

    expect(mockManager.merge).toHaveBeenCalledWith(
      "wt-0", // First worktree (score 95) is the winner
      expect.objectContaining({ strategy: "merge" }),
    );
  });
});

describe("formatBestOfNResult", () => {
  it("should format a successful result", () => {
    const result = {
      success: true,
      attempts: [
        {
          id: "1",
          index: 1,
          worktreeId: "wt-1",
          worktreePath: "/p/.worktrees/1",
          branch: "b1",
          status: "discarded" as const,
          score: 70,
          output: "...",
          filesChanged: ["a.ts"],
          durationMs: 5000,
        },
        {
          id: "2",
          index: 2,
          worktreeId: "wt-2",
          worktreePath: "/p/.worktrees/2",
          branch: "b2",
          status: "selected" as const,
          score: 92,
          output: "...",
          filesChanged: ["a.ts", "b.ts"],
          durationMs: 8000,
        },
      ],
      winner: {
        id: "2",
        index: 2,
        worktreeId: "wt-2",
        worktreePath: "/p/.worktrees/2",
        branch: "b2",
        status: "selected" as const,
        score: 92,
        output: "...",
        filesChanged: ["a.ts", "b.ts"],
        durationMs: 8000,
      },
      totalDurationMs: 10000,
    };

    const output = formatBestOfNResult(result);
    expect(output).toContain("Best-of-N Results");
    expect(output).toContain("92.0/100");
    expect(output).toContain("70.0/100");
    expect(output).toContain("Winner: Attempt #2");
  });

  it("should format a failed result", () => {
    const result = {
      success: false,
      attempts: [],
      winner: null,
      totalDurationMs: 1000,
      error: "All attempts failed",
    };

    const output = formatBestOfNResult(result);
    expect(output).toContain("All attempts failed");
  });
});
