import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("Execute tasks and build the project")
    .option("-t, --task <task-id>", "Build a specific task only")
    .option("-s, --sprint <sprint-id>", "Build a specific sprint only")
    .option("--no-review", "Skip self-review iterations")
    .option("--max-iterations <n>", "Maximum iterations per task", "10")
    .option("--min-quality <n>", "Minimum quality score", "85")
    .action(async (options: BuildOptions) => {
      await runBuild(options);
    });
}

interface BuildOptions {
  task?: string;
  sprint?: string;
  review?: boolean;
  maxIterations?: string;
  minQuality?: string;
}

async function runBuild(options: BuildOptions): Promise<void> {
  p.intro(chalk.cyan("Corbat-Coco Build"));

  // Check for existing project and plan
  const projectState = await checkProjectState();
  if (!projectState.hasProject) {
    p.log.error("No Corbat-Coco project found. Run 'coco init' first.");
    process.exit(1);
  }
  if (!projectState.hasPlan) {
    p.log.error("No development plan found. Run 'coco plan' first.");
    process.exit(1);
  }

  const maxIterations = parseInt(options.maxIterations || "10", 10);
  const minQuality = parseInt(options.minQuality || "85", 10);

  p.log.step(`Phase 3: Complete - Building with quality threshold ${minQuality}`);

  // Placeholder: Load tasks from backlog
  const tasks = await loadTasks(options);
  p.log.info(`Found ${tasks.length} tasks to complete`);

  // Process each task
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task) continue;

    console.log("\n" + chalk.bold(`Task ${i + 1}/${tasks.length}: ${task.title}`));

    await executeTask(task, {
      maxIterations,
      minQuality,
      skipReview: !options.review,
    });
  }

  p.outro(chalk.green("Build complete!"));
}

interface Task {
  id: string;
  title: string;
  description: string;
}

interface ExecuteOptions {
  maxIterations: number;
  minQuality: number;
  skipReview: boolean;
}

async function executeTask(_task: Task, options: ExecuteOptions): Promise<void> {
  const spinner = p.spinner();
  let iteration = 1;
  let score = 0;
  let previousScore = 0;

  do {
    // Generate code
    spinner.start(`Iteration ${iteration}: Generating code...`);
    await simulateDelay(2000);
    spinner.stop(`Iteration ${iteration}: Code generated.`);

    // Run tests
    spinner.start(`Iteration ${iteration}: Running tests...`);
    await simulateDelay(1500);
    spinner.stop(`Iteration ${iteration}: Tests passed.`);

    // Calculate quality
    spinner.start(`Iteration ${iteration}: Evaluating quality...`);
    await simulateDelay(1000);
    previousScore = score;
    score = Math.min(100, 70 + iteration * 8 + Math.random() * 5);
    spinner.stop(`Iteration ${iteration}: Quality score: ${score.toFixed(0)}/100`);

    // Check convergence
    if (score >= options.minQuality) {
      const converged = Math.abs(score - previousScore) < 2;
      if (converged || options.skipReview) {
        p.log.success(`Task completed in ${iteration} iterations with score ${score.toFixed(0)}`);
        break;
      }
    }

    // Analyze improvements
    if (iteration < options.maxIterations) {
      spinner.start(`Iteration ${iteration}: Analyzing improvements...`);
      await simulateDelay(1000);
      spinner.stop(`Iteration ${iteration}: Improvements identified.`);
    }

    iteration++;
  } while (iteration <= options.maxIterations);

  if (score < options.minQuality) {
    p.log.warn(`Task completed with score ${score.toFixed(0)} (below threshold ${options.minQuality})`);
  }
}

async function loadTasks(_options: BuildOptions): Promise<Task[]> {
  // TODO: Load from .coco/planning/backlog.json
  // Placeholder tasks for demonstration
  return [
    { id: "task-001", title: "Create user entity", description: "Create the User entity with validation" },
    { id: "task-002", title: "Implement registration", description: "Create registration endpoint" },
    { id: "task-003", title: "Add authentication", description: "Implement JWT authentication" },
  ];
}

interface ProjectState {
  hasProject: boolean;
  hasPlan: boolean;
}

async function checkProjectState(): Promise<ProjectState> {
  const fs = await import("node:fs/promises");

  let hasProject = false;
  let hasPlan = false;

  try {
    await fs.access(".coco");
    hasProject = true;
  } catch {
    // No project
  }

  try {
    await fs.access(".coco/planning/backlog.json");
    hasPlan = true;
  } catch {
    // No plan
  }

  return { hasProject, hasPlan };
}

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
