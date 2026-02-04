/**
 * /memory command - Show loaded memory files and their content
 *
 * Displays information about loaded memory files (COCO.md, CLAUDE.md)
 * including their levels, paths, sizes, and sections.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import type {
  MemoryContext,
  MemoryFile,
  MemoryLevel,
} from "../memory/types.js";
import { createEmptyMemoryContext, createMissingMemoryFile } from "../memory/types.js";

/**
 * Format file size for human-readable display
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get emoji and color for memory level
 */
function getLevelStyle(level: MemoryLevel): { emoji: string; color: typeof chalk.green } {
  switch (level) {
    case "user":
      return { emoji: "👤", color: chalk.blue };
    case "project":
      return { emoji: "📁", color: chalk.cyan };
    case "local":
      return { emoji: "📝", color: chalk.yellow };
    default:
      return { emoji: "📄", color: chalk.white };
  }
}

/**
 * Get level display name
 */
function getLevelName(level: MemoryLevel): string {
  switch (level) {
    case "user":
      return "User";
    case "project":
      return "Project";
    case "local":
      return "Local";
    default:
      return level;
  }
}

/**
 * Display a single memory file's information
 */
function displayMemoryFile(file: MemoryFile): void {
  const { emoji, color } = getLevelStyle(file.level);
  const levelName = getLevelName(file.level);

  console.log();
  console.log(`${emoji} ${color.bold(levelName)} ${chalk.dim(`(${file.path})`)}`);

  if (!file.exists) {
    console.log(`  ${chalk.red("✗")} Not found`);
    return;
  }

  const size = formatSize(file.content?.length ?? 0);
  const sectionCount = file.sections.length;

  console.log(`  ${chalk.green("✓")} ${size}, ${sectionCount} section${sectionCount !== 1 ? "s" : ""}`);

  if (file.sections.length > 0) {
    const sectionNames = file.sections.map((s) => s.title).slice(0, 5);
    const hasMore = file.sections.length > 5;
    const sectionList = sectionNames.join(", ") + (hasMore ? ", ..." : "");
    console.log(`  ${chalk.dim("Sections:")} ${sectionList}`);
  }

  if (file.imports.length > 0) {
    const resolvedCount = file.imports.filter((i) => i.resolved).length;
    const failedCount = file.imports.length - resolvedCount;
    let importStatus = `${resolvedCount} resolved`;
    if (failedCount > 0) {
      importStatus += chalk.red(`, ${failedCount} failed`);
    }
    console.log(`  ${chalk.dim("Imports:")} ${importStatus}`);
  }
}

/**
 * Display section content
 */
function displaySection(sectionName: string, memoryContext: MemoryContext): boolean {
  const normalizedName = sectionName.toLowerCase();

  for (const file of memoryContext.files) {
    if (!file.exists) continue;

    for (const section of file.sections) {
      if (section.title.toLowerCase() === normalizedName) {
        const { emoji, color } = getLevelStyle(file.level);
        console.log();
        console.log(`${emoji} ${color.bold(section.title)} ${chalk.dim(`from ${getLevelName(file.level)}`)}`);
        console.log();
        console.log(section.content.trim());
        console.log();
        return true;
      }
    }
  }

  // Try partial match
  for (const file of memoryContext.files) {
    if (!file.exists) continue;

    for (const section of file.sections) {
      if (section.title.toLowerCase().includes(normalizedName)) {
        const { emoji, color } = getLevelStyle(file.level);
        console.log();
        console.log(`${emoji} ${color.bold(section.title)} ${chalk.dim(`from ${getLevelName(file.level)}`)}`);
        console.log();
        console.log(section.content.trim());
        console.log();
        return true;
      }
    }
  }

  return false;
}

/**
 * Create a placeholder memory context when none exists in the session
 */
function createPlaceholderContext(): MemoryContext {
  const context = createEmptyMemoryContext();
  context.files = [
    createMissingMemoryFile("~/.config/corbat-coco/COCO.md", "user"),
    createMissingMemoryFile("./CLAUDE.md", "project"),
    createMissingMemoryFile("./CLAUDE.local.md", "local"),
  ];
  return context;
}

/**
 * Memory command - display loaded memory files and sections
 */
export const memoryCommand: SlashCommand = {
  name: "memory",
  aliases: ["mem"],
  description: "Show loaded memory files and their content",
  usage: "/memory [section]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    // Get memory context from session or create placeholder
    const memoryContext: MemoryContext =
      (session as unknown as { memoryContext?: MemoryContext }).memoryContext ??
      createPlaceholderContext();

    // If section name provided, show only that section
    if (args.length > 0) {
      const sectionName = args.join(" ");
      const found = displaySection(sectionName, memoryContext);

      if (!found) {
        console.log();
        console.log(chalk.yellow(`Section "${sectionName}" not found.`));
        console.log();

        // List available sections
        const allSections: string[] = [];
        for (const file of memoryContext.files) {
          if (file.exists) {
            for (const section of file.sections) {
              if (!allSections.includes(section.title)) {
                allSections.push(section.title);
              }
            }
          }
        }

        if (allSections.length > 0) {
          console.log(chalk.dim("Available sections:"));
          for (const name of allSections) {
            console.log(`  ${chalk.yellow(name)}`);
          }
          console.log();
        }
      }

      return false;
    }

    // Show full memory status
    console.log(chalk.cyan.bold("\n📚 Memory Files Loaded\n"));

    // Display each memory file
    for (const file of memoryContext.files) {
      displayMemoryFile(file);
    }

    // Calculate totals
    const loadedFiles = memoryContext.files.filter((f) => f.exists);
    const totalSize = loadedFiles.reduce(
      (sum, f) => sum + (f.content?.length ?? 0),
      0
    );
    const totalSections = loadedFiles.reduce((sum, f) => sum + f.sections.length, 0);

    // Collect all imports from all files
    const allImports = memoryContext.files.flatMap((f) => f.imports);
    const resolvedImports = allImports.filter((i) => i.resolved).length;
    const failedImports = allImports.length - resolvedImports;

    // Summary
    console.log();
    console.log(chalk.dim("─".repeat(40)));
    console.log();
    console.log(`${chalk.bold("Total:")} ${formatSize(totalSize)} combined`);
    console.log(`${chalk.bold("Sections:")} ${totalSections}`);

    if (allImports.length > 0) {
      let importText = `${resolvedImports} resolved`;
      if (failedImports > 0) {
        importText += chalk.red(`, ${failedImports} failed`);
      }
      console.log(`${chalk.bold("Imports:")} ${importText}`);
    } else {
      console.log(`${chalk.bold("Imports:")} 0`);
    }

    // Show errors
    if (memoryContext.errors.length > 0) {
      console.log();
      const recoverableErrors = memoryContext.errors.filter((e) => e.recoverable);
      const fatalErrors = memoryContext.errors.filter((e) => !e.recoverable);

      if (recoverableErrors.length > 0) {
        console.log(chalk.yellow.bold("Warnings:"));
        for (const err of recoverableErrors) {
          console.log(`  ${chalk.yellow("⚠")} ${err.file}: ${err.error}`);
        }
      }

      if (fatalErrors.length > 0) {
        console.log(chalk.red.bold("Errors:"));
        for (const err of fatalErrors) {
          console.log(`  ${chalk.red("✗")} ${err.file}: ${err.error}`);
        }
      }
    } else {
      console.log(`${chalk.bold("Errors:")} 0`);
    }

    console.log();
    console.log(chalk.dim(`Tip: Use /memory <section-name> to view a specific section`));
    console.log();

    return false;
  },
};
