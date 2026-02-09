/**
 * Simple Multi-Agent Tool
 *
 * Spawns sub-agents with real LLM tool-use execution via the provider bridge
 */

import { z } from "zod";
import { defineTool } from "./registry.js";
import { getAgentProvider, getAgentToolRegistry } from "../agents/provider-bridge.js";
import { AgentExecutor, AGENT_ROLES } from "../agents/executor.js";

const SpawnSimpleAgentSchema = z.object({
  task: z.string().describe("Task description for the sub-agent"),
  context: z.string().optional().describe("Additional context or instructions for the agent"),
  role: z
    .enum(["researcher", "coder", "tester", "reviewer", "optimizer", "planner"])
    .default("coder")
    .describe("Agent role to use"),
  maxTurns: z.number().default(10).describe("Maximum tool-use turns for the agent"),
});

/**
 * Spawn a sub-agent with real LLM tool-use execution
 */
export const spawnSimpleAgentTool = defineTool({
  name: "spawnSimpleAgent",
  description: `Spawn a sub-agent to handle a specific task with real LLM tool-use execution.

Use this when you need to:
- Delegate a focused task to another agent
- Get a second opinion or alternative approach
- Handle multiple independent subtasks

The sub-agent will work on the task autonomously using available tools.

Example: "Write unit tests for the authentication module"`,
  category: "build" as const,
  parameters: SpawnSimpleAgentSchema,

  async execute(input) {
    const typedInput = input as {
      task: string;
      context?: string;
      role: string;
      maxTurns: number;
    };

    const provider = getAgentProvider();
    const toolRegistry = getAgentToolRegistry();

    if (!provider || !toolRegistry) {
      const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return {
        stdout: JSON.stringify({
          agentId,
          status: "unavailable",
          task: typedInput.task,
          message: "Agent provider not initialized. Call setAgentProvider() during orchestrator startup.",
          success: false,
        }),
        stderr: "",
        exitCode: 1,
        duration: 0,
      };
    }

    const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const executor = new AgentExecutor(provider, toolRegistry);

    const roleDef = AGENT_ROLES[typedInput.role];
    if (!roleDef) {
      return {
        stdout: JSON.stringify({
          agentId,
          status: "error",
          message: `Unknown agent role: ${typedInput.role}`,
          success: false,
        }),
        stderr: "",
        exitCode: 1,
        duration: 0,
      };
    }

    const agentDef = { ...roleDef, maxTurns: typedInput.maxTurns };

    const result = await executor.execute(agentDef, {
      id: agentId,
      description: typedInput.task,
      context: typedInput.context ? { userContext: typedInput.context } : undefined,
    });

    return {
      stdout: JSON.stringify({
        agentId,
        status: result.success ? "completed" : "failed",
        task: typedInput.task,
        output: result.output,
        success: result.success,
        turns: result.turns,
        toolsUsed: result.toolsUsed,
        tokensUsed: result.tokensUsed,
        duration: result.duration,
      }),
      stderr: "",
      exitCode: result.success ? 0 : 1,
      duration: result.duration,
    };
  },
});

/**
 * Check agent capability
 */
export const checkAgentCapabilityTool = defineTool({
  name: "checkAgentCapability",
  description: "Check if multi-agent capability is available and configured",
  category: "build" as const,
  parameters: z.object({}),

  async execute() {
    const provider = getAgentProvider();
    const toolRegistry = getAgentToolRegistry();
    const isReady = provider !== null && toolRegistry !== null;

    return {
      stdout: JSON.stringify({
        multiAgentSupported: true,
        providerConfigured: provider !== null,
        toolRegistryConfigured: toolRegistry !== null,
        ready: isReady,
        availableRoles: Object.keys(AGENT_ROLES),
        features: {
          taskDelegation: isReady ? "ready" : "requires provider initialization",
          parallelSpawn: isReady ? "ready" : "requires provider initialization",
          multiTurnToolUse: isReady ? "ready" : "requires provider initialization",
        },
        status: isReady
          ? "Multi-agent system is ready with real LLM tool-use execution."
          : "Provider not initialized. Call setAgentProvider() during startup.",
      }),
      stderr: "",
      exitCode: 0,
      duration: 0,
    };
  },
});

export const simpleAgentTools = [spawnSimpleAgentTool, checkAgentCapabilityTool];
