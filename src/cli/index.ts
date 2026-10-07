#!/usr/bin/env node

/**
 * Corbat-Coco CLI Entry Point
 */

import { Command, CommanderError } from "commander";
import { requestsHeadlessJson } from "./headless-invocation.js";
import { stripVTControlCharacters } from "node:util";
import { installProxyDispatcher } from "../utils/proxy.js";
import { VERSION } from "../version.js";

// Install HTTP(S)_PROXY dispatcher before any fetch() call happens.
// Node's built-in fetch does not honor proxy env vars without this.
installProxyDispatcher();
import { registerInitCommand } from "./commands/init.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerMCPCommand } from "./commands/mcp.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerCheckCommand } from "./commands/check.js";
import { registerSwarmCommand } from "./commands/swarm.js";
import { startRepl } from "./repl/index.js";
import { runHeadless, headlessFailure, writeHeadlessResult } from "./headless.js";
import { runOnboardingV2, saveConfiguration } from "./repl/onboarding-v2.js";
import { runWithDeferredUpdateNotice } from "./deferred-update.js";
import { getLastUsedProvider } from "../config/env.js";
import { formatError } from "../utils/errors.js";
import type { ProviderType } from "../providers/index.js";

const program = new Command();
const headlessJson = requestsHeadlessJson(process.argv.slice(2));
if (headlessJson) {
  program.exitOverride();
  program.configureOutput({
    outputError: (message) =>
      writeHeadlessResult(headlessFailure(stripVTControlCharacters(message).trim()), "json"),
  });
}

program
  .name("coco")
  .description("Corbat-Coco: Autonomous Coding Agent with Self-Review and Quality Convergence")
  .version(VERSION, "-v, --version", "Output the current version")
  .addHelpText(
    "after",
    "\nRun coco to start an interactive session. See coco chat --help for provider, model, and headless (--print/--output) options.",
  );

// Register commands
registerInitCommand(program);
registerPlanCommand(program);
registerBuildCommand(program);
registerStatusCommand(program);
registerResumeCommand(program);
registerConfigCommand(program);
registerMCPCommand(program);
registerSkillsCommand(program);
registerCheckCommand(program);
registerSwarmCommand(program);

// Setup command - configure provider
program
  .command("setup")
  .description("Configure AI provider and API key")
  .action(async () => {
    const result = await runOnboardingV2();
    if (result && (await saveConfiguration(result))) {
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
  .option("--editor-model <model>", "Cheap model for file edits (architect/editor split)")
  .option("--weak-model <model>", "Cheap model for background tasks (compaction, summaries)")
  .option("-p, --path <path>", "Project path", process.cwd())
  .option("-P, --print [task]", "Headless mode: run task and print output (no interactive UI)")
  .option(
    "--runtime-runner",
    "Experimental: run headless tasks through the reusable runtime tool-calling runner",
  )
  .option("--output <format>", "Output format for headless mode (text or json)", "text")
  .option("--setup", "Run setup wizard before starting")
  .action(
    async (options: {
      model?: string;
      provider?: string;
      path: string;
      print?: string | boolean;
      output?: string;
      runtimeRunner?: boolean;
      setup?: boolean;
      editorModel?: string;
      weakModel?: string;
    }) => {
      // Headless preflight must not open an interactive setup wizard or lose JSON errors.
      if (options.print !== undefined) {
        const format = options.output === "json" ? "json" : "text";
        try {
          if (options.setup)
            throw new Error("--setup cannot be combined with --print; run coco setup first");
          if (options.output !== "text" && options.output !== "json")
            throw new Error("Invalid output format; expected text or json");
          const providerType = (options.provider as ProviderType) ?? (await getLastUsedProvider());
          const result = await runHeadless({
            task: typeof options.print === "string" ? options.print : undefined,
            projectPath: options.path,
            outputFormat: format,
            useRuntimeRunner: options.runtimeRunner === true,
            config: {
              provider: {
                type: providerType as "anthropic" | "openai",
                model: options.model ?? "",
                maxTokens: 8192,
              },
            },
          });
          process.exitCode = result.success
            ? 0
            : result.error === "Headless execution cancelled"
              ? 130
              : 1;
        } catch (error) {
          writeHeadlessResult(
            headlessFailure(error instanceof Error ? error.message : String(error)),
            format,
          );
          process.exitCode = 1;
        }
        return;
      }

      // Run setup if requested
      if (options.setup) {
        const result = await runOnboardingV2();
        if (!result || !(await saveConfiguration(result))) {
          console.log("\n❌ Setup cancelled.");
          return;
        }
      }

      // Use last used provider from preferences (falls back to env/anthropic)
      const providerType = (options.provider as ProviderType) ?? (await getLastUsedProvider());

      await runWithDeferredUpdateNotice(() =>
        startRepl({
          projectPath: options.path,
          config: {
            provider: {
              type: providerType as "anthropic" | "openai",
              model: options.model ?? "",
              maxTokens: 8192,
              editorModel: options.editorModel,
              weakModel: options.weakModel,
            },
          },
        }),
      );
    },
  );

async function main(): Promise<void> {
  // API keys are loaded from ~/.coco/.env by config/env.ts (no project .env needed)
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (headlessJson && error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }
  console.error(formatError(error));
  process.exit(1);
});
