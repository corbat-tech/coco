/**
 * Tests for ship skill — index.ts (parseArgs, logStep, shouldAbort, buildResult, formatSummary, skill definition)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all step dependencies
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("./steps/preflight.js", () => ({
  runPreflight: vi.fn(),
}));
vi.mock("./steps/review.js", () => ({
  runReview: vi.fn(),
}));
vi.mock("./steps/test-coverage.js", () => ({
  runTestCoverage: vi.fn(),
}));
vi.mock("./steps/lint-security.js", () => ({
  runLintSecurity: vi.fn(),
}));
vi.mock("./steps/branch.js", () => ({
  runBranch: vi.fn(),
}));
vi.mock("./steps/version.js", () => ({
  runVersion: vi.fn(),
}));
vi.mock("./steps/commit-push.js", () => ({
  runCommitPush: vi.fn(),
}));
vi.mock("./steps/pull-request.js", () => ({
  runPullRequest: vi.fn(),
}));
vi.mock("./steps/ci-checks.js", () => ({
  runCIChecks: vi.fn(),
}));
vi.mock("./steps/merge-release.js", () => ({
  runMergeRelease: vi.fn(),
}));

import { shipSkill } from "./index.js";
import { runPreflight } from "./steps/preflight.js";
import { runReview } from "./steps/review.js";
import { runTestCoverage } from "./steps/test-coverage.js";
import { runLintSecurity } from "./steps/lint-security.js";
import { runBranch } from "./steps/branch.js";
import { runVersion } from "./steps/version.js";
import { runCommitPush } from "./steps/commit-push.js";
import { runPullRequest } from "./steps/pull-request.js";
import { runCIChecks } from "./steps/ci-checks.js";
import { runMergeRelease } from "./steps/merge-release.js";
import type { SkillContext } from "../../types.js";
import type { ShipStepResult, ProjectProfile } from "./types.js";

const mockProfile: ProjectProfile = {
  stack: "node",
  versionFile: { path: "package.json", stack: "node", currentVersion: "1.0.0", field: "version" },
  changelog: { path: "CHANGELOG.md", format: "keep-a-changelog" },
  ci: {
    type: "github-actions",
    workflowFiles: [".github/workflows/ci.yml"],
    hasCodeQL: true,
    hasLinting: true,
  },
  defaultBranch: "main",
  currentBranch: "feat/test",
  hasUncommittedChanges: true,
  packageManager: "pnpm",
  lintCommand: "pnpm lint",
  testCommand: "pnpm test",
  buildCommand: "pnpm build",
};

function passedStep(step: string): ShipStepResult {
  return { step, status: "passed", message: `${step} passed`, durationMs: 100 };
}

function failedStep(step: string): ShipStepResult {
  return { step, status: "failed", message: `${step} failed`, durationMs: 50 };
}

function skippedStep(step: string): ShipStepResult {
  return { step, status: "skipped", message: `${step} skipped`, durationMs: 0 };
}

const context: SkillContext = {
  cwd: "/tmp/test-project",
  session: {} as any,
};

describe("shipSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("skill definition", () => {
    it("should have correct metadata", () => {
      expect(shipSkill.name).toBe("ship");
      expect(shipSkill.description).toBeTruthy();
      expect(shipSkill.category).toBe("git");
      expect(shipSkill.aliases).toContain("release");
      expect(shipSkill.aliases).toContain("deploy");
      expect(shipSkill.aliases).toContain("publish");
      expect(shipSkill.usage).toContain("/ship");
    });
  });

  describe("execute — full pipeline success", () => {
    it("should run all 10 steps on success", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(passedStep("branch"));
      vi.mocked(runVersion).mockResolvedValue(passedStep("version"));
      vi.mocked(runCommitPush).mockResolvedValue(passedStep("commit"));
      vi.mocked(runPullRequest).mockResolvedValue(passedStep("pr"));
      vi.mocked(runCIChecks).mockResolvedValue(passedStep("ci"));
      vi.mocked(runMergeRelease).mockResolvedValue(passedStep("merge"));

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(true);
      expect(result.output).toContain("Ship Summary");
      expect(runMergeRelease).toHaveBeenCalled();
    });
  });

  describe("execute — preflight failure aborts", () => {
    it("should abort on preflight failure", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: { ...failedStep("preflight"), details: "Not a git repo" },
        profile: undefined as any,
      });

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(false);
      expect(result.error).toContain("preflight");
      expect(runReview).not.toHaveBeenCalled();
    });
  });

  describe("execute — step failure aborts", () => {
    it("should abort on review failure", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(false);
      expect(runTestCoverage).not.toHaveBeenCalled();
    });

    it("should abort on test failure", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(failedStep("tests"));

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(false);
      expect(runLintSecurity).not.toHaveBeenCalled();
    });

    it("should abort on lint failure", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(failedStep("lint"));

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(false);
      expect(runBranch).not.toHaveBeenCalled();
    });

    it("should abort on branch failure", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(failedStep("branch"));

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(false);
    });

    it("should abort on cancelled step", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue({
        step: "review",
        status: "cancelled",
        message: "User cancelled",
        durationMs: 0,
      });

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(false);
      expect(result.output).toContain("!");
    });
  });

  describe("execute — skipped steps", () => {
    it("should include skipped steps in summary", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(skippedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(passedStep("branch"));
      vi.mocked(runVersion).mockResolvedValue(passedStep("version"));
      vi.mocked(runCommitPush).mockResolvedValue(passedStep("commit"));
      vi.mocked(runPullRequest).mockResolvedValue(passedStep("pr"));
      vi.mocked(runCIChecks).mockResolvedValue(passedStep("ci"));
      vi.mocked(runMergeRelease).mockResolvedValue(passedStep("merge"));

      const result = await shipSkill.execute("--skip-review", context);
      expect(result.success).toBe(true);
      expect(result.output).toContain("~");
    });
  });

  describe("execute — args parsing", () => {
    it("should pass --skip-tests to context", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(skippedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(passedStep("branch"));
      vi.mocked(runVersion).mockResolvedValue(passedStep("version"));
      vi.mocked(runCommitPush).mockResolvedValue(passedStep("commit"));
      vi.mocked(runPullRequest).mockResolvedValue(passedStep("pr"));
      vi.mocked(runCIChecks).mockResolvedValue(passedStep("ci"));
      vi.mocked(runMergeRelease).mockResolvedValue(passedStep("merge"));

      await shipSkill.execute("--skip-tests --draft --minor --base develop", context);

      // Check that runTestCoverage received context with options
      const call = vi.mocked(runTestCoverage).mock.calls[0]?.[0];
      expect(call?.options.skipTests).toBe(true);
      expect(call?.options.draft).toBe(true);
      expect(call?.options.forceBump).toBe("minor");
      expect(call?.options.baseBranch).toBe("develop");
    });

    it("should parse --no-version and --no-changelog", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(passedStep("branch"));
      vi.mocked(runVersion).mockResolvedValue(passedStep("version"));
      vi.mocked(runCommitPush).mockResolvedValue(passedStep("commit"));
      vi.mocked(runPullRequest).mockResolvedValue(passedStep("pr"));
      vi.mocked(runCIChecks).mockResolvedValue(passedStep("ci"));
      vi.mocked(runMergeRelease).mockResolvedValue(passedStep("merge"));

      await shipSkill.execute("--no-version --no-changelog", context);

      const call = vi.mocked(runVersion).mock.calls[0]?.[0];
      expect(call?.options.noVersion).toBe(true);
      expect(call?.options.noChangelog).toBe(true);
    });

    it("should parse -m commit message", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(passedStep("branch"));
      vi.mocked(runVersion).mockResolvedValue(passedStep("version"));
      vi.mocked(runCommitPush).mockResolvedValue(passedStep("commit"));
      vi.mocked(runPullRequest).mockResolvedValue(passedStep("pr"));
      vi.mocked(runCIChecks).mockResolvedValue(passedStep("ci"));
      vi.mocked(runMergeRelease).mockResolvedValue(passedStep("merge"));

      await shipSkill.execute("-m feat: add new feature", context);

      const call = vi.mocked(runCommitPush).mock.calls[0]?.[0];
      expect(call?.options.commitMessage).toBe("feat: add new feature");
    });

    it("should parse --patch force bump", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      await shipSkill.execute("--patch", context);

      const call = vi.mocked(runReview).mock.calls[0]?.[0];
      expect(call?.options.forceBump).toBe("patch");
    });

    it("should parse --major force bump", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      await shipSkill.execute("--major", context);

      const call = vi.mocked(runReview).mock.calls[0]?.[0];
      expect(call?.options.forceBump).toBe("major");
    });

    it("should parse --no-tests alias", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      await shipSkill.execute("--no-tests", context);

      const call = vi.mocked(runReview).mock.calls[0]?.[0];
      expect(call?.options.skipTests).toBe(true);
    });

    it("should parse --no-review alias", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      await shipSkill.execute("--no-review", context);

      const call = vi.mocked(runReview).mock.calls[0]?.[0];
      expect(call?.options.skipReview).toBe(true);
    });

    it("should parse -b alias for --base", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      await shipSkill.execute("-b develop", context);

      const call = vi.mocked(runReview).mock.calls[0]?.[0];
      expect(call?.options.baseBranch).toBe("develop");
    });

    it("should parse --message alias for -m", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(failedStep("review"));

      await shipSkill.execute("--message fix: bug repair", context);

      const call = vi.mocked(runReview).mock.calls[0]?.[0];
      expect(call?.options.commitMessage).toBe("fix: bug repair");
    });
  });

  describe("execute — PR url in output", () => {
    it("should include PR url in summary when available", async () => {
      vi.mocked(runPreflight).mockResolvedValue({
        result: passedStep("preflight"),
        profile: mockProfile,
      });
      vi.mocked(runReview).mockResolvedValue(passedStep("review"));
      vi.mocked(runTestCoverage).mockResolvedValue(passedStep("tests"));
      vi.mocked(runLintSecurity).mockResolvedValue(passedStep("lint"));
      vi.mocked(runBranch).mockResolvedValue(passedStep("branch"));
      vi.mocked(runVersion).mockResolvedValue(passedStep("version"));
      vi.mocked(runCommitPush).mockResolvedValue(passedStep("commit"));
      vi.mocked(runPullRequest).mockImplementation(async (ctx) => {
        ctx.prUrl = "https://github.com/test/repo/pull/42";
        return passedStep("pr");
      });
      vi.mocked(runCIChecks).mockResolvedValue(passedStep("ci"));
      vi.mocked(runMergeRelease).mockImplementation(async (ctx) => {
        ctx.newVersion = "1.1.0";
        return passedStep("merge");
      });

      const result = await shipSkill.execute("", context);
      expect(result.success).toBe(true);
      expect(result.output).toContain("https://github.com/test/repo/pull/42");
      expect(result.output).toContain("1.1.0");
    });
  });
});
