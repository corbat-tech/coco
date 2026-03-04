/**
 * Simple Multi-Agent Tool
 *
 * Spawns sub-agents with specialized roles via the unified AgentManager system.
 * Supports 12 agent types (explore, plan, test, debug, review, architect,
 * security, tdd, refactor, e2e, docs, database) with proper tool whitelists
 * and specialized prompts.
 */

import { z } from "zod";
import { defineTool } from "./registry.js";
import { getAgentProvider, getAgentToolRegistry, getAgentManager } from "../agents/provider-bridge.js";
import type { AgentType } from "../cli/repl/agents/types.js";
import { AGENT_NAMES, AGENT_DESCRIPTIONS } from "../cli/repl/agents/prompts.js";

/**
 * All available agent types from the unified AgentManager system.
 */
const AGENT_TYPES = [
  "explore",
  "plan",
  "test",
  "debug",
  "review",
  "architect",
  "security",
  "tdd",
  "refactor",
  "e2e",
  "docs",
  "database",
] as const;

/**
 * Maps legacy role names to the closest AgentManager type.
 * Ensures backward compatibility with existing callers.
 */
const LEGACY_ROLE_MAP: Record<string, AgentType> = {
  researcher: "explore",
  coder: "debug", // "debug" has write + bash + read — closest to general coding
  tester: "test",
  reviewer: "review",
  optimizer: "refactor",
  planner: "plan",
};

const SpawnSimpleAgentSchema = z.object({
  task: z.string().describe("Task description for the sub-agent"),
  context: z.string().optional().describe("Additional context or instructions for the agent"),
  type: z
    .enum(AGENT_TYPES)
    .optional()
    .describe(
      "Specialized agent type. Use 'explore' for codebase search, 'plan' for design, 'test' for testing, 'review' for code review, 'architect' for system design, 'security' for security audit, 'tdd' for test-driven development, 'debug' for debugging, 'refactor' for code improvement, 'e2e' for integration tests, 'docs' for documentation, 'database' for DB operations.",
    ),
  role: z
    .enum(["researcher", "coder", "tester", "reviewer", "optimizer", "planner"])
    .optional()
    .describe("DEPRECATED: Use 'type' instead. Legacy role name, mapped to new agent types."),
  maxTurns: z.number().default(10).describe("Maximum tool-use turns for the agent"),
});

/**
 * Resolve the agent type from input, supporting both new 'type' and legacy 'role'.
 */
function resolveAgentType(input: { type?: AgentType; role?: string }): AgentType {
  if (input.type) return input.type;
  if (input.role && input.role in LEGACY_ROLE_MAP) return LEGACY_ROLE_MAP[input.role] as AgentType;
  return "explore"; // default
}

/**
 * Spawn a sub-agent with specialized role via the unified AgentManager
 */
export const spawnSimpleAgentTool = defineTool({
  name: "spawnSimpleAgent",
  description: `Spawn a specialized sub-agent to handle a specific task autonomously.

Available agent types:
- explore: Search and understand codebases (read-only, fast)
- plan: Design implementation approaches (read-only)
- test: Write and run tests
- debug: Analyze errors and fix issues
- review: Review code for quality and best practices (read-only)
- architect: Design system architecture (read-only)
- security: Audit code for security vulnerabilities (read-only)
- tdd: Test-driven development with RED-GREEN-REFACTOR
- refactor: Improve code structure without changing behavior
- e2e: End-to-end integration testing
- docs: Generate and maintain documentation
- database: Design schemas, migrations, and optimize queries

Each type has a filtered set of tools appropriate for its role.
Use 'explore' for quick codebase searches, 'plan' for design before execution.`,
  category: "build" as const,
  parameters: SpawnSimpleAgentSchema,

  async execute(input) {
    const typedInput = input as {
      task: string;
      context?: string;
      type?: AgentType;
      role?: string;
      maxTurns: number;
    };

    const manager = getAgentManager();

    if (!manager) {
      const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return {
        stdout: JSON.stringify({
          agentId,
          status: "unavailable",
          task: typedInput.task,
          message:
            "Agent provider not initialized. Call setAgentProvider() during orchestrator startup.",
          success: false,
        }),
        stderr: "",
        exitCode: 1,
        duration: 0,
      };
    }

    const agentType = resolveAgentType(typedInput);

    // Prepend context to task if provided
    const taskDescription = typedInput.context
      ? `${typedInput.task}\n\nAdditional context: ${typedInput.context}`
      : typedInput.task;

    const startTime = Date.now();
    const result = await manager.spawn(agentType, taskDescription, {
      timeout: typedInput.maxTurns * 60_000, // rough estimate: 1 min per turn
    });

    const duration = Date.now() - startTime;

    return {
      stdout: JSON.stringify({
        agentId: result.agent.id,
        agentType,
        status: result.success ? "completed" : "failed",
        task: typedInput.task,
        output: result.output,
        success: result.success,
        usage: result.usage,
        duration,
      }),
      stderr: "",
      exitCode: result.success ? 0 : 1,
      duration,
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

    const agentTypes = Object.entries(AGENT_DESCRIPTIONS).map(([type, description]) => ({
      type,
      name: AGENT_NAMES[type as AgentType],
      description,
    }));

    return {
      stdout: JSON.stringify({
        multiAgentSupported: true,
        providerConfigured: provider !== null,
        toolRegistryConfigured: toolRegistry !== null,
        ready: isReady,
        availableTypes: agentTypes,
        features: {
          taskDelegation: isReady ? "ready" : "requires provider initialization",
          parallelSpawn: isReady ? "ready" : "requires provider initialization",
          multiTurnToolUse: isReady ? "ready" : "requires provider initialization",
          specializedAgents: isReady ? "ready" : "requires provider initialization",
        },
        status: isReady
          ? "Multi-agent system is ready with 12 specialized agent types."
          : "Provider not initialized. Call setAgentProvider() during startup.",
      }),
      stderr: "",
      exitCode: 0,
      duration: 0,
    };
  },
});

export const simpleAgentTools = [spawnSimpleAgentTool, checkAgentCapabilityTool];
