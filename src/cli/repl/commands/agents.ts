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
import { resolveAgentProfile } from "../../../runtime/agent-profiles.js";
import { cancelSessionWorkers } from "../delegation.js";

/** Host controls that may run during a turn without a model classification call. */
export function parseLiveAgentControl(message: string): string[] | undefined {
  const match =
    /^\/(?:agents|agent)\s+(status|explain(?:\s+[a-z0-9_-]+)?|cancel\s+[a-z0-9_-]+|mode\s+off)\s*$/i.exec(
      message.trim(),
    );
  return match?.[1]?.toLowerCase().split(/\s+/);
}

function allAgentTypes(): AgentType[] {
  return Object.keys(AGENT_NAMES) as AgentType[];
}

function resolveAgentType(input: string): AgentType | undefined {
  return resolveAgentProfile(input);
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
  console.log(chalk.dim("Use /agents run <role> <task> to execute a specialist.\n"));
}

export const agentsCommand: SlashCommand = {
  name: "agents",
  aliases: ["agent"],
  description: "List subagents or route a task to a specialized agent",
  usage: "/agents [list|status|mode off|manual|auto|run <role> <task>|cancel <id|all>|explain]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const subcommand = args[0]?.toLowerCase() ?? "list";

    if (subcommand === "list") {
      renderAgents();
      return false;
    }

    if (subcommand === "status") {
      console.log(chalk.cyan.bold("\n═══ Subagent Status ═══\n"));
      console.log(chalk.dim(`Mode: ${session.config.agent.delegation?.mode ?? "manual"}`));
      const runs = session.delegationHistory ?? [];
      if (!runs.length) console.log(chalk.dim("No specialist runs recorded in this session."));
      for (const run of runs)
        console.log(`${run.id} @${run.type} ${run.status}: ${run.task.slice(0, 100)}`);
      return false;
    }

    if (subcommand === "mode") {
      const mode = args[1];
      if (mode !== "off" && mode !== "manual" && mode !== "auto") {
        console.log(chalk.red("Usage: /agents mode off|manual|auto"));
        return false;
      }
      session.config.agent.delegation = { ...session.config.agent.delegation, mode };
      if (mode === "off") {
        session.delegationBlockedForTurn = true;
        cancelSessionWorkers(session, "all");
      }
      console.log(
        chalk.green(
          `Delegation mode: ${mode}${mode === "auto" ? " (opt-in; no automatic fan-out without a validated plan)" : ""}`,
        ),
      );
      return false;
    }

    if (subcommand === "cancel") {
      const id = args[1];
      if (id === "all") session.delegationBlockedForTurn = true;
      if (!id) console.log(chalk.red("Usage: /agents cancel <runId|all>"));
      else
        console.log(
          chalk.dim(
            `Cancellation requested for ${cancelSessionWorkers(session, id)} active workers. Completed effects are retained.`,
          ),
        );
      return false;
    }

    if (subcommand === "explain") {
      const run = args[1]
        ? session.delegationHistory?.find((item) => item.id === args[1])
        : session.delegationHistory?.at(-1);
      console.log(
        chalk.dim(
          run
            ? `@${run.type}: ${run.status}. Task: ${run.task}\n${run.error ?? run.output ?? "No terminal result yet."}`
            : "No matching specialist run in this session.",
        ),
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

    if (session.config.agent.delegation?.mode === "off") {
      console.log(
        chalk.red("Delegation is off. Select /agents mode manual before requesting a specialist."),
      );
      return false;
    }
    session.pendingDelegation = { type: agentType, task };

    console.log(chalk.green(`\nQueued specialist @${agentType} (${AGENT_NAMES[agentType]})`));
    console.log(chalk.dim(`  ${task}\n`));
    return false;
  },
};
