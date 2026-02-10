/**
 * Tests for GitHub CLI Tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolError } from "../utils/errors.js";

// Mock execa at the module level
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// Import after mock setup
import { execa } from "execa";
import {
  ghCheckAuthTool,
  ghRepoInfoTool,
  ghPrCreateTool,
  ghPrMergeTool,
  ghPrChecksTool,
  ghPrListTool,
  ghReleaseCreateTool,
  githubTools,
} from "./github.js";

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Metadata
// ============================================================================

describe("GitHub tools metadata", () => {
  it("ghCheckAuthTool has correct metadata", () => {
    expect(ghCheckAuthTool.name).toBe("gh_check_auth");
    expect(ghCheckAuthTool.description).toContain("authenticated");
    expect(ghCheckAuthTool.category).toBe("git");
  });

  it("ghRepoInfoTool has correct metadata", () => {
    expect(ghRepoInfoTool.name).toBe("gh_repo_info");
    expect(ghRepoInfoTool.description).toContain("repository");
    expect(ghRepoInfoTool.category).toBe("git");
  });

  it("ghPrCreateTool has correct metadata", () => {
    expect(ghPrCreateTool.name).toBe("gh_pr_create");
    expect(ghPrCreateTool.description).toContain("pull request");
    expect(ghPrCreateTool.category).toBe("git");
  });

  it("ghPrMergeTool has correct metadata", () => {
    expect(ghPrMergeTool.name).toBe("gh_pr_merge");
    expect(ghPrMergeTool.description).toContain("Merge");
    expect(ghPrMergeTool.category).toBe("git");
  });

  it("ghPrChecksTool has correct metadata", () => {
    expect(ghPrChecksTool.name).toBe("gh_pr_checks");
    expect(ghPrChecksTool.description).toContain("check");
    expect(ghPrChecksTool.category).toBe("git");
  });

  it("ghPrListTool has correct metadata", () => {
    expect(ghPrListTool.name).toBe("gh_pr_list");
    expect(ghPrListTool.description).toContain("pull requests");
    expect(ghPrListTool.category).toBe("git");
  });

  it("ghReleaseCreateTool has correct metadata", () => {
    expect(ghReleaseCreateTool.name).toBe("gh_release_create");
    expect(ghReleaseCreateTool.description).toContain("release");
    expect(ghReleaseCreateTool.category).toBe("git");
  });
});

// ============================================================================
// ghCheckAuthTool
// ============================================================================

describe("ghCheckAuthTool", () => {
  it("returns authenticated with user on success", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Logged in to github.com as octocat",
      stderr: "",
    } as never);

    const result = await ghCheckAuthTool.execute({});

    expect(result.authenticated).toBe(true);
    expect(result.user).toBe("octocat");
    expect(result.error).toBeUndefined();
    expect(mockExeca).toHaveBeenCalledWith("gh", ["auth", "status"], expect.objectContaining({ timeout: 60_000 }));
  });

  it("returns authenticated true but no user when format differs", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "github.com: authenticated",
      stderr: "",
    } as never);

    const result = await ghCheckAuthTool.execute({});

    expect(result.authenticated).toBe(true);
    expect(result.user).toBeUndefined();
  });

  it("returns not authenticated on failure", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not logged in"));

    const result = await ghCheckAuthTool.execute({});

    expect(result.authenticated).toBe(false);
    expect(result.error).toContain("gh CLI not authenticated");
    expect(result.user).toBeUndefined();
  });

  it("passes cwd to execa", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Logged in to github.com as testuser",
      stderr: "",
    } as never);

    await ghCheckAuthTool.execute({ cwd: "/custom/path" });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      expect.objectContaining({ cwd: "/custom/path" }),
    );
  });
});

// ============================================================================
// ghRepoInfoTool
// ============================================================================

describe("ghRepoInfoTool", () => {
  it("parses repository info from JSON output", async () => {
    const repoData = {
      name: "my-repo",
      nameWithOwner: "owner/my-repo",
      defaultBranchRef: { name: "main" },
      url: "https://github.com/owner/my-repo",
      isPrivate: false,
    };
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(repoData),
      stderr: "",
    } as never);

    const result = await ghRepoInfoTool.execute({});

    expect(result).toEqual({
      name: "my-repo",
      fullName: "owner/my-repo",
      defaultBranch: "main",
      url: "https://github.com/owner/my-repo",
      private: false,
    });
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["repo", "view", "--json", "name,nameWithOwner,defaultBranchRef,url,isPrivate"],
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("returns private: true for private repos", async () => {
    const repoData = {
      name: "secret-repo",
      nameWithOwner: "owner/secret-repo",
      defaultBranchRef: { name: "develop" },
      url: "https://github.com/owner/secret-repo",
      isPrivate: true,
    };
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(repoData),
      stderr: "",
    } as never);

    const result = await ghRepoInfoTool.execute({});

    expect(result.private).toBe(true);
    expect(result.defaultBranch).toBe("develop");
  });

  it("throws ToolError when gh command fails", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not a git repository"));

    await expect(ghRepoInfoTool.execute({})).rejects.toThrow(ToolError);
  });
});

// ============================================================================
// ghPrCreateTool
// ============================================================================

describe("ghPrCreateTool", () => {
  it("creates PR and parses URL and number", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/pull/42\n",
      stderr: "",
    } as never);

    const result = await ghPrCreateTool.execute({
      title: "feat: add feature",
      body: "Description of the feature",
    });

    expect(result.number).toBe(42);
    expect(result.url).toBe("https://github.com/owner/repo/pull/42");
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "create", "--title", "feat: add feature", "--body", "Description of the feature"],
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("passes base branch when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/pull/10\n",
      stderr: "",
    } as never);

    await ghPrCreateTool.execute({
      title: "fix: bug",
      body: "Fixes the bug",
      base: "develop",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "create", "--title", "fix: bug", "--body", "Fixes the bug", "--base", "develop"],
      expect.any(Object),
    );
  });

  it("passes --draft flag when draft is true", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/pull/15\n",
      stderr: "",
    } as never);

    await ghPrCreateTool.execute({
      title: "wip: work in progress",
      body: "Not ready yet",
      draft: true,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "create", "--title", "wip: work in progress", "--body", "Not ready yet", "--draft"],
      expect.any(Object),
    );
  });

  it("passes both base and draft when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/pull/20\n",
      stderr: "",
    } as never);

    await ghPrCreateTool.execute({
      title: "draft feature",
      body: "Body",
      base: "main",
      draft: true,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "create", "--title", "draft feature", "--body", "Body", "--base", "main", "--draft"],
      expect.any(Object),
    );
  });

  it("returns number 0 when URL does not match PR pattern", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/unexpected-url\n",
      stderr: "",
    } as never);

    const result = await ghPrCreateTool.execute({
      title: "test",
      body: "test",
    });

    expect(result.number).toBe(0);
    expect(result.url).toBe("https://github.com/owner/repo/unexpected-url");
  });

  it("throws ToolError on failure", async () => {
    mockExeca.mockRejectedValueOnce(new Error("no commits between branches"));

    await expect(
      ghPrCreateTool.execute({ title: "test", body: "test" }),
    ).rejects.toThrow(ToolError);
  });
});

// ============================================================================
// ghPrMergeTool
// ============================================================================

describe("ghPrMergeTool", () => {
  it("merges PR with squash and delete-branch", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    const result = await ghPrMergeTool.execute({
      number: 42,
      method: "squash",
      deleteBranch: true,
    });

    expect(result.merged).toBe(true);
    expect(result.method).toBe("squash");
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "42", "--squash", "--delete-branch"],
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("uses merge method when specified", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    const result = await ghPrMergeTool.execute({
      number: 10,
      method: "merge",
      deleteBranch: true,
    });

    expect(result.method).toBe("merge");
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "10", "--merge", "--delete-branch"],
      expect.any(Object),
    );
  });

  it("uses rebase method when specified", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    const result = await ghPrMergeTool.execute({
      number: 5,
      method: "rebase",
      deleteBranch: true,
    });

    expect(result.method).toBe("rebase");
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "5", "--rebase", "--delete-branch"],
      expect.any(Object),
    );
  });

  it("omits --delete-branch when deleteBranch is false", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    await ghPrMergeTool.execute({
      number: 3,
      method: "squash",
      deleteBranch: false,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "3", "--squash"],
      expect.any(Object),
    );
  });

  it("passes subject when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    await ghPrMergeTool.execute({
      number: 7,
      method: "squash",
      deleteBranch: true,
      subject: "feat: merged feature (#7)",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "7", "--squash", "--delete-branch", "--subject", "feat: merged feature (#7)"],
      expect.any(Object),
    );
  });

  it("passes body when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    await ghPrMergeTool.execute({
      number: 8,
      method: "squash",
      deleteBranch: true,
      body: "Merge commit body text",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "8", "--squash", "--delete-branch", "--body", "Merge commit body text"],
      expect.any(Object),
    );
  });

  it("passes subject and body together", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Merged",
      stderr: "",
    } as never);

    await ghPrMergeTool.execute({
      number: 9,
      method: "squash",
      subject: "merge subject",
      body: "merge body",
      deleteBranch: false,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "9", "--squash", "--subject", "merge subject", "--body", "merge body"],
      expect.any(Object),
    );
  });

  it("throws ToolError on failure", async () => {
    mockExeca.mockRejectedValueOnce(new Error("merge conflict"));

    await expect(
      ghPrMergeTool.execute({ number: 99, method: "squash", deleteBranch: true }),
    ).rejects.toThrow(ToolError);
  });
});

// ============================================================================
// ghPrChecksTool
// ============================================================================

describe("ghPrChecksTool", () => {
  it("returns all passing checks", async () => {
    const checks = [
      { name: "build", state: "SUCCESS", conclusion: "SUCCESS", detailsUrl: "https://ci.example.com/1" },
      { name: "test", state: "SUCCESS", conclusion: "SUCCESS", detailsUrl: "https://ci.example.com/2" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.allPassed).toBe(true);
    expect(result.anyFailed).toBe(false);
    expect(result.anyPending).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0]!.status).toBe("pass");
    expect(result.checks[1]!.status).toBe("pass");
  });

  it("detects failing checks", async () => {
    const checks = [
      { name: "build", state: "SUCCESS", conclusion: "SUCCESS", detailsUrl: "https://ci.example.com/1" },
      { name: "lint", state: "FAILURE", conclusion: "FAILURE", detailsUrl: "https://ci.example.com/2" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.allPassed).toBe(false);
    expect(result.anyFailed).toBe(true);
    expect(result.anyPending).toBe(false);
    expect(result.checks[1]!.status).toBe("fail");
  });

  it("detects pending checks", async () => {
    const checks = [
      { name: "build", state: "PENDING", conclusion: "", detailsUrl: "https://ci.example.com/1" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.allPassed).toBe(false);
    expect(result.anyFailed).toBe(false);
    expect(result.anyPending).toBe(true);
    expect(result.checks[0]!.status).toBe("pending");
    expect(result.checks[0]!.conclusion).toBe("PENDING");
  });

  it("detects skipped checks and counts them as allPassed", async () => {
    const checks = [
      { name: "build", state: "SUCCESS", conclusion: "SUCCESS", detailsUrl: "https://ci.example.com/1" },
      { name: "optional", state: "SKIPPED", conclusion: "SKIPPED", detailsUrl: "https://ci.example.com/2" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.allPassed).toBe(true);
    expect(result.anyFailed).toBe(false);
    expect(result.anyPending).toBe(false);
    expect(result.checks[1]!.status).toBe("skipping");
  });

  it("returns allPassed false for empty checks", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "[]",
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.allPassed).toBe(false);
    expect(result.anyFailed).toBe(false);
    expect(result.anyPending).toBe(false);
    expect(result.checks).toHaveLength(0);
  });

  it("maps conclusion field when state does not match known values", async () => {
    const checks = [
      { name: "deploy", state: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci.example.com/1" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.checks[0]!.status).toBe("fail");
    expect(result.anyFailed).toBe(true);
  });

  it("maps conclusion SUCCESS when state is COMPLETED", async () => {
    const checks = [
      { name: "deploy", state: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.example.com/1" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.checks[0]!.status).toBe("pass");
  });

  it("maps conclusion SKIPPED when state is COMPLETED", async () => {
    const checks = [
      { name: "skip-me", state: "COMPLETED", conclusion: "SKIPPED", detailsUrl: "https://ci.example.com/1" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(checks),
      stderr: "",
    } as never);

    const result = await ghPrChecksTool.execute({ number: 42 });

    expect(result.checks[0]!.status).toBe("skipping");
  });

  it("throws ToolError on failure", async () => {
    mockExeca.mockRejectedValueOnce(new Error("no checks found"));

    await expect(ghPrChecksTool.execute({ number: 999 })).rejects.toThrow(ToolError);
  });
});

// ============================================================================
// ghPrListTool
// ============================================================================

describe("ghPrListTool", () => {
  it("lists open PRs", async () => {
    const prs = [
      { number: 1, title: "First PR", url: "https://github.com/owner/repo/pull/1", state: "OPEN" },
      { number: 2, title: "Second PR", url: "https://github.com/owner/repo/pull/2", state: "OPEN" },
    ];
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(prs),
      stderr: "",
    } as never);

    const result = await ghPrListTool.execute({ state: "open" });

    expect(result.prs).toHaveLength(2);
    expect(result.prs[0]!.number).toBe(1);
    expect(result.prs[1]!.title).toBe("Second PR");
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--json", "number,title,url,state", "--state", "open"],
      expect.any(Object),
    );
  });

  it("filters by head branch when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify([]),
      stderr: "",
    } as never);

    await ghPrListTool.execute({ head: "feature/my-branch", state: "open" });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--json", "number,title,url,state", "--state", "open", "--head", "feature/my-branch"],
      expect.any(Object),
    );
  });

  it("uses specified state filter", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify([]),
      stderr: "",
    } as never);

    await ghPrListTool.execute({ state: "closed" });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--json", "number,title,url,state", "--state", "closed"],
      expect.any(Object),
    );
  });

  it("throws ToolError on failure", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not a repository"));

    await expect(ghPrListTool.execute({ state: "open" })).rejects.toThrow(ToolError);
  });
});

// ============================================================================
// ghReleaseCreateTool
// ============================================================================

describe("ghReleaseCreateTool", () => {
  it("creates a release with just a tag", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/releases/tag/v1.0.0\n",
      stderr: "",
    } as never);

    const result = await ghReleaseCreateTool.execute({ tag: "v1.0.0" });

    expect(result.url).toBe("https://github.com/owner/repo/releases/tag/v1.0.0");
    expect(result.tag).toBe("v1.0.0");
    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["release", "create", "v1.0.0"],
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("passes title when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/releases/tag/v2.0.0\n",
      stderr: "",
    } as never);

    await ghReleaseCreateTool.execute({
      tag: "v2.0.0",
      title: "Version 2.0.0",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["release", "create", "v2.0.0", "--title", "Version 2.0.0"],
      expect.any(Object),
    );
  });

  it("passes notes when provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/releases/tag/v3.0.0\n",
      stderr: "",
    } as never);

    await ghReleaseCreateTool.execute({
      tag: "v3.0.0",
      notes: "## Changes\n- Added feature X",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["release", "create", "v3.0.0", "--notes", "## Changes\n- Added feature X"],
      expect.any(Object),
    );
  });

  it("passes --draft flag when draft is true", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/releases/tag/v4.0.0\n",
      stderr: "",
    } as never);

    await ghReleaseCreateTool.execute({
      tag: "v4.0.0",
      draft: true,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["release", "create", "v4.0.0", "--draft"],
      expect.any(Object),
    );
  });

  it("passes --prerelease flag when prerelease is true", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/releases/tag/v5.0.0-beta.1\n",
      stderr: "",
    } as never);

    await ghReleaseCreateTool.execute({
      tag: "v5.0.0-beta.1",
      prerelease: true,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["release", "create", "v5.0.0-beta.1", "--prerelease"],
      expect.any(Object),
    );
  });

  it("passes all options together", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "https://github.com/owner/repo/releases/tag/v6.0.0-rc.1\n",
      stderr: "",
    } as never);

    await ghReleaseCreateTool.execute({
      tag: "v6.0.0-rc.1",
      title: "Release Candidate 1",
      notes: "Testing release",
      draft: true,
      prerelease: true,
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      [
        "release", "create", "v6.0.0-rc.1",
        "--title", "Release Candidate 1",
        "--notes", "Testing release",
        "--draft",
        "--prerelease",
      ],
      expect.any(Object),
    );
  });

  it("throws ToolError on failure", async () => {
    mockExeca.mockRejectedValueOnce(new Error("tag already exists"));

    await expect(ghReleaseCreateTool.execute({ tag: "v1.0.0" })).rejects.toThrow(ToolError);
  });
});

// ============================================================================
// githubTools export
// ============================================================================

describe("githubTools", () => {
  it("exports all 7 tools", () => {
    expect(githubTools).toHaveLength(7);
  });

  it("contains all individual tool exports", () => {
    expect(githubTools).toContain(ghCheckAuthTool);
    expect(githubTools).toContain(ghRepoInfoTool);
    expect(githubTools).toContain(ghPrCreateTool);
    expect(githubTools).toContain(ghPrMergeTool);
    expect(githubTools).toContain(ghPrChecksTool);
    expect(githubTools).toContain(ghPrListTool);
    expect(githubTools).toContain(ghReleaseCreateTool);
  });

  it("all tools have unique names", () => {
    const names = githubTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ============================================================================
// ghExec error handling
// ============================================================================

describe("ghExec error wrapping", () => {
  it("wraps Error instances into ToolError with message", async () => {
    const originalError = new Error("command not found: gh");
    mockExeca.mockRejectedValueOnce(originalError);

    try {
      await ghRepoInfoTool.execute({});
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.message).toContain("gh command failed");
      expect(toolError.message).toContain("command not found: gh");
      expect(toolError.tool).toBe("github");
      expect(toolError.cause).toBe(originalError);
    }
  });

  it("wraps non-Error values into ToolError", async () => {
    mockExeca.mockRejectedValueOnce("string error");

    try {
      await ghRepoInfoTool.execute({});
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      const toolError = error as ToolError;
      expect(toolError.message).toContain("gh command failed");
      expect(toolError.message).toContain("string error");
      expect(toolError.cause).toBeUndefined();
    }
  });

  it("uses process.cwd() when no cwd provided", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "Logged in to github.com as testuser",
      stderr: "",
    } as never);

    await ghCheckAuthTool.execute({});

    expect(mockExeca).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });
});
