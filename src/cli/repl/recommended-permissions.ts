/**
 * Recommended permissions template and first-time suggestion flow
 *
 * Offers new users a curated set of tool permissions organized in 3 tiers:
 * - ALLOW (global): Read-only + write tools, applied once for all projects
 * - ASK: Medium-risk tools that prompt for confirmation each time
 * - DENY: Dangerous patterns that should never be auto-approved
 *
 * Bash patterns use the format from bash-patterns.ts:
 *   "bash:<command>[:<subcommand>]"
 * These match exact patterns only — "bash:git" does NOT approve "bash:git:push".
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_PATHS } from "../../config/paths.js";
import { saveTrustedTool } from "./session.js";

// ============================================================================
// Recommended Template
// ============================================================================

/**
 * ALLOW (global) — Read-only tools safe to trust everywhere.
 * These never modify files, never write to disk, never push to remote.
 *
 * Includes:
 * - Coco native read-only tools (read_file, glob, grep, etc.)
 * - Bash read-only commands (find, cat, ls, head, tail, etc.)
 * - Git read-only subcommands (status, diff, log, branch, show, etc.)
 * - Docker/kubectl read-only inspection commands
 * - Data processing tools (jq, yq, sort, uniq, wc, diff)
 */
export const RECOMMENDED_GLOBAL: string[] = [
  // ── Coco native tools (read-only) ──
  "read_file",
  "glob",
  "list_dir",
  "tree",
  "file_exists",
  "grep",
  "find_in_file",
  "command_exists",
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "run_linter",
  "analyze_complexity",
  "calculate_quality",
  "get_coverage",

  // ── Bash: filesystem read-only ──
  "bash:find",
  "bash:cat",
  "bash:ls",
  "bash:head",
  "bash:tail",
  "bash:tree",
  "bash:pwd",
  "bash:which",
  "bash:wc",
  "bash:echo",
  "bash:diff",

  // ── Bash: data processing (read-only, pipes) ──
  "bash:sort",
  "bash:uniq",
  "bash:jq",
  "bash:yq",
  "bash:grep",

  // ── Bash: git read-only ──
  "bash:git:status",
  "bash:git:log",
  "bash:git:show",
  "bash:git:diff",
  "bash:git:branch",
  "bash:git:ls-files",
  "bash:git:rev-parse",
  "bash:git:fetch",
  "bash:git:worktree",

  // ── Bash: docker read-only ──
  "bash:docker:ps",
  "bash:docker:images",
  "bash:docker:logs",
  "bash:docker:inspect",

  // ── Bash: kubectl read-only ──
  "bash:kubectl:get",
  "bash:kubectl:describe",
  "bash:kubectl:logs",
];

/**
 * ALLOW (write + build) — Tools that modify files, stage changes, run builds.
 * Applied globally (same as RECOMMENDED_GLOBAL). Separated for readability.
 *
 * Includes:
 * - Coco native write tools (write_file, edit_file, git_add, etc.)
 * - Bash filesystem write (mkdir, touch, cp, mv)
 * - Bash build/compile commands (npm/pnpm/yarn, node, java, gradle, mvn, tsc)
 *
 * Note: git_commit and bash:git:commit are intentionally excluded.
 * Commits are in ALWAYS_ASK so users review before coco writes git history.
 * Use `/permissions allow-commits` to opt a specific project into auto-commit.
 */
export const RECOMMENDED_PROJECT: string[] = [
  // ── Coco native tools (write, local) ──
  "write_file",
  "edit_file",
  "copy_file",
  "move_file",
  "git_add",
  "run_tests",
  "run_test_file",
  "run_script",
  "tsc",

  // ── Bash: filesystem write (local, non-destructive) ──
  "bash:mkdir",
  "bash:touch",
  "bash:cp",
  "bash:mv",

  // ── Bash: text processing (can modify files with -i / > redirect) ──
  "bash:sed",
  "bash:awk",

  // ── Bash: JS/TS toolchain ──
  "bash:npm:install",
  "bash:npm:run",
  "bash:npm:test",
  "bash:npm:ci",
  "bash:pnpm:install",
  "bash:pnpm:run",
  "bash:pnpm:test",
  "bash:yarn:install",
  "bash:yarn:run",
  "bash:yarn:test",
  "bash:node",

  // ── Bash: JVM toolchain ──
  "bash:java",
  "bash:javac",
  "bash:kotlinc",
  "bash:gradle:build",
  "bash:gradle:test",
  "bash:gradle:clean",
  "bash:./gradlew:build",
  "bash:./gradlew:test",
  "bash:./gradlew:clean",
  "bash:mvn:compile",
  "bash:mvn:test",
  "bash:mvn:clean",
  "bash:mvn:package",
  "bash:./mvnw:compile",
  "bash:./mvnw:test",
  "bash:./mvnw:clean",
  "bash:./mvnw:package",

  // ── Bash: other build tools ──
  "bash:cargo:build",
  "bash:cargo:test",
  "bash:cargo:check",
  "bash:cargo:clippy",
  "bash:go:build",
  "bash:go:test",
  "bash:go:vet",
  "bash:pip:install",

  // ── Bash: git local (staging only — commit and push are in ASK) ──
  "bash:git:add",
];

/**
 * ASK — Medium-risk tools that always prompt for confirmation.
 * User decides per-invocation. Not denied, but never auto-approved.
 *
 * Includes:
 * - Git commit (local but writes history — opt in per-project with /permissions allow-commits)
 * - Network access (curl, wget, http tools)
 * - Destructive file ops (rm, delete_file)
 * - Git remote + history-rewriting (push, pull, stash, checkout, switch)
 * - Docker exec/build/run (local but can have side-effects)
 * - Cloud read-only (aws, kubectl read queries)
 * - Environment access
 */
export const ALWAYS_ASK: string[] = [
  // ── Git commit — always ask by default; use /permissions allow-commits to opt in ──
  "git_commit",
  "bash:git:commit",

  // ── Coco native (risky) ──
  "delete_file",
  "git_push",
  "git_pull",
  "git_checkout",
  "install_deps",
  "http_fetch",
  "http_json",
  "get_env",

  // ── Bash: network ──
  "bash:curl",
  "bash:wget",

  // ── Bash: destructive filesystem ──
  "bash:rm",

  // ── Bash: git remote + mutable history ──
  "bash:git:stash",
  "bash:git:checkout",
  "bash:git:switch",
  "bash:git:pull",

  // ── Bash: docker (side-effects) ──
  "bash:docker:exec",
  "bash:docker:build",
  "bash:docker:run",
  "bash:docker-compose:up",
  "bash:docker-compose:down",

  // ── Bash: cloud read-only (still needs auth awareness) ──
  "bash:aws:sts",
  "bash:aws:s3",
  "bash:aws:logs",
  "bash:aws:cloudformation",
  "bash:aws:ec2",
  "bash:aws:rds",
  "bash:aws:ecr",
  "bash:aws:iam",

  // ── Bash: process management ──
  "bash:pkill",
  "bash:kill",
];

/**
 * DENY — Dangerous patterns that should never be auto-approved.
 * These are destructive, irreversible, or security-sensitive operations.
 *
 * Note: The DENY list is informational for display purposes.
 * These patterns are never added to the trusted tools set.
 * The trust system's exact-match security ensures untrusted patterns
 * always trigger the confirmation prompt.
 */
export const RECOMMENDED_DENY: string[] = [
  // ── System / privilege escalation ──
  "bash:sudo",
  "bash:chmod",
  "bash:chown",
  "bash:bash",
  "bash:sh",

  // ── Git: destructive / remote-mutating ──
  "bash:git:push",
  "bash:git:merge",
  "bash:git:rebase",
  "bash:git:reset",
  "bash:git:clean",
  "bash:git:tag",
  "bash:git:remote",
  "bash:git:cherry-pick",
  "bash:git:revert",
  "bash:git:config",

  // ── GitHub CLI: mutating ──
  "bash:gh:pr",
  "bash:gh:release",
  "bash:gh:repo",

  // ── Docker: destructive ──
  "bash:docker:push",
  "bash:docker:rm",
  "bash:docker:rmi",
  "bash:docker:stop",
  "bash:docker:kill",

  // ── Kubernetes: mutating ──
  "bash:kubectl:delete",
  "bash:kubectl:apply",
  "bash:kubectl:create",
  "bash:kubectl:exec",
  "bash:kubectl:cp",
  "bash:kubectl:port-forward",

  // ── Package publishing ──
  "bash:npm:publish",
  "bash:yarn:publish",
  "bash:cargo:publish",

  // ── Disk / low-level destructive ──
  "bash:dd",

  // ── Code execution / shell bypass ──
  "bash:eval",
  "bash:source",
];

// ============================================================================
// Preference Persistence (in ~/.coco/config.json)
// ============================================================================

/** Permission preference keys stored in config.json */
export interface PermissionPreferences {
  recommendedAllowlistApplied?: boolean;
  recommendedAllowlistDismissed?: boolean;
}

/**
 * Load permission preferences from ~/.coco/config.json
 */
export async function loadPermissionPreferences(): Promise<PermissionPreferences> {
  try {
    const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;
    return {
      recommendedAllowlistApplied: config.recommendedAllowlistApplied as boolean | undefined,
      recommendedAllowlistDismissed: config.recommendedAllowlistDismissed as boolean | undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Save a permission preference to ~/.coco/config.json
 * Merges with existing config (doesn't overwrite other settings)
 */
export async function savePermissionPreference(
  key: "recommendedAllowlistApplied" | "recommendedAllowlistDismissed",
  value: boolean,
): Promise<void> {
  try {
    let config: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
      config = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet — start fresh
    }

    config[key] = value;

    await fs.mkdir(path.dirname(CONFIG_PATHS.config), { recursive: true });
    await fs.writeFile(CONFIG_PATHS.config, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // Silently fail if we can't save preferences
  }
}

// ============================================================================
// Suggestion Flow
// ============================================================================

/**
 * Check if the recommended permissions suggestion should be shown.
 * Returns true only if user hasn't applied or permanently dismissed.
 */
export async function shouldShowPermissionSuggestion(): Promise<boolean> {
  const prefs = await loadPermissionPreferences();
  return !prefs.recommendedAllowlistApplied && !prefs.recommendedAllowlistDismissed;
}

/**
 * Apply the recommended permissions template.
 * All tools (read + write) are saved as global — apply once, works everywhere.
 */
export async function applyRecommendedPermissions(): Promise<void> {
  // Apply all recommended tools as global
  for (const tool of [...RECOMMENDED_GLOBAL, ...RECOMMENDED_PROJECT]) {
    await saveTrustedTool(tool, null, true);
  }

  // Mark as applied
  await savePermissionPreference("recommendedAllowlistApplied", true);
}

/**
 * Show the recommended permissions prompt to new users.
 *
 * Options:
 * - View details: show full list, then ask to apply
 * - Apply: apply immediately
 * - Later: remind next startup
 * - No thanks: never show again
 */
export async function showPermissionSuggestion(): Promise<void> {
  console.log();
  console.log(chalk.magenta.bold("  📋 Recommended Permissions"));
  console.log();
  console.log(chalk.dim("  Coco has a curated set of tool permissions for developers:"));
  console.log(chalk.dim("  • Allow: file read/write, search, git staging, build, tests..."));
  console.log(chalk.dim("  • Ask each time: git commit, curl, rm, git pull, docker exec, cloud..."));
  console.log(chalk.dim("  • Deny: sudo, git push, git rebase, docker push, k8s apply..."));
  console.log();
  console.log(chalk.dim("  Stored in ~/.coco/trusted-tools.json — edit manually or let"));
  console.log(chalk.dim("  Coco manage it when you approve actions from the prompt."));
  console.log();

  const action = await p.select({
    message: "Apply recommended permissions?",
    options: [
      { value: "view", label: "View details", hint: "See the full list before deciding" },
      { value: "apply", label: "Apply", hint: "Apply recommended permissions now" },
      { value: "later", label: "Later", hint: "Remind me next time" },
      { value: "dismiss", label: "No thanks", hint: "Don't show again" },
    ],
  });

  if (p.isCancel(action) || action === "later") {
    // Will show again next startup
    return;
  }

  if (action === "dismiss") {
    await savePermissionPreference("recommendedAllowlistDismissed", true);
    console.log(chalk.dim("  Won't show again. Use /permissions to apply later."));
    return;
  }

  if (action === "view") {
    showPermissionDetails();

    const applyNow = await p.confirm({
      message: "Apply these permissions?",
      initialValue: true,
    });

    if (p.isCancel(applyNow) || !applyNow) {
      return;
    }
  }

  // Apply template
  await applyRecommendedPermissions();
  console.log(chalk.green("  ✓ Recommended permissions applied"));
  console.log(chalk.dim("  Use /permissions to review or modify anytime."));
}

// ============================================================================
// Detail Display
// ============================================================================

/**
 * Print a list of tools with a symbol prefix, grouped by subcategory.
 * Each group is a [label, items[]] tuple.
 */
function printToolGroup(
  groups: Array<[string, string[]]>,
  symbol: string,
  symbolColor: (s: string) => string,
): void {
  for (const [label, items] of groups) {
    if (items.length === 0) continue;
    console.log(chalk.dim(`    ${label}`));
    for (const tool of items) {
      console.log(`    ${symbolColor(symbol)} ${chalk.dim(tool)}`);
    }
  }
}

/**
 * Show the full recommended permissions list by category.
 *
 * Presents 3 user-facing tiers: Allow, Ask, Deny.
 * Internally ALLOW merges RECOMMENDED_GLOBAL + RECOMMENDED_PROJECT,
 * but grouped by functional type so users understand what each does.
 */
export function showPermissionDetails(): void {
  // Merge both allow lists for display
  const allAllow = [...RECOMMENDED_GLOBAL, ...RECOMMENDED_PROJECT];
  const allowNative = allAllow.filter((t) => !t.startsWith("bash:"));
  const allowBashSimple = allAllow.filter(
    (t) => t.startsWith("bash:") && t.split(":").length === 2,
  );
  const allowBashSub = allAllow.filter((t) => t.startsWith("bash:") && t.split(":").length > 2);

  const askNative = ALWAYS_ASK.filter((t) => !t.startsWith("bash:"));
  const askBash = ALWAYS_ASK.filter((t) => t.startsWith("bash:"));

  const denyBash = RECOMMENDED_DENY;

  const total = allAllow.length + ALWAYS_ASK.length + RECOMMENDED_DENY.length;

  console.log();
  console.log(chalk.bold(`  📋 Recommended Permissions (${total} rules)`));
  console.log();

  // ── Allow ──
  console.log(chalk.green.bold(`  ✅ Allow — auto-approved (${allAllow.length}):`));
  printToolGroup(
    [
      ["Coco tools:", allowNative],
      ["Bash commands:", allowBashSimple],
      ["Bash subcommands:", allowBashSub],
    ],
    "✓",
    chalk.green,
  );
  console.log();

  // ── Ask ──
  console.log(chalk.yellow.bold(`  ❓ Ask — prompt each time (${ALWAYS_ASK.length}):`));
  printToolGroup(
    [
      ["Coco tools:", askNative],
      ["Bash commands:", askBash],
    ],
    "⚠",
    chalk.yellow,
  );
  console.log();

  // ── Deny ──
  console.log(chalk.red.bold(`  🚫 Deny — never auto-approve (${RECOMMENDED_DENY.length}):`));
  printToolGroup([["Bash patterns:", denyBash]], "✗", chalk.red);
  console.log();
}
