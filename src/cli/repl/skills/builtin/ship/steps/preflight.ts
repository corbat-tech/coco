/**
 * Ship Step: Preflight
 *
 * Validates repository state, detects project characteristics
 * (stack, CI, version file, changelog, package manager), and
 * verifies that the GitHub CLI is available and authenticated.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { gitStatusTool } from "../../../../../../tools/git.js";
import { bashExecTool } from "../../../../../../tools/bash.js";
import { ghCheckAuthTool, ghRepoInfoTool } from "../../../../../../tools/github.js";
import { fileExists } from "../../../../../../utils/files.js";
import { detectVersionFile } from "../version-detector.js";
import { detectChangelog } from "../changelog.js";
import type {
  ProjectProfile,
  ProjectStack,
  CISystem,
  ShipStepResult,
} from "../types.js";

// ============================================================================
// Stack detection
// ============================================================================

async function detectStack(cwd: string): Promise<ProjectStack> {
  if (await fileExists(path.join(cwd, "package.json"))) return "node";
  if (await fileExists(path.join(cwd, "Cargo.toml"))) return "rust";
  if (await fileExists(path.join(cwd, "pyproject.toml"))) return "python";
  if (await fileExists(path.join(cwd, "go.mod"))) return "go";
  if (await fileExists(path.join(cwd, "pom.xml"))) return "java";
  return "unknown";
}

// ============================================================================
// Package manager detection
// ============================================================================

async function detectPackageManager(
  cwd: string,
  stack: ProjectStack,
): Promise<ProjectProfile["packageManager"]> {
  if (stack === "rust") return "cargo";
  if (stack === "python") return "pip";
  if (stack === "go") return "go";

  if (stack === "node") {
    if (await fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (await fileExists(path.join(cwd, "yarn.lock"))) return "yarn";
    if (await fileExists(path.join(cwd, "bun.lockb"))) return "bun";
    return "npm";
  }

  return null;
}

// ============================================================================
// CI detection
// ============================================================================

async function detectCI(cwd: string): Promise<CISystem> {
  const ghDir = path.join(cwd, ".github", "workflows");
  if (await fileExists(ghDir)) {
    // List workflow files
    let workflowFiles: string[] = [];
    let hasCodeQL = false;
    let hasLinting = false;

    try {
      const result = await bashExecTool.execute({
        command: "ls .github/workflows/",
        cwd,
      });
      workflowFiles = result.stdout
        .trim()
        .split("\n")
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

      // Check for CodeQL and linting in workflow names/content
      for (const file of workflowFiles) {
        const lower = file.toLowerCase();
        if (lower.includes("codeql") || lower.includes("code-scanning")) {
          hasCodeQL = true;
        }
        if (lower.includes("lint") || lower.includes("eslint") || lower.includes("oxlint")) {
          hasLinting = true;
        }
      }
    } catch {
      // Can't list, but directory exists
    }

    return { type: "github-actions", workflowFiles, hasCodeQL, hasLinting };
  }

  if (await fileExists(path.join(cwd, ".gitlab-ci.yml"))) {
    return { type: "gitlab-ci", workflowFiles: [".gitlab-ci.yml"], hasCodeQL: false, hasLinting: false };
  }

  if (await fileExists(path.join(cwd, ".circleci"))) {
    return { type: "circle-ci", workflowFiles: [], hasCodeQL: false, hasLinting: false };
  }

  return { type: "none", workflowFiles: [], hasCodeQL: false, hasLinting: false };
}

// ============================================================================
// Command detection
// ============================================================================

async function detectCommands(
  cwd: string,
  stack: ProjectStack,
  pm: ProjectProfile["packageManager"],
): Promise<{ lint: string | null; test: string | null; build: string | null }> {
  if (stack === "node" && pm) {
    try {
      const result = await bashExecTool.execute({
        command: "cat package.json",
        cwd,
      });
      const pkg = JSON.parse(result.stdout) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};

      return {
        lint: scripts.lint ? `${pm} lint` : null,
        test: scripts.test ? `${pm} test` : null,
        build: scripts.build ? `${pm} build` : null,
      };
    } catch {
      // Fallback
    }
  }

  if (stack === "rust") {
    return {
      lint: "cargo clippy",
      test: "cargo test",
      build: "cargo build",
    };
  }

  if (stack === "python") {
    return {
      lint: null,
      test: "pytest",
      build: null,
    };
  }

  if (stack === "go") {
    return {
      lint: "golangci-lint run",
      test: "go test ./...",
      build: "go build ./...",
    };
  }

  return { lint: null, test: null, build: null };
}

// ============================================================================
// Main preflight
// ============================================================================

export async function runPreflight(cwd: string): Promise<{
  result: ShipStepResult;
  profile?: ProjectProfile;
}> {
  const start = performance.now();

  // 1. Check gh CLI auth
  const auth = await ghCheckAuthTool.execute({ cwd });
  if (!auth.authenticated) {
    return {
      result: {
        step: "preflight",
        status: "failed",
        message: "GitHub CLI not authenticated",
        details: "Install gh CLI and run: gh auth login",
        durationMs: performance.now() - start,
      },
    };
  }

  // 2. Git status
  const status = await gitStatusTool.execute({ cwd });
  const hasChanges =
    !status.isClean ||
    status.staged.length > 0 ||
    status.modified.length > 0 ||
    status.untracked.length > 0;

  if (!hasChanges) {
    return {
      result: {
        step: "preflight",
        status: "failed",
        message: "No changes to ship",
        details: "Working tree is clean — make some changes first.",
        durationMs: performance.now() - start,
      },
    };
  }

  // 3. Detect default branch
  let defaultBranch = "main";
  try {
    const repoInfo = await ghRepoInfoTool.execute({ cwd });
    defaultBranch = repoInfo.defaultBranch;
  } catch {
    // Fallback to main
  }

  // 4. Detect everything in parallel
  const stack = await detectStack(cwd);
  const pm = await detectPackageManager(cwd, stack);
  const [versionFile, changelog, ci, commands] = await Promise.all([
    detectVersionFile(cwd),
    detectChangelog(cwd),
    detectCI(cwd),
    detectCommands(cwd, stack, pm),
  ]);

  const profile: ProjectProfile = {
    stack,
    versionFile,
    changelog,
    ci,
    defaultBranch,
    currentBranch: status.branch,
    hasUncommittedChanges: hasChanges,
    packageManager: pm,
    lintCommand: commands.lint,
    testCommand: commands.test,
    buildCommand: commands.build,
  };

  return {
    result: {
      step: "preflight",
      status: "passed",
      message: `Detected: ${stack} project on branch \`${status.branch}\``,
      details: [
        `Version: ${versionFile ? versionFile.currentVersion : "none"}`,
        `CI: ${ci.type}`,
        `Changelog: ${changelog ? changelog.path : "none"}`,
        `PM: ${pm ?? "unknown"}`,
      ].join(" | "),
      durationMs: performance.now() - start,
    },
    profile,
  };
}
