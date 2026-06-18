/**
 * /agents command — visible subagent UX.
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import {
  AGENT_DESCRIPTIONS,
  AGENT_NAMES,
  getAgentConfig,
  type AgentType,
} from "../agents/index.js";

const AGENT_ALIASES: Record<string, AgentType> = {
  researcher: "explore",
  explorer: "explore",
  architect: "architect",
  editor: "refactor",
  coder: "refactor",
  reviewer: "review",
  tester: "test",
  security: "security",
  "provider-debugger": "debug",
  debugger: "debug",
};

function allAgentTypes(): AgentType[] {
  return Object.keys(AGENT_NAMES) as AgentType[];
}

function resolveAgentType(input: string): AgentType | undefined {
  const normalized = input.replace(/^@/, "").toLowerCase();
  if (normalized in AGENT_NAMES) return normalized as AgentType;
  return AGENT_ALIASES[normalized];
}

function renderAgents(): void {
  console.log(chalk.cyan.bold("\n═══ Subagents ═══\n"));
  for (const type of allAgentTypes()) {
    const config = getAgentConfig(type);
    console.log(`${chalk.cyan("@" + type.padEnd(12))} ${AGENT_NAMES[type]}`);
    console.log(chalk.dim(`   ${AGENT_DESCRIPTIONS[type]}`));
    console.log(chalk.dim(`   tools: ${config.tools.slice(0, 8).join(", ")}`));
  }
  console.log(chalk.dim("\nAliases: @researcher, @editor, @provider-debugger"));
  console.log(chalk.dim("Use /agents run <role> <task> to route the next turn.\n"));
}

export const agentsCommand: SlashCommand = {
  name: "agents",
  aliases: ["agent"],
  description: "List subagents or route a task to a specialized agent",
  usage: "/agents [list|status|run <role> <task>]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const subcommand = args[0]?.toLowerCase() ?? "list";

    if (subcommand === "list") {
      renderAgents();
      return false;
    }

    if (subcommand === "status") {
      console.log(chalk.cyan.bold("\n═══ Subagent Status ═══\n"));
      console.log(
        chalk.dim("  No persistent subagent run is active in this REPL command context."),
      );
      console.log(
        chalk.dim("  Tool-driven agents report progress inside the active assistant turn.\n"),
      );
      return false;
    }

    if (subcommand !== "run") {
      const maybeAgent = resolveAgentType(subcommand);
      if (maybeAgent) {
        args = ["run", subcommand, ...args.slice(1)];
      } else {
        console.log(chalk.red(`Unknown /agents subcommand: ${subcommand}`));
        console.log(chalk.dim("Use /agents list or /agents run <role> <task>.\n"));
        return false;
      }
    }

    const role = args[1];
    const task = args.slice(2).join(" ").trim();
    if (!role || !task) {
      console.log(chalk.red("Usage: /agents run <role> <task>\n"));
      return false;
    }

    const agentType = resolveAgentType(role);
    if (!agentType) {
      console.log(chalk.red(`Unknown agent role: ${role}`));
      console.log(
        chalk.dim(
          `Available: ${allAgentTypes()
            .map((type) => "@" + type)
            .join(", ")}\n`,
        ),
      );
      return false;
    }

    const config = getAgentConfig(agentType);
    session.messages.push({
      role: "user",
      content:
        `[agent directive] Route the next task to @${agentType} (${AGENT_NAMES[agentType]}). ` +
        `Allowed tools: ${config.tools.join(", ")}. Task: ${task}`,
    });

    console.log(chalk.green(`\n✓ Routed next turn to @${agentType} (${AGENT_NAMES[agentType]})`));
    console.log(chalk.dim(`  ${task}\n`));
    return false;
  },
};
