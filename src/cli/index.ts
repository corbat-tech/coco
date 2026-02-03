#!/usr/bin/env node

/**
 * Corbat-Coco CLI Entry Point
 */

import { Command } from "commander";
import { VERSION } from "../version.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerConfigCommand } from "./commands/config.js";
import { startRepl } from "./repl/index.js";
import { getDefaultProvider } from "../config/env.js";
import type { ProviderType } from "../providers/index.js";

const program = new Command();

program
  .name("coco")
  .description("Corbat-Coco: Autonomous Coding Agent with Self-Review and Quality Convergence")
  .version(VERSION, "-v, --version", "Output the current version");

// Register commands
registerInitCommand(program);
registerPlanCommand(program);
registerBuildCommand(program);
registerStatusCommand(program);
registerResumeCommand(program);
registerConfigCommand(program);

// Chat command (interactive REPL) - default when no command specified
program
  .command("chat", { isDefault: true })
  .description("Start interactive chat session with the agent")
  .option("-m, --model <model>", "LLM model to use")
  .option("--provider <provider>", "LLM provider (anthropic, openai, gemini, kimi)")
  .option("-p, --path <path>", "Project path", process.cwd())
  .action(async (options: { model?: string; provider?: string; path: string }) => {
    const providerType = (options.provider as ProviderType) ?? getDefaultProvider();
    await startRepl({
      projectPath: options.path,
      config: {
        provider: {
          type: providerType as "anthropic" | "openai",
          model: options.model ?? "",
          maxTokens: 8192,
        },
      },
    });
  });

// Load environment variables lazily (performance: async instead of sync import)
async function main(): Promise<void> {
  // Load dotenv only when needed, not at module import time
  await import("dotenv/config");
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
