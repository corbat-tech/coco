/**
 * Skills CLI Command
 *
 * CLI commands for managing agent skills.
 * Usage: coco skills list|add|remove|info|create
 */

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { discoverAllSkills } from "../../skills/index.js";
import { CONFIG_PATHS } from "../../config/paths.js";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Register skills command
 */
export function registerSkillsCommand(program: Command): void {
  const skillsCommand = program
    .command("skills")
    .description("Manage agent skills (SKILL.md and native)");

  // List subcommand
  skillsCommand
    .command("list")
    .description("List all discovered skills")
    .option("-s, --scope <scope>", "Filter by scope (builtin|global|project)")
    .option("-k, --kind <kind>", "Filter by kind (markdown|native)")
    .action(runList);

  // Add subcommand
  skillsCommand
    .command("add")
    .description("Install a skill from GitHub (via npx skills add)")
    .argument("<source>", "GitHub owner/repo or local path")
    .option("-g, --global", "Install to global ~/.coco/skills/ directory")
    .action(runAdd);

  // Remove subcommand
  skillsCommand
    .command("remove")
    .description("Remove an installed skill")
    .argument("<name>", "Skill name to remove")
    .option("-g, --global", "Remove from global directory")
    .option("-y, --yes", "Skip confirmation")
    .action(runRemove);

  // Info subcommand
  skillsCommand
    .command("info")
    .description("Show details about a skill")
    .argument("<name>", "Skill name")
    .action(runInfo);

  // Create subcommand
  skillsCommand
    .command("create")
    .description("Create a new skill from template")
    .argument("<name>", "Skill name")
    .option("-g, --global", "Create in global directory")
    .action(runCreate);
}

// ============================================================================
// List
// ============================================================================

async function runList(options: { scope?: string; kind?: string }): Promise<void> {
  p.intro(chalk.magenta("Skills"));

  const projectPath = process.cwd();
  const allSkills = await discoverAllSkills(projectPath);

  let filtered = allSkills;
  if (options.scope) {
    filtered = filtered.filter((s) => s.scope === options.scope);
  }
  if (options.kind) {
    filtered = filtered.filter((s) => s.kind === options.kind);
  }

  if (filtered.length === 0) {
    p.log.info("No skills found.");
    p.outro("");
    return;
  }

  // Group by scope
  const byScope = new Map<string, typeof filtered>();
  for (const skill of filtered) {
    const group = byScope.get(skill.scope) ?? [];
    group.push(skill);
    byScope.set(skill.scope, group);
  }

  const scopeLabels: Record<string, string> = {
    builtin: "Builtin",
    global: `Global (${CONFIG_PATHS.skills})`,
    project: `Project (${projectPath}/.coco/skills/)`,
  };

  for (const [scope, skills] of byScope) {
    const label = scopeLabels[scope] ?? scope;
    p.log.step(`${label} (${skills.length})`);

    for (const skill of skills) {
      const kindBadge = skill.kind === "markdown" ? chalk.cyan("[MD]") : chalk.yellow("[TS]");
      const aliasText = skill.aliases?.length
        ? chalk.dim(` (${skill.aliases.join(", ")})`)
        : "";
      console.log(
        `    ${kindBadge} ${chalk.bold(skill.name)}${aliasText}  ${chalk.dim(skill.description)}`,
      );
    }
    console.log();
  }

  p.outro(`Total: ${filtered.length} skills`);
}

// ============================================================================
// Add
// ============================================================================

async function runAdd(source: string, options: { global?: boolean }): Promise<void> {
  p.intro(chalk.magenta("Add Skill"));

  const targetDir = options.global
    ? CONFIG_PATHS.skills
    : path.join(process.cwd(), ".coco", "skills");

  // Check if source is a local path
  const isLocalPath = source.startsWith(".") || source.startsWith("/");

  if (isLocalPath) {
    // Copy local skill directory
    const sourcePath = path.resolve(source);
    const skillName = path.basename(sourcePath);
    const destPath = path.join(targetDir, skillName);

    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.cp(sourcePath, destPath, { recursive: true });
      p.log.success(`Installed "${skillName}" to ${destPath}`);
    } catch (error) {
      p.log.error(
        `Failed to copy skill: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    // Execute npx skills add for GitHub/registry sources
    p.log.info(`Installing from: ${source}`);
    const spinner = p.spinner();
    spinner.start("Installing skill...");
    try {
      const { execSync } = await import("node:child_process");
      await fs.mkdir(targetDir, { recursive: true });
      execSync(`npx --yes skills add ${source} --path "${targetDir}"`, {
        stdio: "pipe",
        timeout: 60_000,
      });
      spinner.stop("Skill installed successfully");
      p.log.success(`Installed to: ${targetDir}`);
      p.log.info("Restart Coco to discover the new skill.");
    } catch (error) {
      spinner.stop("Installation failed");
      const msg = error instanceof Error ? error.message : String(error);
      p.log.error(`Failed to install: ${msg}`);
      p.log.step("You can try manually:");
      console.log(chalk.cyan(`  npx skills add ${source}`));
    }
  }

  p.outro("");
}

// ============================================================================
// Remove
// ============================================================================

async function runRemove(
  name: string,
  options: { global?: boolean; yes?: boolean },
): Promise<void> {
  p.intro(chalk.magenta("Remove Skill"));

  const targetDir = options.global
    ? CONFIG_PATHS.skills
    : path.join(process.cwd(), ".coco", "skills");

  const skillPath = path.join(targetDir, name);

  try {
    await fs.access(skillPath);
  } catch {
    p.log.error(`Skill "${name}" not found at ${skillPath}`);
    p.outro("");
    return;
  }

  if (!options.yes) {
    const confirm = await p.confirm({
      message: `Remove skill "${name}" from ${targetDir}?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.log.info("Cancelled.");
      p.outro("");
      return;
    }
  }

  await fs.rm(skillPath, { recursive: true });
  p.log.success(`Removed "${name}"`);
  p.outro("");
}

// ============================================================================
// Info
// ============================================================================

async function runInfo(name: string): Promise<void> {
  p.intro(chalk.magenta("Skill Info"));

  const projectPath = process.cwd();
  const allSkills = await discoverAllSkills(projectPath);
  const skill = allSkills.find((s) => s.id === name || s.name === name);

  if (!skill) {
    p.log.error(`Skill "${name}" not found.`);
    p.outro("");
    return;
  }

  console.log(`  ${chalk.bold("Name:")}        ${skill.name}`);
  console.log(`  ${chalk.bold("Description:")} ${skill.description}`);
  console.log(`  ${chalk.bold("Version:")}     ${skill.version}`);
  console.log(
    `  ${chalk.bold("Kind:")}        ${skill.kind === "markdown" ? "SKILL.md (markdown)" : "Native (TypeScript)"}`,
  );
  console.log(`  ${chalk.bold("Scope:")}       ${skill.scope}`);
  console.log(`  ${chalk.bold("Category:")}    ${skill.category}`);

  if (skill.path) {
    console.log(`  ${chalk.bold("Path:")}        ${skill.path}`);
  }
  if (skill.aliases?.length) {
    console.log(`  ${chalk.bold("Aliases:")}     ${skill.aliases.join(", ")}`);
  }
  if (skill.tags?.length) {
    console.log(`  ${chalk.bold("Tags:")}        ${skill.tags.join(", ")}`);
  }
  if (skill.author) {
    console.log(`  ${chalk.bold("Author:")}      ${skill.author}`);
  }

  // Show first few lines of instructions for markdown skills
  if (skill.kind === "markdown" && skill.path) {
    const { loadMarkdownContent } = await import("../../skills/loader/markdown-loader.js");
    const content = await loadMarkdownContent(skill.path);
    if (content) {
      const preview = content.instructions.split("\n").slice(0, 10).join("\n");
      console.log();
      console.log(chalk.dim("  Instructions preview:"));
      console.log(chalk.dim("  " + preview.replace(/\n/g, "\n  ")));
      if (content.instructions.split("\n").length > 10) {
        console.log(chalk.dim("  ..."));
      }
    }
  }

  p.outro("");
}

// ============================================================================
// Create
// ============================================================================

async function runCreate(name: string, options: { global?: boolean }): Promise<void> {
  p.intro(chalk.magenta("Create Skill"));

  const targetDir = options.global
    ? CONFIG_PATHS.skills
    : path.join(process.cwd(), ".coco", "skills");

  const skillDir = path.join(targetDir, name);

  // Check if exists
  try {
    await fs.access(skillDir);
    p.log.error(`Skill "${name}" already exists at ${skillDir}`);
    p.outro("");
    return;
  } catch {
    // Good, doesn't exist
  }

  // Ask for description
  const description = await p.text({
    message: "Skill description (when should the agent use this skill?):",
    placeholder: "e.g., API design standards and conventions for this project",
  });

  if (p.isCancel(description)) {
    p.outro("Cancelled.");
    return;
  }

  // Ask for category
  const category = await p.select({
    message: "Category:",
    options: [
      { value: "coding", label: "Coding" },
      { value: "testing", label: "Testing" },
      { value: "deployment", label: "Deployment" },
      { value: "documentation", label: "Documentation" },
      { value: "workflow", label: "Workflow" },
      { value: "custom", label: "Custom" },
    ],
  });

  if (p.isCancel(category)) {
    p.outro("Cancelled.");
    return;
  }

  // Create directory and SKILL.md
  await fs.mkdir(skillDir, { recursive: true });

  const skillMd = `---
name: ${name}
description: ${description}
version: "1.0.0"
metadata:
  author: ""
  tags: []
  category: ${category}
---

# ${name}

Add your instructions here. These will be injected into the LLM's system prompt
when this skill is activated (automatically via matching or manually via /${name}).

## Guidelines

1. Be specific about what the agent should do
2. Include examples when helpful
3. Keep instructions under 500 lines
`;

  await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

  // Create optional subdirectories
  await fs.mkdir(path.join(skillDir, "references"), { recursive: true });

  p.log.success(`Created skill at ${skillDir}`);
  p.log.info(`Edit ${path.join(skillDir, "SKILL.md")} to add instructions.`);
  p.outro("");
}
