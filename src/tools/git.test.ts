/**
 * Tests for git tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStatus = vi.fn().mockResolvedValue({
  current: "main",
  tracking: "origin/main",
  ahead: 0,
  behind: 0,
  staged: ["file1.ts"],
  modified: ["file2.ts"],
  not_added: ["file3.ts"],
  conflicted: [],
  created: [],
  deleted: [],
  renamed: [],
  files: [],
  isClean: () => false,
});

const mockDiff = vi.fn().mockResolvedValue("diff content");
const mockDiffSummary = vi.fn().mockResolvedValue({
  changed: 2,
  insertions: 10,
  deletions: 5,
});
const mockAdd = vi.fn().mockResolvedValue(undefined);
const mockCommit = vi.fn().mockResolvedValue({
  commit: "abc123",
  summary: { changes: 1, insertions: 10, deletions: 2 },
});
const mockLog = vi.fn().mockResolvedValue({
  all: [
    { hash: "abc123", message: "First commit", date: "2024-01-01", author_name: "Dev" },
    { hash: "def456", message: "Second commit", date: "2024-01-02", author_name: "Dev" },
  ],
  latest: { hash: "def456" },
  total: 2,
});
const mockBranchLocal = vi.fn().mockResolvedValue({
  all: ["main", "develop", "feature/test"],
  current: "main",
});
const mockCheckout = vi.fn().mockResolvedValue(undefined);
const mockCheckoutLocalBranch = vi.fn().mockResolvedValue(undefined);
const mockDeleteLocalBranch = vi.fn().mockResolvedValue(undefined);
const mockInit = vi.fn().mockResolvedValue(undefined);
const mockPush = vi.fn().mockResolvedValue(undefined);
const mockPull = vi.fn().mockResolvedValue({ files: [], summary: null });

// Mock simple-git
vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => ({
    status: mockStatus,
    diff: mockDiff,
    diffSummary: mockDiffSummary,
    add: mockAdd,
    commit: mockCommit,
    log: mockLog,
    branchLocal: mockBranchLocal,
    checkout: mockCheckout,
    checkoutLocalBranch: mockCheckoutLocalBranch,
    deleteLocalBranch: mockDeleteLocalBranch,
    init: mockInit,
    push: mockPush,
    pull: mockPull,
  })),
}));

describe("gitStatusTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockResolvedValue({
      current: "main",
      tracking: "origin/main",
      ahead: 0,
      behind: 0,
      staged: ["file1.ts"],
      modified: ["file2.ts"],
      not_added: ["file3.ts"],
      conflicted: [],
      isClean: () => false,
    });
  });

  it("should have correct metadata", async () => {
    const { gitStatusTool } = await import("./git.js");
    expect(gitStatusTool.name).toBe("git_status");
    expect(gitStatusTool.category).toBe("git");
  });

  it("should return git status", async () => {
    const { gitStatusTool } = await import("./git.js");

    const result = await gitStatusTool.execute({ cwd: "/project" });

    expect(result.branch).toBe("main");
    expect(result.staged).toContain("file1.ts");
    expect(result.modified).toContain("file2.ts");
    expect(result.untracked).toContain("file3.ts");
  });

  it("should detect clean repository", async () => {
    mockStatus.mockResolvedValue({
      current: "main",
      tracking: "origin/main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      not_added: [],
      conflicted: [],
      isClean: () => true,
    });

    const { gitStatusTool } = await import("./git.js");

    const result = await gitStatusTool.execute({ cwd: "/project" });

    expect(result.isClean).toBe(true);
  });
});

describe("gitDiffTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiff.mockResolvedValue("diff --git a/file.ts b/file.ts\n-old\n+new");
    mockDiffSummary.mockResolvedValue({
      changed: 1,
      insertions: 10,
      deletions: 5,
    });
  });

  it("should have correct metadata", async () => {
    const { gitDiffTool } = await import("./git.js");
    expect(gitDiffTool.name).toBe("git_diff");
    expect(gitDiffTool.category).toBe("git");
  });

  it("should return diff output", async () => {
    const { gitDiffTool } = await import("./git.js");

    const result = await gitDiffTool.execute({ cwd: "/project" });

    expect(result.diff).toContain("diff --git");
    expect(result.filesChanged).toBe(1);
    expect(result.insertions).toBe(10);
    expect(result.deletions).toBe(5);
  });

  it("should support staged diff", async () => {
    const { gitDiffTool } = await import("./git.js");

    await gitDiffTool.execute({ cwd: "/project", staged: true });

    expect(mockDiff).toHaveBeenCalledWith(["--staged"]);
  });

  it("should support file-specific diff", async () => {
    const { gitDiffTool } = await import("./git.js");

    await gitDiffTool.execute({ cwd: "/project", files: ["specific.ts"] });

    expect(mockDiff).toHaveBeenCalledWith(expect.arrayContaining(["specific.ts"]));
  });
});

describe("gitAddTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { gitAddTool } = await import("./git.js");
    expect(gitAddTool.name).toBe("git_add");
    expect(gitAddTool.category).toBe("git");
  });

  it("should add files to staging", async () => {
    const { gitAddTool } = await import("./git.js");

    const result = await gitAddTool.execute({
      cwd: "/project",
      files: ["file1.ts", "file2.ts"],
    });

    expect(result.added).toEqual(["file1.ts", "file2.ts"]);
    expect(mockAdd).toHaveBeenCalledWith(["file1.ts", "file2.ts"]);
  });

  it("should add all files with '.'", async () => {
    const { gitAddTool } = await import("./git.js");

    await gitAddTool.execute({ cwd: "/project", files: ["."] });

    expect(mockAdd).toHaveBeenCalledWith(["."]);
  });
});

describe("gitCommitTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommit.mockResolvedValue({
      commit: "abc123",
      summary: { changes: 1, insertions: 10, deletions: 2 },
    });
  });

  it("should have correct metadata", async () => {
    const { gitCommitTool } = await import("./git.js");
    expect(gitCommitTool.name).toBe("git_commit");
    expect(gitCommitTool.category).toBe("git");
  });

  it("should create commit with message", async () => {
    const { gitCommitTool } = await import("./git.js");

    const result = await gitCommitTool.execute({
      cwd: "/project",
      message: "feat: add new feature",
    });

    expect(result.hash).toBe("abc123");
    expect(mockCommit).toHaveBeenCalledWith("feat: add new feature", undefined, {});
  });

  it("should handle commit errors", async () => {
    mockCommit.mockRejectedValueOnce(new Error("nothing to commit"));

    const { gitCommitTool } = await import("./git.js");

    await expect(
      gitCommitTool.execute({ cwd: "/project", message: "empty commit" })
    ).rejects.toThrow();
  });
});

describe("gitLogTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { gitLogTool } = await import("./git.js");
    expect(gitLogTool.name).toBe("git_log");
    expect(gitLogTool.category).toBe("git");
  });

  it("should return commit log", async () => {
    const { gitLogTool } = await import("./git.js");

    const result = await gitLogTool.execute({ cwd: "/project" });

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].hash).toBe("abc123");
    expect(result.commits[0].message).toBe("First commit");
  });

  it("should respect maxCount parameter", async () => {
    const { gitLogTool } = await import("./git.js");

    await gitLogTool.execute({ cwd: "/project", maxCount: 5 });

    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ maxCount: 5 }));
  });
});

describe("gitBranchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { gitBranchTool } = await import("./git.js");
    expect(gitBranchTool.name).toBe("git_branch");
    expect(gitBranchTool.category).toBe("git");
  });

  it("should list branches", async () => {
    const { gitBranchTool } = await import("./git.js");

    const result = await gitBranchTool.execute({ cwd: "/project" });

    expect(result.current).toBe("main");
    expect(result.branches).toContain("develop");
    expect(result.branches).toContain("feature/test");
  });

  it("should create new branch", async () => {
    const { gitBranchTool } = await import("./git.js");

    await gitBranchTool.execute({
      cwd: "/project",
      create: "new-branch",
    });

    expect(mockCheckoutLocalBranch).toHaveBeenCalledWith("new-branch");
  });
});

describe("gitCheckoutTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { gitCheckoutTool } = await import("./git.js");
    expect(gitCheckoutTool.name).toBe("git_checkout");
    expect(gitCheckoutTool.category).toBe("git");
  });

  it("should checkout branch", async () => {
    const { gitCheckoutTool } = await import("./git.js");

    const result = await gitCheckoutTool.execute({
      cwd: "/project",
      branch: "develop",
    });

    expect(result.branch).toBe("develop");
    expect(mockCheckout).toHaveBeenCalledWith("develop");
  });

  it("should create and checkout new branch", async () => {
    const { gitCheckoutTool } = await import("./git.js");

    await gitCheckoutTool.execute({
      cwd: "/project",
      branch: "new-feature",
      create: true,
    });

    expect(mockCheckoutLocalBranch).toHaveBeenCalledWith("new-feature");
  });
});

describe("gitInitTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", async () => {
    const { gitInitTool } = await import("./git.js");
    expect(gitInitTool.name).toBe("git_init");
    expect(gitInitTool.category).toBe("git");
  });

  it("should initialize repository", async () => {
    const { gitInitTool } = await import("./git.js");

    const result = await gitInitTool.execute({ cwd: "/new-project" });

    expect(result.initialized).toBe(true);
    expect(mockInit).toHaveBeenCalledWith([]);
  });

  it("should support bare repository", async () => {
    const { gitInitTool } = await import("./git.js");

    await gitInitTool.execute({
      cwd: "/new-project",
      bare: true,
    });

    expect(mockInit).toHaveBeenCalledWith(["--bare"]);
  });
});

describe("gitPushTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus.mockResolvedValue({
      current: "main",
      tracking: "origin/main",
      ahead: 1,
      behind: 0,
      staged: [],
      modified: [],
      not_added: [],
      conflicted: [],
      isClean: () => true,
    });
  });

  it("should have correct metadata", async () => {
    const { gitPushTool } = await import("./git.js");
    expect(gitPushTool.name).toBe("git_push");
    expect(gitPushTool.category).toBe("git");
  });

  it("should push to remote", async () => {
    const { gitPushTool } = await import("./git.js");

    const result = await gitPushTool.execute({ cwd: "/project" });

    expect(result.pushed).toBe(true);
    expect(result.remote).toBe("origin");
    expect(result.branch).toBe("main");
    expect(mockPush).toHaveBeenCalled();
  });

  it("should push with setUpstream", async () => {
    const { gitPushTool } = await import("./git.js");

    await gitPushTool.execute({ cwd: "/project", remote: "origin", setUpstream: true });

    expect(mockPush).toHaveBeenCalledWith("origin", "main", ["-u"]);
  });

  it("should push specific branch", async () => {
    const { gitPushTool } = await import("./git.js");

    const result = await gitPushTool.execute({
      cwd: "/project",
      branch: "feature/test",
      remote: "upstream",
    });

    expect(result.branch).toBe("feature/test");
    expect(result.remote).toBe("upstream");
    expect(mockPush).toHaveBeenCalledWith("upstream", "feature/test", []);
  });

  it("should handle push errors", async () => {
    mockPush.mockRejectedValueOnce(new Error("push rejected"));

    const { gitPushTool } = await import("./git.js");

    await expect(gitPushTool.execute({ cwd: "/project" })).rejects.toThrow();
  });
});

describe("gitPullTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPull.mockResolvedValue({
      files: ["file1.ts", "file2.ts"],
      summary: { insertions: 10, deletions: 5 },
    });
  });

  it("should have correct metadata", async () => {
    const { gitPullTool } = await import("./git.js");
    expect(gitPullTool.name).toBe("git_pull");
    expect(gitPullTool.category).toBe("git");
  });

  it("should pull from remote", async () => {
    const { gitPullTool } = await import("./git.js");

    const result = await gitPullTool.execute({ cwd: "/project", remote: "origin" });

    expect(result.updated).toBe(true);
    expect(result.summary).toContain("10 insertions");
    expect(mockPull).toHaveBeenCalledWith("origin", undefined, {});
  });

  it("should pull with rebase", async () => {
    const { gitPullTool } = await import("./git.js");

    await gitPullTool.execute({ cwd: "/project", remote: "origin", rebase: true });

    expect(mockPull).toHaveBeenCalledWith("origin", undefined, {
      "--rebase": null,
    });
  });

  it("should pull specific branch", async () => {
    const { gitPullTool } = await import("./git.js");

    await gitPullTool.execute({
      cwd: "/project",
      remote: "upstream",
      branch: "develop",
    });

    expect(mockPull).toHaveBeenCalledWith("upstream", "develop", {});
  });

  it("should handle already up to date", async () => {
    mockPull.mockResolvedValue({ files: [], summary: null });

    const { gitPullTool } = await import("./git.js");

    const result = await gitPullTool.execute({ cwd: "/project" });

    expect(result.updated).toBe(false);
    expect(result.summary).toBe("Already up to date");
  });

  it("should handle pull errors", async () => {
    mockPull.mockRejectedValueOnce(new Error("merge conflict"));

    const { gitPullTool } = await import("./git.js");

    await expect(gitPullTool.execute({ cwd: "/project" })).rejects.toThrow();
  });
});

describe("gitStatusTool error handling", () => {
  it("should throw ToolError on status failure", async () => {
    mockStatus.mockRejectedValueOnce(new Error("not a git repository"));

    const { gitStatusTool } = await import("./git.js");

    await expect(gitStatusTool.execute({ cwd: "/invalid" })).rejects.toThrow(
      "Git status failed"
    );
  });

  it("should handle non-Error exceptions", async () => {
    mockStatus.mockRejectedValueOnce("string error");

    const { gitStatusTool } = await import("./git.js");

    await expect(gitStatusTool.execute({ cwd: "/invalid" })).rejects.toThrow();
  });
});

describe("gitDiffTool error handling", () => {
  it("should throw ToolError on diff failure", async () => {
    mockDiff.mockRejectedValueOnce(new Error("diff failed"));

    const { gitDiffTool } = await import("./git.js");

    await expect(gitDiffTool.execute({ cwd: "/invalid" })).rejects.toThrow(
      "Git diff failed"
    );
  });
});

describe("gitAddTool error handling", () => {
  it("should throw ToolError on add failure", async () => {
    mockAdd.mockRejectedValueOnce(new Error("file not found"));

    const { gitAddTool } = await import("./git.js");

    await expect(
      gitAddTool.execute({ cwd: "/project", files: ["missing.ts"] })
    ).rejects.toThrow("Git add failed");
  });
});

describe("gitLogTool with file filter", () => {
  it("should filter log by file", async () => {
    const { gitLogTool } = await import("./git.js");

    await gitLogTool.execute({ cwd: "/project", file: "src/index.ts" });

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ file: "src/index.ts" })
    );
  });

  it("should handle log errors", async () => {
    mockLog.mockRejectedValueOnce(new Error("invalid revision"));

    const { gitLogTool } = await import("./git.js");

    await expect(gitLogTool.execute({ cwd: "/project" })).rejects.toThrow(
      "Git log failed"
    );
  });
});

describe("gitBranchTool operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBranchLocal.mockResolvedValue({
      all: ["main", "develop"],
      current: "main",
    });
    mockStatus.mockResolvedValue({
      current: "new-branch",
      tracking: null,
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      not_added: [],
      conflicted: [],
      isClean: () => true,
    });
  });

  it("should delete branch", async () => {
    const { gitBranchTool } = await import("./git.js");

    await gitBranchTool.execute({
      cwd: "/project",
      delete: "old-branch",
      list: false,
    });

    expect(mockDeleteLocalBranch).toHaveBeenCalledWith("old-branch");
  });

  it("should return current branch after create without list", async () => {
    const { gitBranchTool } = await import("./git.js");

    const result = await gitBranchTool.execute({
      cwd: "/project",
      create: "new-feature",
      list: false,
    });

    expect(mockCheckoutLocalBranch).toHaveBeenCalledWith("new-feature");
    expect(result.current).toBe("new-branch");
    expect(result.branches).toEqual([]);
  });

  it("should handle branch errors", async () => {
    mockBranchLocal.mockRejectedValueOnce(new Error("invalid branch"));

    const { gitBranchTool } = await import("./git.js");

    await expect(gitBranchTool.execute({ cwd: "/project" })).rejects.toThrow(
      "Git branch failed"
    );
  });
});

describe("gitCheckoutTool error handling", () => {
  it("should throw ToolError on checkout failure", async () => {
    mockCheckout.mockRejectedValueOnce(new Error("branch not found"));

    const { gitCheckoutTool } = await import("./git.js");

    await expect(
      gitCheckoutTool.execute({ cwd: "/project", branch: "nonexistent" })
    ).rejects.toThrow("Git checkout failed");
  });
});

describe("gitCommitTool with author", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommit.mockResolvedValue({
      commit: "def456",
      summary: { changes: 1, insertions: 5, deletions: 0 },
    });
  });

  it("should create commit with custom author", async () => {
    const { gitCommitTool } = await import("./git.js");

    await gitCommitTool.execute({
      cwd: "/project",
      message: "feat: new feature",
      author: "Test User <test@example.com>",
    });

    expect(mockCommit).toHaveBeenCalledWith("feat: new feature", undefined, {
      "--author": "Test User <test@example.com>",
    });
  });

  it("should handle commit with no changes summary", async () => {
    mockCommit.mockResolvedValue({
      commit: "abc123",
      summary: { changes: 0 },
    });

    const { gitCommitTool } = await import("./git.js");

    const result = await gitCommitTool.execute({
      cwd: "/project",
      message: "empty commit",
    });

    expect(result.summary).toBe("No changes");
  });
});

describe("gitInitTool error handling", () => {
  it("should throw ToolError on init failure", async () => {
    mockInit.mockRejectedValueOnce(new Error("permission denied"));

    const { gitInitTool } = await import("./git.js");

    await expect(gitInitTool.execute({ cwd: "/restricted" })).rejects.toThrow(
      "Git init failed"
    );
  });
});

describe("gitTools", () => {
  it("should export all git tools", async () => {
    const { gitTools } = await import("./git.js");

    expect(gitTools).toBeDefined();
    expect(gitTools.length).toBe(10);
    expect(gitTools.some((t) => t.name === "git_status")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_diff")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_add")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_commit")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_log")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_branch")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_push")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_pull")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_init")).toBe(true);
    expect(gitTools.some((t) => t.name === "git_checkout")).toBe(true);
  });
});
