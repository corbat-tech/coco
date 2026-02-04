/**
 * /help command
 */

import chalk from "chalk";
import type { SlashCommand } from "../types.js";

export const helpCommand: SlashCommand = {
  name: "help",
  aliases: ["h", "?"],
  description: "Show available commands",
  usage: "/help [tools]",

  async execute(args: string[]): Promise<boolean> {
    // Show tools help if requested
    if (args[0] === "tools" || args[0] === "herramientas") {
      return showToolsHelp();
    }

    console.log(chalk.cyan.bold("\n═══ Coco Commands ═══\n"));

    const sections = [
      {
        title: "COCO Phases",
        commands: [
          { cmd: "/init, /i [name]", desc: "Initialize a new project" },
          { cmd: "/plan, /p", desc: "Design architecture and backlog" },
          { cmd: "/build, /b", desc: "Build with quality convergence" },
          { cmd: "/task, /t <desc>", desc: "Execute a single task" },
          { cmd: "/output, /o", desc: "Generate CI/CD and docs" },
        ],
      },
      {
        title: "General",
        commands: [
          { cmd: "/help, /?", desc: "Show this help message" },
          { cmd: "/help tools", desc: "Show available agent tools" },
          { cmd: "/clear, /c", desc: "Clear conversation history" },
          { cmd: "/exit, /quit, /q", desc: "Exit the REPL" },
        ],
      },
      {
        title: "Model & Settings",
        commands: [
          { cmd: "/model, /m", desc: "View or change the current model" },
          { cmd: "/provider", desc: "View or change the LLM provider" },
          { cmd: "/compact", desc: "Toggle compact mode (less verbose)" },
          { cmd: "/cost, /tokens", desc: "Show token usage and cost" },
          { cmd: "/trust", desc: "Manage project trust permissions" },
        ],
      },
      {
        title: "Git",
        commands: [
          { cmd: "/status, /s", desc: "Show project and git status" },
          { cmd: "/diff, /d", desc: "Show git diff of changes" },
          { cmd: "/commit, /ci", desc: "Commit staged changes" },
          { cmd: "/undo", desc: "Undo file changes or last commit" },
        ],
      },
      {
        title: "Session & Memory",
        commands: [
          { cmd: "/memory", desc: "View or manage agent memory" },
          { cmd: "/tasks", desc: "Show current task list" },
          { cmd: "/rewind", desc: "Rewind to a previous checkpoint" },
          { cmd: "/resume", desc: "Resume from last checkpoint" },
        ],
      },
    ];

    for (const section of sections) {
      console.log(chalk.bold(section.title));
      for (const { cmd, desc } of section.commands) {
        console.log(`  ${chalk.yellow(cmd.padEnd(22))} ${chalk.dim(desc)}`);
      }
      console.log();
    }

    console.log(chalk.bold("Tips:"));
    console.log(chalk.dim("  - Press ") + chalk.cyan("Tab") + chalk.dim(" to autocomplete commands (e.g., /h → /help)"));
    console.log(chalk.dim("  - Type naturally to interact with the agent"));
    console.log(chalk.dim("  - The agent can read/write files, run bash commands, search and more"));
    console.log(chalk.dim("  - Type ") + chalk.yellow("/help tools") + chalk.dim(" to see all available tools"));
    console.log(chalk.dim("  - Use Ctrl+D or /exit to quit\n"));

    return false;
  },
};

/**
 * Show available tools help
 */
function showToolsHelp(): boolean {
  console.log(chalk.cyan.bold("\n═══ Available Agent Tools ═══\n"));

  const toolCategories = [
    {
      title: "📁 File Operations",
      tools: [
        { name: "read_file", desc: "Read file contents" },
        { name: "write_file", desc: "Create or modify files" },
        { name: "edit_file", desc: "Make targeted edits to files" },
        { name: "delete_file", desc: "Delete files (requires confirmation)" },
        { name: "list_directory", desc: "List directory contents" },
        { name: "search_files", desc: "Search for files by pattern" },
      ],
    },
    {
      title: "🔍 Search & Analysis",
      tools: [
        { name: "grep", desc: "Search file contents with regex" },
        { name: "web_search", desc: "Search the web for information" },
      ],
    },
    {
      title: "⚡ Execution",
      tools: [
        { name: "bash_exec", desc: "Execute bash commands (requires confirmation)" },
        { name: "run_tests", desc: "Run project tests" },
        { name: "run_linter", desc: "Run code linter" },
      ],
    },
    {
      title: "📊 Git Operations",
      tools: [
        { name: "git_status", desc: "Check git status" },
        { name: "git_commit", desc: "Create commits" },
        { name: "git_push", desc: "Push to remote" },
        { name: "git_pull", desc: "Pull from remote" },
      ],
    },
  ];

  for (const category of toolCategories) {
    console.log(chalk.bold(category.title));
    for (const { name, desc } of category.tools) {
      console.log(`  ${chalk.yellow(name.padEnd(18))} ${chalk.dim(desc)}`);
    }
    console.log();
  }

  console.log(chalk.bold("Usage:"));
  console.log(chalk.dim("  The agent automatically uses these tools based on your requests."));
  console.log(chalk.dim("  Destructive operations (write, delete, bash) require confirmation."));
  console.log(chalk.dim("  Use [y]es, [n]o, [a]ll, [t]rust, or [c]ancel when prompted.\n"));

  return false;
}
