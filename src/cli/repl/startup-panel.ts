/**
 * Shared startup panel renderer.
 *
 * Used on initial REPL boot and when resetting the screen via /clear.
 */

import chalk from "chalk";
import stringWidth from "string-width";
import { VERSION } from "../../version.js";
import { createTrustStore } from "./trust-store.js";
import { getDefaultModel } from "../../config/env.js";
import { isQualityLoop } from "./quality-loop.js";
import { formatGitLine, type GitContext } from "./git-context.js";
import type { ReplConfig } from "./types.js";
import type { UnifiedSkillRegistry } from "../../skills/registry.js";

export async function renderStartupPanel(
  session: {
    projectPath: string;
    config: ReplConfig;
    skillRegistry?: UnifiedSkillRegistry;
  },
  gitCtx: GitContext | null,
  mcpServers: string[] = [],
): Promise<void> {
  const trustStore = createTrustStore();
  await trustStore.init();
  const trustLevel = trustStore.getLevel(session.projectPath);

  const boxWidth = 41;
  const innerWidth = boxWidth - 2;

  const versionText = `v${VERSION}`;
  const subtitleText = "open source • corbat.tech";

  const boxLine = (content: string): string => {
    const pad = Math.max(0, innerWidth - stringWidth(content));
    return chalk.magenta("│") + content + " ".repeat(pad) + chalk.magenta("│");
  };

  const titleLeftRaw = " COCO";
  const titleRightRaw = versionText + " ";
  const titleLeftStyled = " " + chalk.bold.white("COCO");
  const titleGap = Math.max(1, innerWidth - stringWidth(titleLeftRaw) - stringWidth(titleRightRaw));
  const titleContent = titleLeftStyled + " ".repeat(titleGap) + chalk.dim(titleRightRaw);

  const taglineText = "code that converges to quality";
  const taglineContent = " " + chalk.magenta(taglineText) + " ";
  const subtitleContent = " " + chalk.dim(subtitleText) + " ";

  console.log();
  console.log(chalk.magenta("  ╭" + "─".repeat(boxWidth - 2) + "╮"));
  console.log("  " + boxLine(titleContent));
  console.log("  " + boxLine(taglineContent));
  console.log("  " + boxLine(subtitleContent));
  console.log(chalk.magenta("  ╰" + "─".repeat(boxWidth - 2) + "╯"));

  const maxPathLen = 50;
  let displayPath = session.projectPath;
  if (displayPath.length > maxPathLen) {
    displayPath = "..." + displayPath.slice(-maxPathLen + 3);
  }

  const lastSep = displayPath.lastIndexOf("/");
  const parentPath = lastSep > 0 ? displayPath.slice(0, lastSep + 1) : "";
  const projectName = lastSep > 0 ? displayPath.slice(lastSep + 1) : displayPath;

  const providerName = session.config.provider.type;
  const configuredModel = session.config.provider.model?.trim();
  const modelName =
    configuredModel &&
    !["default", "none", "null", "undefined"].includes(configuredModel.toLowerCase())
      ? configuredModel
      : getDefaultModel(session.config.provider.type);
  const trustText =
    trustLevel === "full"
      ? "full"
      : trustLevel === "write"
        ? "write"
        : trustLevel === "read"
          ? "read"
          : "";

  console.log();
  console.log(chalk.dim(`  📁 ${parentPath}`) + chalk.magenta.bold(projectName));
  console.log(
    chalk.dim(`  🤖 ${providerName}/`) +
      chalk.magenta(modelName) +
      (trustText ? chalk.dim(` • 🔐 ${trustText}`) : ""),
  );
  if (gitCtx) {
    console.log(`  ${formatGitLine(gitCtx)}`);
  }

  const cocoStatus = isQualityLoop()
    ? chalk.magenta("  🔄 quality mode: ") +
      chalk.green.bold("on") +
      chalk.dim(" — iterates until quality ≥ 85. /quality to disable")
    : chalk.dim("  💡 quality mode is Coco's edge for robust code. Enable with /quality on");
  console.log(cocoStatus);

  const skillTotal = session.skillRegistry?.size ?? 0;
  const hasSomething = skillTotal > 0 || mcpServers.length > 0;
  if (hasSomething) {
    if (skillTotal > 0) {
      const allMeta = session.skillRegistry!.getAllMetadata();
      const builtinCount = allMeta.filter((s) => s.scope === "builtin").length;
      const projectCount = skillTotal - builtinCount;
      const parts: string[] = [];
      if (builtinCount > 0) parts.push(`${builtinCount} builtin`);
      if (projectCount > 0) parts.push(`${projectCount} project`);
      const detail = parts.length > 0 ? ` (${parts.join(" · ")})` : "";
      console.log(chalk.green("  ✓") + chalk.dim(` Skills: ${skillTotal} loaded${detail}`));
    } else {
      console.log(chalk.dim("  · Skills: none loaded"));
    }
    if (mcpServers.length > 0) {
      const names = mcpServers.join(", ");
      console.log(
        chalk.green("  ✓") +
          chalk.dim(
            ` MCP: ${names} (${mcpServers.length} server${mcpServers.length === 1 ? "" : "s"} active)`,
          ),
      );
    }
  }

  console.log();
  console.log(
    chalk.dim("  Type your request or ") + chalk.magenta("/help") + chalk.dim(" for commands"),
  );
  const pasteHint =
    process.platform === "darwin"
      ? chalk.dim("  📋 ⌘V paste text • ⌃V paste image")
      : chalk.dim("  📋 Ctrl+V paste image from clipboard");
  console.log(pasteHint);
  console.log();
}
