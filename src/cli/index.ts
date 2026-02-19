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
import { registerMCPCommand } from "./commands/mcp.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { startRepl } from "./repl/index.js";
import { runOnboardingV2 } from "./repl/onboarding-v2.js";
import { getLastUsedProvider } from "../config/env.js";
import { formatError } from "../utils/errors.js";
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
registerMCPCommand(program);
registerSkillsCommand(program);

// Setup command - configure provider
program
  .command("setup")
  .description("Configure AI provider and API key")
  .action(async () => {
    const result = await runOnboardingV2();
    if (result) {
      console.log("\n✅ Configuration saved! Run `coco` to start coding.");
    } else {
      console.log("\n❌ Setup cancelled.");
    }
  });

// Chat command (interactive REPL) - default when no command specified
program
  .command("chat", { isDefault: true })
  .description("Start interactive chat session with the agent")
  .option("-m, --model <model>", "LLM model to use")
  .option("--provider <provider>", "LLM provider (anthropic, openai, codex, gemini, kimi)")
  .option("-p, --path <path>", "Project path", process.cwd())
  .option("--setup", "Run setup wizard before starting")
  .action(async (options: { model?: string; provider?: string; path: string; setup?: boolean }) => {
    // Run setup if requested
    if (options.setup) {
      const result = await runOnboardingV2();
      if (!result) {
        console.log("\n❌ Setup cancelled.");
        return;
      }
    }

    // Use last used provider from preferences (falls back to env/anthropic)
    const providerType = (options.provider as ProviderType) ?? getLastUsedProvider();
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

async function main(): Promise<void> {
  // API keys are loaded from ~/.coco/.env by config/env.ts (no project .env needed)
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});
