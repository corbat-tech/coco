/**
 * /clear command
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { clearSession } from "../session.js";
import { getGitContext } from "../git-context.js";
import { renderStartupPanel } from "../startup-panel.js";
import { getDefaultModel } from "../../../config/env.js";

export const clearCommand: SlashCommand = {
  name: "clear",
  aliases: ["c"],
  description: "Clear conversation history",
  usage: "/clear",

  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    clearSession(session);
    // Clear terminal and repaint startup panel so the UI looks like a fresh launch.
    process.stdout.write("\x1b[2J\x1b[H");
    const projectPath = session.projectPath || process.cwd();
    const gitCtx = await getGitContext(projectPath);
    const panelSession = {
      ...session,
      projectPath,
      config: session.config ?? {
        provider: {
          type: "anthropic",
          model: getDefaultModel("anthropic"),
          maxTokens: 8192,
        },
      },
    } as ReplSession;
    await renderStartupPanel(panelSession, gitCtx);
    console.log(chalk.dim("Context cleared.\n"));
    return false; // Don't exit
  },
};
