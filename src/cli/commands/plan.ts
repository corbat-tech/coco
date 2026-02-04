/**
 * Plan command - Run discovery and create a development plan
 */

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { createConvergeExecutor } from "../../phases/converge/executor.js";
import { createOrchestrateExecutor } from "../../phases/orchestrate/executor.js";
import type { PhaseContext, PhaseResult } from "../../phases/types.js";
import type { Specification } from "../../phases/converge/types.js";
import type { ArchitectureDoc, ADR, BacklogResult } from "../../phases/orchestrate/types.js";
import { createProvider } from "../../providers/index.js";

/**
 * Options for runPlan
 */
export interface PlanOptions {
  cwd?: string;
  auto?: boolean;
  skipDiscovery?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
}

/**
 * Result of planning phase
 */
export interface PlanResult {
  specification?: Specification;
  architecture?: ArchitectureDoc;
  adrs?: ADR[];
  backlog?: BacklogResult;
  success: boolean;
  error?: string;
}

/**
 * Register the plan command
 */
export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Run discovery and create a development plan")
    .option("-i, --interactive", "Run in interactive mode (default)")
    .option("--skip-discovery", "Skip discovery, use existing specification")
    .option("--dry-run", "Generate plan without saving")
    .option("--auto", "Run without confirmations")
    .action(async (options: PlanOptions) => {
      try {
        const result = await runPlan({ ...options, cwd: process.cwd() });
        if (!result.success) {
          p.log.error(result.error || "Planning failed");
          process.exit(1);
        }
      } catch (error) {
        p.log.error(
          error instanceof Error ? error.message : "An error occurred"
        );
        process.exit(1);
      }
    });
}

/**
 * Create a minimal phase context for CLI execution
 */
async function createCliPhaseContext(
  projectPath: string,
  _onUserInput?: (prompt: string, options?: string[]) => Promise<string>
): Promise<PhaseContext> {
  // Create provider - will fail gracefully if no API key
  let llm: PhaseContext["llm"];

  try {
    const provider = await createProvider("anthropic", {
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    llm = {
      async chat(messages) {
        const adapted = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const response = await provider.chat(adapted);
        return {
          content: response.content,
          usage: response.usage,
        };
      },
      async chatWithTools(messages, tools) {
        const adapted = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const adaptedTools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as { type: "object"; properties: Record<string, unknown>; required?: string[] },
        }));
        const response = await provider.chatWithTools(adapted, { tools: adaptedTools });
        return {
          content: response.content,
          usage: response.usage,
          toolCalls: response.toolCalls?.map((tc: { name: string; input: Record<string, unknown> }) => ({
            name: tc.name,
            arguments: tc.input,
          })),
        };
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    p.log.error(`Failed to initialize LLM provider: ${errorMessage}`);
    p.log.info("Make sure you have set your API key:");
    p.log.info("  export ANTHROPIC_API_KEY=your-api-key");
    p.log.info("Or for other providers:");
    p.log.info("  export OPENAI_API_KEY=your-api-key");
    p.log.info("  export GEMINI_API_KEY=your-api-key");
    p.log.info("  export KIMI_API_KEY=your-api-key");
    throw new Error("API key required. Configure your provider API key and try again.");
  }

  return {
    projectPath,
    config: {
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        convergenceThreshold: 2,
      },
      timeouts: {
        phaseTimeout: 3600000,
        taskTimeout: 600000,
        llmTimeout: 120000,
      },
    },
    state: {
      artifacts: [],
      progress: 0,
      checkpoint: null,
    },
    tools: {
      file: {
        async read(path: string) {
          const fs = await import("node:fs/promises");
          return fs.readFile(path, "utf-8");
        },
        async write(path: string, content: string) {
          const fs = await import("node:fs/promises");
          const nodePath = await import("node:path");
          await fs.mkdir(nodePath.dirname(path), { recursive: true });
          await fs.writeFile(path, content, "utf-8");
        },
        async exists(path: string) {
          const fs = await import("node:fs/promises");
          try {
            await fs.access(path);
            return true;
          } catch {
            return false;
          }
        },
        async glob(pattern: string) {
          const { glob } = await import("glob");
          return glob(pattern, { cwd: projectPath });
        },
      },
      bash: {
        async exec(command: string, options = {}) {
          const { execa } = await import("execa");
          try {
            const result = await execa(command, {
              shell: true,
              cwd: options.cwd || projectPath,
              timeout: options.timeout,
              env: options.env,
            });
            return {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode ?? 0,
            };
          } catch (error: unknown) {
            const err = error as { stdout?: string; stderr?: string; exitCode?: number };
            return {
              stdout: err.stdout || "",
              stderr: err.stderr || "",
              exitCode: err.exitCode || 1,
            };
          }
        },
      },
      git: {
        async status() {
          return { branch: "main", clean: true, staged: [], unstaged: [], untracked: [] };
        },
        async commit() {},
        async push() {},
      },
      test: {
        async run() {
          return { passed: 0, failed: 0, skipped: 0, duration: 0, failures: [] };
        },
        async coverage() {
          return { lines: 0, branches: 0, functions: 0, statements: 0 };
        },
      },
      quality: {
        async lint() {
          return { errors: 0, warnings: 0, issues: [] };
        },
        async complexity() {
          return { averageComplexity: 0, maxComplexity: 0, files: [] };
        },
        async security() {
          return { vulnerabilities: 0, issues: [] };
        },
      },
    },
    llm,
  };
}

/**
 * Run the plan command programmatically
 */
export async function runPlan(options: PlanOptions = {}): Promise<PlanResult> {
  const cwd = options.cwd || process.cwd();

  // Find and load configuration
  const configPath = await findConfigPath(cwd);
  if (!configPath) {
    return {
      success: false,
      error: 'No Corbat-Coco config found. Run "coco init" first.',
    };
  }

  await loadConfig(configPath);

  // Show intro if not in auto mode
  if (!options.auto) {
    p.intro(chalk.cyan("Corbat-Coco Planning"));
  }

  // Create user input handler for interactive mode
  const onUserInput = options.auto
    ? undefined
    : async (prompt: string, opts?: string[]): Promise<string> => {
        if (opts && opts.length > 0) {
          const result = await p.select({
            message: prompt,
            options: opts.map((o) => ({ value: o, label: o })),
          });
          if (p.isCancel(result)) {
            throw new Error("Cancelled by user");
          }
          return result as string;
        } else {
          const result = await p.text({ message: prompt });
          if (p.isCancel(result)) {
            throw new Error("Cancelled by user");
          }
          return result as string;
        }
      };

  // Phase 1: Converge (Discovery)
  let convergeResult: PhaseResult;

  if (!options.skipDiscovery) {
    if (!options.auto) {
      const shouldProceed = await p.confirm({
        message: "Ready to start planning. Continue?",
      });

      if (p.isCancel(shouldProceed) || shouldProceed === false) {
        return { success: false, error: "Planning cancelled by user" };
      }

      p.log.info("Phase 1: Converge - Understanding your requirements");
    }

    const convergeExecutor = createConvergeExecutor({
      onUserInput,
      onProgress: (step, progress, message) => {
        if (!options.auto) {
          p.log.step(`[${step}] ${progress}% - ${message}`);
        }
      },
    });

    const context = await createCliPhaseContext(cwd, onUserInput);
    convergeResult = await convergeExecutor.execute(context);

    if (!convergeResult.success) {
      return {
        success: false,
        error: convergeResult.error || "CONVERGE phase failed",
      };
    }
  } else {
    // Skip discovery - create minimal result
    convergeResult = { phase: "converge", success: true, artifacts: [] };
  }

  // Phase 2: Orchestrate (Planning)
  if (!options.auto) {
    p.log.info("Phase 2: Orchestrate - Creating development plan");
  }

  const orchestrateExecutor = createOrchestrateExecutor();
  const context = await createCliPhaseContext(cwd);
  const orchestrateResult = await orchestrateExecutor.execute(context);

  if (!orchestrateResult.success) {
    return {
      success: false,
      error: orchestrateResult.error || "ORCHESTRATE phase failed",
    };
  }

  if (!options.auto) {
    // Show summary
    console.log("\n" + chalk.bold("Planning Summary:"));
    console.log(
      chalk.dim("  Artifacts generated: ") + orchestrateResult.artifacts.length
    );

    for (const artifact of orchestrateResult.artifacts) {
      console.log(chalk.dim(`    - ${artifact.type}: ${artifact.description}`));
    }

    p.outro(
      chalk.green("Planning complete! Run 'coco build' to start development.")
    );
  }

  return {
    success: true,
  };
}

/**
 * Load existing specification from disk
 */
export async function loadExistingSpecification(cwd: string): Promise<Specification> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const specPath = path.join(cwd, ".coco", "spec", "specification.json");

  try {
    const content = await fs.readFile(specPath, "utf-8");
    return JSON.parse(content) as Specification;
  } catch {
    throw new Error(
      'No existing specification found. Run "coco plan" without --skip-discovery first.'
    );
  }
}
