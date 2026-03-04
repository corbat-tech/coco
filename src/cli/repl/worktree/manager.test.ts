import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock fs
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
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

import { execFile } from "node:child_process";
import { WorktreeManager, createWorktreeManager } from "./manager.js";

// Helper to make execFile resolve
function mockExecFile(
  responses: Array<{ stdout?: string; stderr?: string; error?: Error }>,
): void {
  let callIndex = 0;
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback?: any) => {
    const response = responses[callIndex++] ?? { stdout: "", stderr: "" };
    const cb = typeof _opts === "function" ? _opts : callback;

    if (response.error) {
      cb?.(response.error, "", "");
    } else {
      cb?.(null, response.stdout ?? "", response.stderr ?? "");
    }

    return {} as any;
  });
}

describe("WorktreeManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create a worktree with correct git command", async () => {
      mockExecFile([{ stdout: "" }]); // git worktree add

      const manager = new WorktreeManager("/project");
      const wt = await manager.create("feature-auth");

      expect(wt.name).toBe("feature-auth");
      expect(wt.status).toBe("active");
      expect(wt.path).toContain(".worktrees/feature-auth");
      expect(wt.branch).toContain("coco-agent/feature-auth-");
      expect(wt.createdAt).toBeInstanceOf(Date);

      // Verify git command
      expect(execFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add"]),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("should use custom branch prefix", async () => {
      mockExecFile([{ stdout: "" }]);

      const manager = new WorktreeManager("/project");
      const wt = await manager.create("test-run", { branchPrefix: "my-prefix" });

      expect(wt.branch).toContain("my-prefix/test-run-");
    });

    it("should set error status on failure", async () => {
      mockExecFile([{ error: new Error("git error") }]);

      const manager = new WorktreeManager("/project");

      await expect(manager.create("failing")).rejects.toThrow("git error");

      const worktrees = await manager.list();
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]?.status).toBe("error");
      expect(worktrees[0]?.error).toBe("git error");
    });
  });

  describe("remove", () => {
    it("should remove a worktree", async () => {
      // Create response + remove response + branch delete
      mockExecFile([{ stdout: "" }, { stdout: "" }, { stdout: "" }]);

      const manager = new WorktreeManager("/project");
      const wt = await manager.create("to-remove");

      await manager.remove(wt.id);

      expect(wt.status).toBe("removed");
      expect(wt.removedAt).toBeInstanceOf(Date);
    });

    it("should throw for unknown worktree ID", async () => {
      const manager = new WorktreeManager("/project");

      await expect(manager.remove("nonexistent")).rejects.toThrow("Worktree not found");
    });

    it("should skip if already removed", async () => {
      mockExecFile([{ stdout: "" }, { stdout: "" }, { stdout: "" }]);

      const manager = new WorktreeManager("/project");
      const wt = await manager.create("to-remove");

      await manager.remove(wt.id);
      // Second remove should be a no-op
      await manager.remove(wt.id);

      expect(wt.status).toBe("removed");
    });
  });

  describe("list", () => {
    it("should list all tracked worktrees", async () => {
      mockExecFile([{ stdout: "" }, { stdout: "" }]);

      const manager = new WorktreeManager("/project");
      await manager.create("wt-1");
      await manager.create("wt-2");

      const list = await manager.list();
      expect(list).toHaveLength(2);
    });
  });

  describe("merge", () => {
    it("should merge via merge strategy", async () => {
      // create + merge + diff count + worktree remove + branch delete
      mockExecFile([
        { stdout: "" },         // create worktree
        { stdout: "" },         // git merge
        { stdout: "file1.ts" }, // git diff --name-only
        { stdout: "" },         // git worktree remove
        { stdout: "" },         // git branch -D
      ]);

      const manager = new WorktreeManager("/project");
      const wt = await manager.create("to-merge");

      const result = await manager.merge(wt.id, { strategy: "merge" });

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("merge");
    });

    it("should return error for non-existent worktree", async () => {
      const manager = new WorktreeManager("/project");

      const result = await manager.merge("nonexistent", { strategy: "merge" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("getActiveCount", () => {
    it("should count only active worktrees", async () => {
      mockExecFile([{ stdout: "" }, { stdout: "" }, { stdout: "" }, { stdout: "" }]);

      const manager = new WorktreeManager("/project");
      await manager.create("wt-1");
      await manager.create("wt-2");

      expect(manager.getActiveCount()).toBe(2);

      // Remove one
      const list = await manager.list();
      await manager.remove(list[0]!.id);

      expect(manager.getActiveCount()).toBe(1);
    });
  });

  describe("createWorktreeManager factory", () => {
    it("should create a WorktreeManager instance", () => {
      const manager = createWorktreeManager("/project");
      expect(manager).toBeInstanceOf(WorktreeManager);
    });
  });
});
