/**
 * /permissions command
 *
 * Manage tool permissions and recommended allowlist.
 *
 * Usage:
 *   /permissions                Show current trust status
 *   /permissions apply          Apply recommended permissions template
 *   /permissions view           View the recommended template details
 *   /permissions reset          Reset all tool permissions (with confirmation)
 *   /permissions allow-commits  Auto-approve git commit for this project
 *   /permissions revoke-commits Require confirmation for git commit again
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";
import type { SlashCommand, ReplSession } from "../types.js";
import { getAllTrustedTools, saveTrustedTool, removeTrustedTool } from "../session.js";
import {
  applyRecommendedPermissions,
  showPermissionDetails,
  saveProjectPermissionPreference,
  getProjectPermissionState,
  RECOMMENDED_GLOBAL,
  RECOMMENDED_PROJECT,
  RECOMMENDED_DENY,
} from "../recommended-permissions.js";

export const permissionsCommand: SlashCommand = {
  name: "permissions",
  aliases: ["perms"],
  description: "Manage tool permissions and recommended allowlist",
  usage: "/permissions [apply|view|reset|allow-commits|revoke-commits]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const subcommand = args[0]?.toLowerCase() ?? "status";

    switch (subcommand) {
      case "apply":
        await applyRecommended(session);
        return false;
      case "view":
        showPermissionDetails();
        return false;
      case "reset":
        await resetPermissions(session);
        return false;
      case "allow-commits":
        await allowCommits(session);
        return false;
      case "revoke-commits":
        await revokeCommits(session);
        return false;
      case "status":
      default:
        await showStatus(session);
        return false;
    }
  },
};

/**
 * Show current trust status
 */
async function showStatus(session: ReplSession): Promise<void> {
  const tools = await getAllTrustedTools(session.projectPath);
  const permissionState = await getProjectPermissionState(session.projectPath);

  console.log();
  console.log(chalk.magenta.bold("  🔐 Tool Permissions"));
  console.log();

  const allowCount = RECOMMENDED_GLOBAL.length + RECOMMENDED_PROJECT.length;
  if (permissionState.applied) {
    console.log(
      chalk.green("  ✓ Recommended allowlist applied") +
        chalk.dim(` (${allowCount} allow, ${RECOMMENDED_DENY.length} deny)`),
    );
  } else {
    console.log(chalk.yellow("  ○ Recommended allowlist not applied"));
  }

  // Merge global + project into a single trusted list for display
  const allTrusted = [...new Set([...tools.global, ...tools.project])].sort();
  console.log();
  console.log(chalk.bold(`  Trusted tools (${allTrusted.length}):`));
  if (allTrusted.length === 0) {
    console.log(chalk.dim("    (none)"));
  } else {
    for (const tool of allTrusted) {
      const isDenied = tools.denied.includes(tool);
      if (isDenied) {
        console.log(chalk.dim(`    ✓ ${tool}`) + chalk.red(" ← denied for this project"));
      } else {
        console.log(chalk.dim(`    ✓ ${tool}`));
      }
    }
  }

  // Show project deny list
  if (tools.denied.length > 0) {
    console.log();
    console.log(chalk.bold(`  Project denied (${tools.denied.length}):`));
    for (const tool of tools.denied.sort()) {
      console.log(chalk.red(`    ✗ ${tool}`));
    }
  }

  console.log();
  console.log(chalk.dim("  /permissions apply          — Apply recommended permissions"));
  console.log(chalk.dim("  /permissions view           — View recommended template"));
  console.log(chalk.dim("  /permissions reset          — Reset to empty"));
  console.log(
    chalk.dim("  /permissions allow-commits  — Auto-approve git commit for this project"),
  );
  console.log(
    chalk.dim("  /permissions revoke-commits — Require confirmation for git commit again"),
  );
  console.log();
}

/**
 * Apply recommended permissions template
 */
async function applyRecommended(session: ReplSession): Promise<void> {
  await applyRecommendedPermissions(session.projectPath);

  // Reload into current session
  for (const tool of RECOMMENDED_GLOBAL) {
    session.trustedTools.add(tool);
  }
  for (const tool of RECOMMENDED_PROJECT) {
    session.trustedTools.add(tool);
  }

  console.log(chalk.green("  ✓ Recommended permissions applied!"));
  console.log(chalk.dim("  Use /permissions to review."));
}

/**
 * Opt this project into auto-approving git commits.
 * By default git commit always asks — this is the explicit per-project opt-in.
 */
async function allowCommits(session: ReplSession): Promise<void> {
  const commitTools = ["git_commit", "bash:git:commit"];
  for (const tool of commitTools) {
    session.trustedTools.add(tool);
    await saveTrustedTool(tool, session.projectPath, false);
  }
  console.log(chalk.green("  ✓ git commit will be auto-approved for this project"));
  console.log(chalk.dim("  Use /permissions revoke-commits to require confirmation again."));
}

/**
 * Revert the per-project auto-commit opt-in, restoring the default ask behaviour.
 * Removes from both project-level and global trust so the change is reliable
 * regardless of how commits were originally trusted (prompt 't', '!', or allow-commits).
 */
async function revokeCommits(session: ReplSession): Promise<void> {
  const commitTools = ["git_commit", "bash:git:commit"];
  for (const tool of commitTools) {
    session.trustedTools.delete(tool);
    await removeTrustedTool(tool, session.projectPath, false); // remove project-level trust
    await removeTrustedTool(tool, session.projectPath, true); // remove global trust if present
  }
  console.log(chalk.yellow("  ○ git commit will now require confirmation for this project"));
  console.log(chalk.dim("  Use /permissions allow-commits to enable auto-approve again."));
}

/**
 * Reset all tool permissions (with confirmation)
 */
async function resetPermissions(session: ReplSession): Promise<void> {
  const confirmed = await p.confirm({
    message: "Reset all tool permissions? This removes all trusted tools.",
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    console.log(chalk.dim("  Cancelled."));
    return;
  }

  // Clear session trusted tools
  session.trustedTools.clear();

  // Clear persisted trust settings (including project deny lists)
  const emptyProjectSettings = {
    trusted: [] as string[],
    denied: [] as string[],
    updatedAt: new Date().toISOString(),
  };

  try {
    const projectTrustPath = `${session.projectPath}/.coco/trusted-tools.json`;
    await fs.mkdir(`${session.projectPath}/.coco`, { recursive: true });
    await fs.writeFile(projectTrustPath, JSON.stringify(emptyProjectSettings, null, 2), "utf-8");
  } catch {
    // Silently fail
  }

  const permissionScopePath = session.projectPath;
  // Reset project-scoped preference flags
  await saveProjectPermissionPreference(
    "recommendedAllowlistAppliedProjects",
    permissionScopePath,
    false,
  );
  await saveProjectPermissionPreference(
    "recommendedAllowlistDismissedProjects",
    permissionScopePath,
    false,
  );

  console.log(chalk.green("  ✓ All tool permissions reset."));
}
