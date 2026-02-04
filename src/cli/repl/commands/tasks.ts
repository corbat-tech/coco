/**
 * /tasks command - Show and manage background tasks
 *
 * Displays all background tasks and allows cancellation.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  getBackgroundTaskManager,
  renderTaskList,
  renderTaskStatus,
} from "../background/index.js";

/**
 * Tasks command
 *
 * Usage:
 *   /tasks           - Show all background tasks
 *   /tasks cancel <id> - Cancel a task by ID
 *   /tasks clear     - Clear finished tasks from the list
 *   /tasks <id>      - Show details for a specific task
 */
export const tasksCommand: SlashCommand = {
  name: "tasks",
  aliases: ["bg", "background"],
  description: "Show and manage background tasks",
  usage: "/tasks [cancel <id> | clear | <id>]",

  async execute(args: string[], _session: ReplSession): Promise<boolean> {
    const manager = getBackgroundTaskManager();

    // Handle subcommands
    if (args.length > 0) {
      const subcommand = args[0]!.toLowerCase();

      // Cancel a task
      if (subcommand === "cancel") {
        const taskId = args[1];
        if (!taskId) {
          console.log(chalk.red("Error: Please provide a task ID to cancel"));
          console.log(chalk.dim("Usage: /tasks cancel <task_id>"));
          return false;
        }

        // Allow partial ID matching
        const allTasks = manager.getAllTasks();
        const matchingTask = allTasks.find(
          (t) => t.id === taskId || t.id.endsWith(taskId)
        );

        if (!matchingTask) {
          console.log(chalk.red(`Error: Task not found: ${taskId}`));
          return false;
        }

        const success = manager.cancelTask(matchingTask.id);
        if (success) {
          console.log(chalk.green(`Task "${matchingTask.name}" cancelled`));
        } else {
          console.log(
            chalk.yellow(
              `Task "${matchingTask.name}" could not be cancelled (status: ${matchingTask.status})`
            )
          );
        }
        return false;
      }

      // Clear finished tasks
      if (subcommand === "clear") {
        manager.clearFinishedTasks();
        console.log(chalk.green("Cleared all finished tasks"));
        return false;
      }

      // Show details for a specific task
      const allTasks = manager.getAllTasks();
      const matchingTask = allTasks.find(
        (t) => t.id === subcommand || t.id.endsWith(subcommand)
      );

      if (matchingTask) {
        console.log("");
        console.log(renderTaskStatus(matchingTask));
        console.log("");
        return false;
      }

      // Unknown subcommand
      console.log(chalk.red(`Unknown subcommand: ${subcommand}`));
      console.log(chalk.dim("Usage: /tasks [cancel <id> | clear | <id>]"));
      return false;
    }

    // Default: show all tasks
    const tasks = manager.getAllTasks();
    console.log("");
    console.log(renderTaskList(tasks));
    console.log("");

    // Show usage hint if there are tasks
    if (tasks.length > 0) {
      console.log(chalk.dim("Use /tasks <id> for details, /tasks cancel <id> to cancel"));
    }

    return false;
  },
};
