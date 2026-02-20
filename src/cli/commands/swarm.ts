/**
 * Swarm command — run the multi-agent swarm orchestrator
 *
 * Usage: coco swarm --spec <file> --output <dir> [options]
 */

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { createSwarmOrchestrator } from "../../swarm/index.js";
import type { SwarmState } from "../../swarm/lifecycle.js";

/**
 * Register the swarm command on the CLI program
 */
export function registerSwarmCommand(program: Command): void {
  program
    .command("swarm")
    .description("Run the multi-agent swarm orchestrator to implement a project from a spec file")
    .requiredOption("--spec <file>", "Spec file (YAML or Markdown)")
    .requiredOption("--output <dir>", "Output directory for artifacts")
    .option("--min-score <n>", "Minimum quality score (default: 85)", "85")
    .option("--max-iterations <n>", "Maximum iterations per feature (default: 10)", "10")
    .option("--provider <name>", "LLM provider (default: anthropic)", "anthropic")
    .option("--model <name>", "Model override (default: provider default)")
    .option("--no-questions", "Never ask clarifying questions, always assume best option")
    .option("--parallel <n>", "Maximum parallel agents (default: auto)")
    .option("--resume", "Resume from last checkpoint")
    .action(async (options: SwarmCommandOptions) => {
      try {
        await runSwarm(options);
      } catch (error) {
        p.log.error(error instanceof Error ? error.message : "Swarm execution failed");
        process.exit(1);
      }
    });
}

interface SwarmCommandOptions {
  spec: string;
  output: string;
  minScore: string;
  maxIterations: string;
  provider: string;
  model?: string;
  noQuestions?: boolean;
  parallel?: string;
  resume?: boolean;
}

/**
 * Run the swarm command
 */
async function runSwarm(options: SwarmCommandOptions): Promise<void> {
  p.intro(chalk.cyan("Corbat-Coco Swarm Orchestrator"));

  const minScore = parseInt(options.minScore, 10);
  const maxIterations = parseInt(options.maxIterations, 10);
  const maxParallel = options.parallel ? parseInt(options.parallel, 10) : undefined;

  if (isNaN(minScore) || minScore < 0 || minScore > 100) {
    p.log.error("--min-score must be a number between 0 and 100");
    process.exit(1);
  }

  if (isNaN(maxIterations) || maxIterations < 1) {
    p.log.error("--max-iterations must be a positive number");
    process.exit(1);
  }

  const spinner = p.spinner();

  const orchestrator = createSwarmOrchestrator();

  const stateLabels: Record<SwarmState, string> = {
    init: "Initializing workspace",
    clarify: "Clarifying requirements",
    plan: "Planning (PM + Architect + Best Practices)",
    feature_loop: "Implementing features",
    integrate: "Integrating all features",
    output: "Generating output",
    done: "Done",
    failed: "Failed",
  };

  let currentState: SwarmState = "init";
  spinner.start(stateLabels["init"]);

  try {
    await orchestrator.run({
      specFile: options.spec,
      outputPath: options.output,
      minScore,
      maxIterations,
      providerType: options.provider,
      model: options.model,
      noQuestions: options.noQuestions ?? false,
      maxParallel,
      resume: options.resume ?? false,
      onProgress: (state: string, message: string) => {
        const swarmState = state as SwarmState;
        if (swarmState !== currentState) {
          spinner.stop(`${stateLabels[currentState] ?? currentState} done`);
          currentState = swarmState;
          if (swarmState !== "done" && swarmState !== "failed") {
            spinner.start(stateLabels[swarmState] ?? swarmState);
          }
        } else {
          // Update spinner message with progress detail
          spinner.message(`${stateLabels[swarmState] ?? swarmState}: ${message}`);
        }
      },
    });

    spinner.stop("Swarm execution complete");
    p.outro(chalk.green(`Swarm complete! Artifacts written to: ${chalk.bold(options.output)}`));
  } catch (error) {
    spinner.stop(chalk.red("Swarm failed"));
    throw error;
  }
}
