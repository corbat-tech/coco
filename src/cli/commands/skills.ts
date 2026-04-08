/**
 * Skills CLI Command
 *
 * CLI commands for managing agent skills.
 * Usage: coco skills list|add|remove|info|create
 */

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  discoverAllSkills,
  resolveDiscoveryDirs,
  scanSkillsDirectory,
  nativeSkillToMetadata,
  type DiscoveryOptions,
  type SkillMetadata,
} from "../../skills/index.js";
import { getBuiltinSkillsForDiscovery } from "../repl/skills/index.js";
import { CONFIG_PATHS } from "../../config/paths.js";
import fs from "node:fs/promises";
import path from "node:path";

type LoadedSkillsSettings = {
  globalDir?: string;
  globalDirs?: string[];
  projectDir?: string;
  projectDirs?: string[];
  disabled?: string[];
};

async function loadSkillsSettings(): Promise<LoadedSkillsSettings> {
  try {
    const { loadConfig } = await import("../../config/loader.js");
    const config = await loadConfig();
    return {
      globalDir: config.skills?.globalDir,
      globalDirs: config.skills?.globalDirs,
      projectDir: config.skills?.projectDir,
      projectDirs: config.skills?.projectDirs,
      disabled: config.skills?.disabled ?? [],
    };
  } catch {
    return {};
  }
}

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

  // Doctor subcommand
  skillsCommand
    .command("doctor")
    .description("Explain skill discovery paths, conflicts, and winners")
    .action(runDoctor);
}

async function loadSkillsDiscoveryOptions(): Promise<DiscoveryOptions> {
  const settings = await loadSkillsSettings();
  return {
    globalDir: settings.globalDir,
    globalDirs: settings.globalDirs,
    projectDir: settings.projectDir,
    projectDirs: settings.projectDirs,
  };
}

// ============================================================================
// List
// ============================================================================

async function runList(options: { scope?: string; kind?: string }): Promise<void> {
  p.intro(chalk.magenta("Skills"));

  const projectPath = process.cwd();
  let allSkills;
  try {
    const builtins = getBuiltinSkillsForDiscovery();
    const discoveryOptions = await loadSkillsDiscoveryOptions();
    allSkills = await discoverAllSkills(projectPath, builtins, discoveryOptions);
  } catch (error) {
    p.log.error(
      `Failed to discover skills: ${error instanceof Error ? error.message : String(error)}`,
    );
    p.outro("");
    return;
  }

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
    global: `Global (multi-dir, default includes ${CONFIG_PATHS.skills})`,
    project: `Project (.agents/skills/, .claude/skills/, ...)`,
  };

  for (const [scope, skills] of byScope) {
    const label = scopeLabels[scope] ?? scope;
    p.log.step(`${label} (${skills.length})`);

    for (const skill of skills) {
      const kindBadge = skill.kind === "markdown" ? chalk.cyan("[MD]") : chalk.yellow("[TS]");
      const aliasText = skill.aliases?.length ? chalk.dim(` (${skill.aliases.join(", ")})`) : "";
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

  const isGitUrl = source.includes("://") || source.includes("git@");
  const isGithubShorthand = source.includes("/") && !isGitUrl;
  const isLocalPath = source.startsWith(".") || source.startsWith("/");

  if (isLocalPath) {
    // Copy local skill directory
    const targetDir = options.global
      ? CONFIG_PATHS.skills
      : path.join(process.cwd(), ".agents", "skills");

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
  } else if (isGithubShorthand && !isGitUrl) {
    // Use npx skills add for registry/GitHub sources
    const targetFlag = options.global ? "-g" : "";
    const cmd = `npx skills add ${source} ${targetFlag}`.trim();

    p.log.info(`Installing via skills registry: ${source}`);
    const spinner = p.spinner();
    spinner.start("Running npx skills add...");

    try {
      const { execSync } = await import("node:child_process");
      execSync(cmd, {
        stdio: "pipe",
        timeout: 120_000,
        cwd: process.cwd(),
        env: { ...process.env, COCO_AGENT: "true" },
      });
      spinner.stop("Skill installed successfully");
    } catch (error) {
      spinner.stop("Installation failed");
      const spawnError = error as Error & { stderr?: Buffer | string | null };
      const stderr = spawnError.stderr?.toString().trim();
      const msg = stderr || (error instanceof Error ? error.message : String(error));
      p.log.error(`Failed to install skill: ${msg}`);
      p.log.info("Try installing manually: git clone the repo into .agents/skills/");
    }
  } else if (isGitUrl) {
    // Git clone for direct URLs
    const targetDir = options.global
      ? CONFIG_PATHS.skills
      : path.join(process.cwd(), ".agents", "skills");

    await fs.mkdir(targetDir, { recursive: true });
    const skillName = source.split("/").pop()?.replace(".git", "") ?? "skill";
    const skillDir = path.join(targetDir, skillName);

    const spinner = p.spinner();
    spinner.start(`Cloning ${source}...`);
    try {
      const { execSync } = await import("node:child_process");
      execSync(`git clone --depth 1 ${source} ${skillDir}`, {
        stdio: "pipe",
        timeout: 60_000,
      });
      spinner.stop(`Skill cloned to ${skillDir}`);
    } catch (error) {
      spinner.stop("Clone failed");
      const spawnError = error as Error & { stderr?: Buffer | string | null };
      const stderr = spawnError.stderr?.toString().trim();
      const msg = stderr || (error instanceof Error ? error.message : String(error));
      p.log.error(`Failed to clone skill: ${msg}`);
    }
  } else {
    p.log.error(
      "Invalid source. Use a GitHub owner/repo (e.g., 'anthropics/skills') or a git URL.",
    );
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
    : path.join(process.cwd(), ".agents", "skills");

  const skillPath = path.resolve(targetDir, name);

  // Guard against path traversal (e.g. name = "../../.ssh").
  // Append path.sep to avoid prefix-confusion attacks (e.g. /skills-evil starts with /skills).
  if (!skillPath.startsWith(path.resolve(targetDir) + path.sep)) {
    p.log.error(`Invalid skill name: "${name}"`);
    p.outro("");
    return;
  }

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
  let allSkills;
  try {
    const builtins = getBuiltinSkillsForDiscovery();
    const discoveryOptions = await loadSkillsDiscoveryOptions();
    allSkills = await discoverAllSkills(projectPath, builtins, discoveryOptions);
  } catch (error) {
    p.log.error(
      `Failed to discover skills: ${error instanceof Error ? error.message : String(error)}`,
    );
    p.outro("");
    return;
  }
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
    : path.join(process.cwd(), ".agents", "skills");

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
name: "${name}"
description: "${description}"
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

// ============================================================================
// Doctor
// ============================================================================

function registerWinner(
  winners: Map<string, SkillMetadata>,
  candidate: SkillMetadata,
  candidateScanOrder: number,
  scanOrderById: Map<string, number>,
): void {
  const existing = winners.get(candidate.id);
  const existingOrder = scanOrderById.get(candidate.id) ?? -1;
  const scopePriority = { builtin: 1, global: 2, project: 3 } as const;

  if (
    !existing ||
    scopePriority[candidate.scope] > scopePriority[existing.scope] ||
    (scopePriority[candidate.scope] === scopePriority[existing.scope] &&
      candidateScanOrder >= existingOrder)
  ) {
    winners.set(candidate.id, candidate);
    scanOrderById.set(candidate.id, candidateScanOrder);
  }
}

async function runDoctor(): Promise<void> {
  p.intro(chalk.magenta("Skills Doctor"));

  const projectPath = process.cwd();
  const settings = await loadSkillsSettings();
  const discoveryOptions: DiscoveryOptions = {
    globalDir: settings.globalDir,
    globalDirs: settings.globalDirs,
    projectDir: settings.projectDir,
    projectDirs: settings.projectDirs,
  };
  const disabled = new Set(settings.disabled ?? []);
  const builtins = getBuiltinSkillsForDiscovery();
  const { globalDirs, projectDirs } = resolveDiscoveryDirs(projectPath, discoveryOptions);

  p.log.step("Discovery paths (scan order, later wins within same scope)");
  console.log(chalk.dim("  Global:"));
  for (const dir of globalDirs) {
    console.log(chalk.dim(`    - ${dir}`));
  }
  console.log(chalk.dim("  Project:"));
  for (const dir of projectDirs) {
    console.log(chalk.dim(`    - ${dir}`));
  }
  console.log();

  const winners = new Map<string, SkillMetadata>();
  const winnerScanOrderById = new Map<string, number>();
  const candidatesById = new Map<string, SkillMetadata[]>();
  let scanOrder = 0;

  // Builtins are lowest priority
  for (const skill of builtins) {
    const meta = nativeSkillToMetadata(skill, "builtin");
    meta.path = "<builtin>";
    registerWinner(winners, meta, scanOrder, winnerScanOrderById);
    candidatesById.set(meta.id, [meta]);
    scanOrder += 1;
  }

  for (const dir of globalDirs) {
    const metas = await scanSkillsDirectory(dir, "global");
    const names = metas
      .map((m) => m.name)
      .sort()
      .join(", ");
    p.log.info(`Global ${dir}: ${metas.length} skills${names ? ` (${names})` : ""}`);
    for (const meta of metas) {
      registerWinner(winners, meta, scanOrder, winnerScanOrderById);
      const list = candidatesById.get(meta.id) ?? [];
      list.push(meta);
      candidatesById.set(meta.id, list);
      scanOrder += 1;
    }
  }

  for (const dir of projectDirs) {
    const metas = await scanSkillsDirectory(dir, "project");
    const names = metas
      .map((m) => m.name)
      .sort()
      .join(", ");
    p.log.info(`Project ${dir}: ${metas.length} skills${names ? ` (${names})` : ""}`);
    for (const meta of metas) {
      registerWinner(winners, meta, scanOrder, winnerScanOrderById);
      const list = candidatesById.get(meta.id) ?? [];
      list.push(meta);
      candidatesById.set(meta.id, list);
      scanOrder += 1;
    }
  }

  const conflicts = Array.from(candidatesById.entries())
    .filter(([, list]) => list.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));
  const activeWinners = Array.from(winners.values()).filter((meta) => !disabled.has(meta.id));

  console.log();
  p.log.step(`Final active skills: ${activeWinners.length}`);
  if (disabled.size > 0) {
    p.log.info(`Disabled by config: ${Array.from(disabled).sort().join(", ")}`);
  }
  if (conflicts.length === 0) {
    p.log.success("No naming conflicts detected.");
    p.outro("");
    return;
  }

  p.log.step(`Conflicts detected: ${conflicts.length}`);
  for (const [id, list] of conflicts) {
    const winner = winners.get(id);
    if (!winner) continue;
    const disabledTag = disabled.has(winner.id) ? chalk.yellow(" [DISABLED]") : "";
    console.log(`  ${chalk.bold(id)} -> winner: ${winner.path} [${winner.scope}]${disabledTag}`);
    for (const candidate of list) {
      const marker = candidate.path === winner.path ? chalk.green("WIN") : chalk.dim("LOSE");
      console.log(`    - ${marker} ${candidate.path} [${candidate.scope}]`);
    }
  }

  p.outro("");
}
