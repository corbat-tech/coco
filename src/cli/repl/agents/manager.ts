/**
 * Agent Manager for Corbat-Coco
 * Manages spawning, tracking, and lifecycle of specialized subagents
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  LLMProvider,
  Message,
  ToolDefinition,
  ToolCall,
  ToolResultContent,
  ToolUseContent,
} from "../../../providers/types.js";
import type { ToolRegistry } from "../../../tools/registry.js";
import { getLogger } from "../../../utils/logger.js";
import type {
  AgentType,
  SubAgent,
  AgentConfig,
  SpawnAgentOptions,
  AgentResult,
  AgentRegistryEntry,
  AgentEvent,
  AgentEventType,
} from "./types.js";
import { getAgentConfig, AGENT_NAMES, AGENT_DESCRIPTIONS } from "./prompts.js";

/**
 * Maximum number of concurrent agents
 */
const MAX_CONCURRENT_AGENTS = 3;

/**
 * Default timeout for agent execution (5 minutes)
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Agent Manager class
 *
 * @description Handles spawning, tracking, and lifecycle management of specialized subagents.
 * Subagents are autonomous workers that can explore code, create plans, run tests,
 * debug issues, or review code. Each agent runs with a filtered set of tools
 * appropriate for its type.
 *
 * The manager emits events for agent lifecycle changes:
 * - "spawn": When a new agent is created
 * - "complete": When an agent successfully completes
 * - "fail": When an agent fails (error or abort)
 * - "timeout": When an agent exceeds its timeout
 * - "cancel": When an agent is manually cancelled
 *
 * @example
 * ```typescript
 * const manager = new AgentManager(provider, toolRegistry);
 *
 * // Listen for agent events
 * manager.on('complete', (event) => console.log(`Agent ${event.agent.id} completed`));
 *
 * // Spawn an exploration agent
 * const result = await manager.spawn('explore', 'Find all API endpoints');
 * console.log(result.output);
 *
 * // Check active agents
 * console.log(`Running: ${manager.getActiveCount()}`);
 * ```
 */
export class AgentManager extends EventEmitter {
  private activeAgents: Map<string, SubAgent> = new Map();
  private completedAgents: Map<string, SubAgent> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private logger = getLogger();

  /**
   * Create a new AgentManager
   * @param provider - LLM provider for agent execution
   * @param toolRegistry - Tool registry for agent tool access
   */
  constructor(provider: LLMProvider, toolRegistry: ToolRegistry) {
    super();
    this.provider = provider;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Spawn a new subagent for a specific task
   *
   * @description Creates and executes a specialized subagent for the given task.
   * The agent will run autonomously, making LLM calls and executing tools until
   * it completes the task or reaches the maximum turn limit.
   *
   * @param type - Type of agent to spawn (explore, plan, test, debug, review, architect, security, tdd, refactor, e2e, docs, database)
   * @param task - Task description for the agent to execute
   * @param options - Optional spawn configuration including callbacks, abort signal, and timeout
   * @returns Promise resolving to the agent result with output and usage stats
   *
   * @example
   * ```typescript
   * const result = await manager.spawn('test', 'Write tests for UserService', {
   *   onStatusChange: (agent) => console.log(`Status: ${agent.status}`),
   *   onOutput: (agent, text) => console.log(text),
   *   timeout: 60000, // 1 minute timeout
   * });
   * ```
   */
  async spawn(
    type: AgentType,
    task: string,
    options: SpawnAgentOptions = {},
  ): Promise<AgentResult> {
    // Check concurrent agent limit
    if (this.activeAgents.size >= MAX_CONCURRENT_AGENTS) {
      const error = `Cannot spawn agent: maximum concurrent agents (${MAX_CONCURRENT_AGENTS}) reached`;
      this.logger.warn(error);

      const failedAgent = this.createAgent(type, task);
      failedAgent.status = "failed";
      failedAgent.error = error;
      failedAgent.completedAt = new Date();

      return {
        agent: failedAgent,
        success: false,
        output: error,
      };
    }

    // Create the agent
    const agent = this.createAgent(type, task);
    this.activeAgents.set(agent.id, agent);
    options.onStatusChange?.(agent);

    // Set up abort controller for this agent
    const internalAbortController = new AbortController();
    this.abortControllers.set(agent.id, internalAbortController);

    // Link external signal if provided
    if (options.signal) {
      // If already aborted, abort immediately
      if (options.signal.aborted) {
        internalAbortController.abort();
      } else {
        // Listen for future abort
        options.signal.addEventListener("abort", () => {
          internalAbortController.abort();
        });
      }
    }

    // Set up timeout if specified
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => {
      if (this.activeAgents.has(agent.id)) {
        this.logger.warn(`Agent ${agent.id} timed out after ${timeout}ms`);
        internalAbortController.abort();
        agent.error = `Agent timed out after ${timeout}ms`;
        this.emitEvent("timeout", agent);
      }
    }, timeout);

    this.logger.info(`Spawned ${type} agent: ${agent.id}`, { task, timeout });
    this.emitEvent("spawn", agent);

    try {
      // Execute the agent with internal abort controller
      const result = await this.executeAgent(agent, {
        ...options,
        signal: internalAbortController.signal,
      });

      // Clear timeout on completion
      clearTimeout(timeoutId);

      // Emit appropriate event
      if (result.success) {
        this.emitEvent("complete", agent, result);
      } else if (agent.error?.includes("Aborted")) {
        this.emitEvent("cancel", agent, result);
      } else {
        this.emitEvent("fail", agent, result);
      }

      return result;
    } catch (error) {
      // Clear timeout on error
      clearTimeout(timeoutId);

      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      agent.status = "failed";
      agent.error = errorMessage;
      agent.completedAt = new Date();

      this.moveToCompleted(agent.id);
      this.abortControllers.delete(agent.id);
      options.onStatusChange?.(agent);

      this.logger.error(`Agent ${agent.id} failed unexpectedly`, { error: errorMessage });
      this.emitEvent("fail", agent);

      return {
        agent,
        success: false,
        output: errorMessage,
      };
    }
  }

  /**
   * Cancel a running agent
   *
   * @description Cancels an active agent by triggering its abort signal.
   * The agent will stop at the next safe point (beginning of next iteration).
   *
   * @param agentId - ID of the agent to cancel
   * @returns True if the agent was cancelled, false if not found or already completed
   */
  cancel(agentId: string): boolean {
    const controller = this.abortControllers.get(agentId);
    if (!controller) {
      this.logger.warn(`Cannot cancel agent ${agentId}: not found or already completed`);
      return false;
    }

    this.logger.info(`Cancelling agent ${agentId}`);
    controller.abort();
    return true;
  }

  /**
   * Get the status of a specific agent
   *
   * @description Returns the current status of an agent.
   *
   * @param agentId - ID of the agent
   * @returns The agent's status or undefined if not found
   */
  getStatus(agentId: string): SubAgent["status"] | undefined {
    return this.getAgent(agentId)?.status;
  }

  /**
   * Get the current status of an agent
   *
   * @description Retrieves an agent by ID from either active or completed agents.
   *
   * @param agentId - Unique agent identifier (UUID)
   * @returns The agent if found, undefined otherwise
   */
  getAgent(agentId: string): SubAgent | undefined {
    return this.activeAgents.get(agentId) ?? this.completedAgents.get(agentId);
  }

  /**
   * Get all active agents
   * @returns Array of currently running agents
   */
  getActiveAgents(): SubAgent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get all completed agents
   * @returns Array of completed agents (succeeded or failed)
   */
  getCompletedAgents(): SubAgent[] {
    return Array.from(this.completedAgents.values());
  }

  /**
   * Get the number of active agents
   * @returns Count of running agents
   */
  getActiveCount(): number {
    return this.activeAgents.size;
  }

  /**
   * Check if more agents can be spawned
   * @returns True if under the concurrent limit
   */
  canSpawn(): boolean {
    return this.activeAgents.size < MAX_CONCURRENT_AGENTS;
  }

  /**
   * Clear completed agents from history
   */
  clearCompleted(): void {
    this.completedAgents.clear();
    this.logger.debug("Cleared completed agents history");
  }

  /**
   * Get available agent types with their descriptions
   *
   * @description Returns all supported agent types with their names, descriptions,
   * and configurations. Useful for building UI or help text.
   *
   * @returns Array of agent registry entries with type, name, description, and config
   */
  getAvailableAgentTypes(): AgentRegistryEntry[] {
    return (Object.keys(AGENT_NAMES) as AgentType[]).map((type) => ({
      type,
      name: AGENT_NAMES[type],
      description: AGENT_DESCRIPTIONS[type],
      config: getAgentConfig(type),
    }));
  }

  /**
   * Create a new agent instance
   */
  private createAgent(type: AgentType, task: string): SubAgent {
    return {
      id: randomUUID(),
      type,
      status: "idle",
      task,
      createdAt: new Date(),
    };
  }

  /**
   * Execute an agent's task
   */
  private async executeAgent(agent: SubAgent, options: SpawnAgentOptions): Promise<AgentResult> {
    // Get agent configuration
    const config = getAgentConfig(agent.type);

    // Update status to running
    agent.status = "running";
    options.onStatusChange?.(agent);

    // Get tools for this agent (filtered by allowed tools)
    const tools = this.getToolsForAgent(config);

    // Build conversation
    const messages: Message[] = [{ role: "user", content: agent.task }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalOutput = "";
    let iteration = 0;
    const maxTurns = config.maxTurns ?? 10;

    // Agent execution loop
    while (iteration < maxTurns) {
      iteration++;

      // Check for abort
      if (options.signal?.aborted) {
        agent.status = "failed";
        agent.error = "Aborted by user";
        agent.completedAt = new Date();
        this.moveToCompleted(agent.id);
        options.onStatusChange?.(agent);

        return {
          agent,
          success: false,
          output: "Agent execution was aborted",
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        };
      }

      // Call LLM
      const response = await this.provider.chatWithTools(messages, {
        system: config.systemPrompt,
        tools,
        maxTokens: 4096,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // Capture text output
      if (response.content) {
        finalOutput += response.content;
        options.onOutput?.(agent, response.content);
      }

      // Check if no more tool calls
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Add final response to messages
        messages.push({ role: "assistant", content: response.content });
        break;
      }

      // Execute tool calls
      const toolResults = await this.executeToolCalls(response.toolCalls, config);

      // Build assistant message with tool uses
      const toolUses: ToolUseContent[] = response.toolCalls.map((tc) => ({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      }));

      const assistantContent = response.content
        ? [{ type: "text" as const, text: response.content }, ...toolUses]
        : toolUses;

      messages.push({ role: "assistant", content: assistantContent });

      // Add tool results as user message
      messages.push({ role: "user", content: toolResults });

      this.logger.debug(`Agent ${agent.id} completed iteration ${iteration}`, {
        toolCalls: response.toolCalls.length,
      });
    }

    // Mark as completed
    agent.status = "completed";
    agent.result = finalOutput;
    agent.completedAt = new Date();
    this.moveToCompleted(agent.id);
    options.onStatusChange?.(agent);

    this.logger.info(`Agent ${agent.id} completed`, {
      iterations: iteration,
      outputLength: finalOutput.length,
    });

    return {
      agent,
      success: true,
      output: finalOutput,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }

  /**
   * Get tool definitions filtered for the agent's allowed tools
   */
  private getToolsForAgent(config: AgentConfig): ToolDefinition[] {
    const allTools = this.toolRegistry.getToolDefinitionsForLLM();
    const allowedSet = new Set(config.tools);

    return allTools.filter((tool) => allowedSet.has(tool.name)) as ToolDefinition[];
  }

  /**
   * Execute tool calls and return results
   */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    config: AgentConfig,
  ): Promise<ToolResultContent[]> {
    const results: ToolResultContent[] = [];
    const allowedTools = new Set(config.tools);

    for (const toolCall of toolCalls) {
      // Check if tool is allowed for this agent
      if (!allowedTools.has(toolCall.name)) {
        results.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Tool '${toolCall.name}' is not available to this agent type`,
          is_error: true,
        });
        continue;
      }

      // Execute the tool
      try {
        const result = await this.toolRegistry.execute(toolCall.name, toolCall.input);
        results.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: result.success ? String(result.data ?? "Success") : `Error: ${result.error}`,
          is_error: !result.success,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Tool execution failed: ${errorMessage}`,
          is_error: true,
        });
      }
    }

    return results;
  }

  /**
   * Move an agent from active to completed
   */
  private moveToCompleted(agentId: string): void {
    const agent = this.activeAgents.get(agentId);
    if (agent) {
      this.activeAgents.delete(agentId);
      this.completedAgents.set(agentId, agent);
      this.abortControllers.delete(agentId);
    }
  }

  /**
   * Emit an agent event
   */
  private emitEvent(type: AgentEventType, agent: SubAgent, result?: AgentResult): void {
    const event: AgentEvent = { type, agent, result };
    this.emit(type, event);
    this.emit("agent", event); // Also emit generic event
  }
}

/**
 * Create a new AgentManager instance
 *
 * @description Factory function for creating an AgentManager.
 *
 * @param provider - LLM provider for agent execution
 * @param toolRegistry - Tool registry for agent tool access
 * @returns New AgentManager instance
 *
 * @example
 * ```typescript
 * const provider = await createProvider('anthropic');
 * const tools = createFullToolRegistry();
 * const manager = createAgentManager(provider, tools);
 * ```
 */
export function createAgentManager(
  provider: LLMProvider,
  toolRegistry: ToolRegistry,
): AgentManager {
  return new AgentManager(provider, toolRegistry);
}
