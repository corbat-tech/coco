import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { createProjectStructure } from "../../orchestrator/project.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new Corbat-Coco project")
    .argument("[path]", "Project directory path", ".")
    .option("-t, --template <template>", "Project template to use")
    .option("-y, --yes", "Skip prompts and use defaults")
    .option("--skip-discovery", "Skip the discovery phase (use existing spec)")
    .action(async (path: string, options: InitOptions) => {
      await runInit(path, options);
    });
}

interface InitOptions {
  template?: string;
  yes?: boolean;
  skipDiscovery?: boolean;
}

async function runInit(projectPath: string, options: InitOptions): Promise<void> {
  p.intro(chalk.cyan("Welcome to Corbat-Coco!"));

  // Check if project already exists
  const existingProject = await checkExistingProject(projectPath);
  if (existingProject) {
    const shouldContinue = await p.confirm({
      message: "A Corbat-Coco project already exists here. Continue anyway?",
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel("Initialization cancelled.");
      process.exit(0);
    }
  }

  // Gather project info
  let projectInfo: ProjectInfo;

  if (options.yes) {
    projectInfo = getDefaultProjectInfo(projectPath);
  } else {
    const result = await gatherProjectInfo();
    if (!result) {
      p.cancel("Initialization cancelled.");
      process.exit(0);
    }
    projectInfo = result;
  }

  // Create project structure
  const spinner = p.spinner();
  spinner.start("Creating project structure...");

  try {
    await createProjectStructure(projectPath, projectInfo);
    spinner.stop("Project structure created.");
  } catch (error) {
    spinner.stop("Failed to create project structure.");
    throw error;
  }

  // Success message
  p.outro(chalk.green("Project initialized successfully!"));

  console.log("\nNext steps:");
  console.log(chalk.dim("  1. ") + chalk.cyan("coco plan") + chalk.dim(" - Run discovery and create a development plan"));
  console.log(chalk.dim("  2. ") + chalk.cyan("coco build") + chalk.dim(" - Start building the project"));
  console.log(chalk.dim("  3. ") + chalk.cyan("coco status") + chalk.dim(" - Check current progress"));
}

interface ProjectInfo {
  name: string;
  description: string;
  language: string;
  framework?: string;
}

async function gatherProjectInfo(): Promise<ProjectInfo | null> {
  const name = await p.text({
    message: "What is your project name?",
    placeholder: "my-awesome-project",
    validate: (value) => {
      if (!value) return "Project name is required";
      if (!/^[a-z0-9-]+$/.test(value)) return "Use lowercase letters, numbers, and hyphens only";
      return undefined;
    },
  });

  if (p.isCancel(name)) return null;

  const description = await p.text({
    message: "Describe your project in one sentence:",
    placeholder: "A REST API for managing tasks",
  });

  if (p.isCancel(description)) return null;

  const language = await p.select({
    message: "What programming language?",
    options: [
      { value: "typescript", label: "TypeScript", hint: "Recommended" },
      { value: "python", label: "Python" },
      { value: "go", label: "Go" },
      { value: "rust", label: "Rust" },
    ],
  });

  if (p.isCancel(language)) return null;

  return {
    name: name as string,
    description: (description as string) || "",
    language: language as string,
  };
}

function getDefaultProjectInfo(path: string): ProjectInfo {
  const name = path === "." ? "my-project" : path.split("/").pop() || "my-project";
  return {
    name,
    description: "",
    language: "typescript",
  };
}

async function checkExistingProject(path: string): Promise<boolean> {
  try {
    const fs = await import("node:fs/promises");
    await fs.access(`${path}/.coco`);
    return true;
  } catch {
    return false;
  }
}
