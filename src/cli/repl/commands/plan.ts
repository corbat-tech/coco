/**
 * Plan Mode Command for REPL
 *
 * Activates read-only plan mode where the agent can only explore and design,
 * not modify files. After generating a plan, the user can approve, edit, or
 * reject it before execution.
 *
 * Usage:
 *   /plan                  - Toggle plan mode on/off
 *   /plan <instruction>    - Enter plan mode with a specific task to plan
 *   /plan approve          - Approve pending plan and execute it
 *   /plan reject           - Reject pending plan and return to normal mode
 *   /plan status           - Show current plan mode status
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

/**
 * Plan mode system prompt injected when plan mode is active
 */
export const PLAN_MODE_SYSTEM_PROMPT = `
## PLAN MODE ACTIVE

You are in **plan mode**. Your task is to explore the codebase and create a detailed implementation plan.

### Rules:
- You can ONLY use read-only tools (file reading, search, git status/log/diff)
- You CANNOT write files, edit files, or execute destructive commands
- Focus on understanding the codebase, identifying affected areas, and designing the approach

### Output format:
When you have gathered enough information, output a structured plan:

1. **Overview**: Brief description of the approach
2. **Files to modify**: List each file with what changes are needed
3. **Files to create**: Any new files needed
4. **Dependencies**: External dependencies or order constraints
5. **Risks**: Potential issues or edge cases
6. **Steps**: Numbered implementation steps

After outputting the plan, the user will decide to approve, edit, or reject it.
`;

/**
 * Plan command — manages plan mode
 */
export const planCommand: SlashCommand = {
  name: "plan",
  aliases: ["p"],
  description: "Toggle plan mode (read-only exploration → approve → execute)",
  usage: "/plan [instruction] | /plan approve | /plan reject | /plan status",
  execute: async (args: string[], session: ReplSession): Promise<boolean> => {
    const subcommand = args[0]?.toLowerCase();

    // /plan status
    if (subcommand === "status") {
      if (session.planMode) {
        p.log.info(chalk.cyan("Plan mode is ACTIVE (read-only tools only)"));
        if (session.pendingPlan) {
          p.log.info("A plan is pending approval. Use /plan approve or /plan reject.");
        }
      } else {
        p.log.info("Plan mode is OFF");
      }
      return false;
    }

    // /plan approve — execute the pending plan
    if (subcommand === "approve") {
      if (!session.pendingPlan) {
        p.log.warn("No pending plan to approve. Use /plan <instruction> to create one.");
        return false;
      }
      // Deactivate plan mode and signal that the plan should be executed
      session.planMode = false;
      const plan = session.pendingPlan;
      session.pendingPlan = null;
      p.log.success("Plan approved! Executing...");
      // The plan text will be used as the next user message by the REPL loop
      // We inject it as a message instruction
      session.messages.push({
        role: "user",
        content:
          `Execute the following approved plan. Implement each step carefully:\n\n${plan}`,
      });
      return false;
    }

    // /plan reject — discard pending plan
    if (subcommand === "reject") {
      if (!session.pendingPlan) {
        p.log.warn("No pending plan to reject.");
      } else {
        session.pendingPlan = null;
        p.log.info("Plan rejected and discarded.");
      }
      session.planMode = false;
      p.log.info("Plan mode deactivated.");
      return false;
    }

    // /plan (no args) — toggle plan mode
    if (args.length === 0) {
      session.planMode = !session.planMode;
      session.pendingPlan = null;

      if (session.planMode) {
        p.log.success(chalk.cyan("Plan mode ACTIVATED"));
        p.log.info("Agent is now restricted to read-only tools.");
        p.log.info("Describe what you want to plan, and the agent will explore and design.");
        p.log.info("Use /plan status to check, /plan reject to deactivate.");
      } else {
        p.log.info("Plan mode deactivated. Full tool access restored.");
      }
      return false;
    }

    // /plan <instruction> — activate plan mode with an instruction
    session.planMode = true;
    session.pendingPlan = null;
    const instruction = args.join(" ");

    p.log.success(chalk.cyan("Plan mode ACTIVATED"));
    p.log.info("Agent will explore the codebase and create a plan.");
    p.log.info(chalk.dim(`Task: ${instruction}`));
    p.log.info("After the plan is generated, use /plan approve or /plan reject.");

    // Inject the planning instruction as a user message
    session.messages.push({
      role: "user",
      content:
        `[PLAN MODE] Create a detailed implementation plan for the following task. ` +
        `Explore the codebase to understand the current state, then output a structured plan.\n\n` +
        `Task: ${instruction}`,
    });

    return false;
  },
};
