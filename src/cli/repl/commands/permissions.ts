/**
 * /permissions command
 *
 * Manage tool permissions and recommended allowlist.
 *
 * Usage:
 *   /permissions          Show current trust status
 *   /permissions apply    Apply recommended permissions template
 *   /permissions view     View the recommended template details
 *   /permissions reset    Reset all tool permissions (with confirmation)
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import fs from "node:fs/promises";
import type { SlashCommand, ReplSession } from "../types.js";
import { getAllTrustedTools } from "../session.js";
import { CONFIG_PATHS } from "../../../config/paths.js";
import {
  applyRecommendedPermissions,
  showPermissionDetails,
  loadPermissionPreferences,
  savePermissionPreference,
  RECOMMENDED_GLOBAL,
  RECOMMENDED_PROJECT,
  RECOMMENDED_DENY,
} from "../recommended-permissions.js";

export const permissionsCommand: SlashCommand = {
  name: "permissions",
  aliases: ["perms"],
  description: "Manage tool permissions and recommended allowlist",
  usage: "/permissions [apply|view|reset]",

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
  const prefs = await loadPermissionPreferences();

  console.log();
  console.log(chalk.magenta.bold("  🔐 Tool Permissions"));
  console.log();

  const allowCount = RECOMMENDED_GLOBAL.length + RECOMMENDED_PROJECT.length;
  if (prefs.recommendedAllowlistApplied) {
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
  console.log(chalk.dim("  /permissions apply  — Apply recommended permissions"));
  console.log(chalk.dim("  /permissions view   — View recommended template"));
  console.log(chalk.dim("  /permissions reset  — Reset to empty"));
  console.log();
}

/**
 * Apply recommended permissions template
 */
async function applyRecommended(session: ReplSession): Promise<void> {
  await applyRecommendedPermissions();

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
  const emptySettings = {
    globalTrusted: [] as string[],
    projectTrusted: {} as Record<string, string[]>,
    projectDenied: {} as Record<string, string[]>,
    updatedAt: new Date().toISOString(),
  };

  try {
    await fs.writeFile(CONFIG_PATHS.trustedTools, JSON.stringify(emptySettings, null, 2), "utf-8");
  } catch {
    // Silently fail
  }

  // Reset preference flag
  await savePermissionPreference("recommendedAllowlistApplied", false);

  console.log(chalk.green("  ✓ All tool permissions reset."));
}
