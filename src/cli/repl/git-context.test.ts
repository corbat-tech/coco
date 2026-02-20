import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatGitLine, formatGitShort, type GitContext } from "./git-context.js";

// ─── getGitContext ────────────────────────────────────────────────────────────

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(),
}));

describe("getGitContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when not a git repo", async () => {
    const { simpleGit } = await import("simple-git");
    vi.mocked(simpleGit).mockReturnValue({
      status: vi.fn().mockRejectedValue(new Error("not a git repo")),
    } as never);

    const { getGitContext } = await import("./git-context.js");
    const result = await getGitContext("/not/a/repo");
    expect(result).toBeNull();
  });

  it("returns context for a clean repo", async () => {
    const { simpleGit } = await import("simple-git");
    vi.mocked(simpleGit).mockReturnValue({
      status: vi.fn().mockResolvedValue({
        current: "main",
        isClean: () => true,
        staged: [],
        modified: [],
        not_added: [],
        ahead: 0,
        behind: 0,
      }),
    } as never);

    const { getGitContext } = await import("./git-context.js");
    const result = await getGitContext("/some/repo");
    expect(result).toEqual({
      branch: "main",
      isDirty: false,
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    });
  });

  it("returns dirty context with staged, modified, untracked and sync info", async () => {
    const { simpleGit } = await import("simple-git");
    vi.mocked(simpleGit).mockReturnValue({
      status: vi.fn().mockResolvedValue({
        current: "feat/my-feature",
        isClean: () => false,
        staged: ["a.ts", "b.ts"],
        modified: ["c.ts"],
        not_added: ["d.ts", "e.ts"],
        ahead: 2,
        behind: 1,
      }),
    } as never);

    const { getGitContext } = await import("./git-context.js");
    const result = await getGitContext("/some/repo");
    expect(result).toEqual({
      branch: "feat/my-feature",
      isDirty: true,
      staged: 2,
      modified: 1,
      untracked: 2,
      ahead: 2,
      behind: 1,
    });
  });

  it('falls back to "HEAD" when current branch is null', async () => {
    const { simpleGit } = await import("simple-git");
    vi.mocked(simpleGit).mockReturnValue({
      status: vi.fn().mockResolvedValue({
        current: null,
        isClean: () => true,
        staged: [],
        modified: [],
        not_added: [],
        ahead: 0,
        behind: 0,
      }),
    } as never);

    const { getGitContext } = await import("./git-context.js");
    const result = await getGitContext("/some/repo");
    expect(result?.branch).toBe("HEAD");
  });
});

// ─── formatGitLine ───────────────────────────────────────────────────────────

const cleanCtx: GitContext = {
  branch: "main",
  isDirty: false,
  staged: 0,
  modified: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
};

describe("formatGitLine", () => {
  it("contains branch name", () => {
    expect(formatGitLine(cleanCtx)).toContain("main");
  });

  it("shows no change indicators for a clean repo", () => {
    const line = formatGitLine(cleanCtx);
    expect(line).not.toContain("+");
    expect(line).not.toContain("~");
    expect(line).not.toContain("?");
    expect(line).not.toContain("↑");
    expect(line).not.toContain("↓");
  });

  it("shows staged, modified, untracked and ahead indicators", () => {
    const ctx: GitContext = {
      ...cleanCtx,
      isDirty: true,
      staged: 3,
      modified: 2,
      untracked: 1,
      ahead: 4,
      behind: 0,
    };
    const line = formatGitLine(ctx);
    expect(line).toContain("+3");
    expect(line).toContain("~2");
    expect(line).toContain("?1");
    expect(line).toContain("↑4");
    expect(line).not.toContain("↓");
  });

  it("shows behind indicator", () => {
    const ctx: GitContext = { ...cleanCtx, isDirty: true, behind: 5 };
    expect(formatGitLine(ctx)).toContain("↓5");
  });

  it("omits zero-count indicators individually", () => {
    const ctx: GitContext = { ...cleanCtx, isDirty: true, staged: 1 };
    const line = formatGitLine(ctx);
    expect(line).toContain("+1");
    expect(line).not.toContain("~");
    expect(line).not.toContain("?");
    expect(line).not.toContain("↑");
    expect(line).not.toContain("↓");
  });

  it("includes the 🌿 emoji", () => {
    expect(formatGitLine(cleanCtx)).toContain("🌿");
  });
});

// ─── formatGitShort ──────────────────────────────────────────────────────────

describe("formatGitShort", () => {
  it("contains branch name", () => {
    expect(formatGitShort(cleanCtx)).toContain("main");
  });

  it("does not show dirty dot for a clean repo", () => {
    expect(formatGitShort(cleanCtx)).not.toContain("●");
  });

  it("shows dirty dot for a dirty repo", () => {
    const ctx: GitContext = { ...cleanCtx, branch: "feat/wip", isDirty: true };
    const short = formatGitShort(ctx);
    expect(short).toContain("feat/wip");
    expect(short).toContain("●");
  });

  it("includes the 🌿 emoji", () => {
    expect(formatGitShort(cleanCtx)).toContain("🌿");
  });
});
