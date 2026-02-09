/**
 * Agent Executor
 * Executes specialized agents with real multi-turn tool use via LLM tool-use protocol
 */

import type {
  LLMProvider,
  Message,
  MessageContent,
  ToolDefinition,
  ToolUseContent,
  ToolResultContent,
} from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";

export interface AgentDefinition {
  role: "researcher" | "coder" | "tester" | "reviewer" | "optimizer" | "planner";
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
}

export interface AgentTask {
  id: string;
  description: string;
  context?: Record<string, unknown>;
  dependencies?: string[];
}

export interface AgentResult {
  output: string;
  success: boolean;
  turns: number;
  toolsUsed: string[];
  tokensUsed?: number;
  duration: number;
}

/**
 * Agent Executor - Runs autonomous agents with real tool use
 *
 * Uses the LLM tool-use protocol: the LLM requests tool calls,
 * the executor runs them via the ToolRegistry, sends results back,
 * and loops until the LLM is done or max turns is reached.
 */
export class AgentExecutor {
  constructor(
    private provider: LLMProvider,
    private toolRegistry: ToolRegistry,
  ) {}

  /**
   * Execute an agent on a task with multi-turn tool use
   */
  async execute(agent: AgentDefinition, task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    const toolsUsed = new Set<string>();

    // Build initial messages
    const messages: Message[] = [
      {
        role: "user",
        content: this.buildTaskPrompt(task),
      },
    ];

    // Get tool definitions filtered for this agent's allowed tools
    const agentToolDefs = this.getToolDefinitionsForAgent(agent.allowedTools);

    let turn = 0;
    let totalTokens = 0;

    while (turn < agent.maxTurns) {
      turn++;

      try {
        // Call LLM with tools via the tool-use protocol
        const response = await this.provider.chatWithTools(messages, {
          tools: agentToolDefs,
          system: agent.systemPrompt,
        });

        const usage = response.usage;
        totalTokens += (usage?.inputTokens || 0) + (usage?.outputTokens || 0);

        // If no tool calls, the agent is done
        if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
          return {
            output: response.content,
            success: true,
            turns: turn,
            toolsUsed: Array.from(toolsUsed),
            tokensUsed: totalTokens,
            duration: Date.now() - startTime,
          };
        }

        // Build assistant message with tool_use content blocks
        const assistantContent: Array<ToolUseContent | { type: "text"; text: string }> = [];
        if (response.content) {
          assistantContent.push({
            type: "text",
            text: response.content,
          });
        }
        for (const toolCall of response.toolCalls) {
          assistantContent.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          });
        }

        messages.push({
          role: "assistant",
          content: assistantContent as unknown as MessageContent,
        });

        // Execute each tool call and collect results
        const toolResults: ToolResultContent[] = [];

        for (const toolCall of response.toolCalls) {
          toolsUsed.add(toolCall.name);

          try {
            const result = await this.toolRegistry.execute(
              toolCall.name,
              toolCall.input,
            );

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: result.success
                ? JSON.stringify(result.data)
                : `Error: ${result.error}`,
              is_error: !result.success,
            });
          } catch (error) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
              is_error: true,
            });
          }
        }

        // Add tool results as a user message
        messages.push({
          role: "user",
          content: toolResults as unknown as MessageContent,
        });
      } catch (error) {
        return {
          output: `Agent error on turn ${turn}: ${error instanceof Error ? error.message : String(error)}`,
          success: false,
          turns: turn,
          toolsUsed: Array.from(toolsUsed),
          tokensUsed: totalTokens,
          duration: Date.now() - startTime,
        };
      }
    }

    // Max turns reached
    return {
      output: "Agent reached maximum turns without completing task",
      success: false,
      turns: turn,
      toolsUsed: Array.from(toolsUsed),
      tokensUsed: totalTokens,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Build task prompt with context
   */
  private buildTaskPrompt(task: AgentTask): string {
    let prompt = `Task: ${task.description}\n`;

    if (task.context && Object.keys(task.context).length > 0) {
      prompt += `\nContext:\n${JSON.stringify(task.context, null, 2)}\n`;
    }

    prompt += `\nComplete this task autonomously using the available tools. When done, provide a summary of what you accomplished.`;

    return prompt;
  }

  /**
   * Get tool definitions filtered for this agent's allowed tools
   */
  private getToolDefinitionsForAgent(allowedToolNames: string[]): ToolDefinition[] {
    const allDefs = this.toolRegistry.getToolDefinitionsForLLM() as ToolDefinition[];
    if (allowedToolNames.length === 0) return allDefs;
    return allDefs.filter((def) => allowedToolNames.includes(def.name));
  }
}

/**
 * Predefined agent roles with system prompts and real tool names
 */
export const AGENT_ROLES: Record<string, Omit<AgentDefinition, "maxTurns">> = {
  researcher: {
    role: "researcher",
    systemPrompt: `You are a code researcher agent. Your role is to:
- Explore and understand existing codebases
- Find relevant code patterns and examples
- Identify dependencies and relationships
- Document your findings clearly

Use tools to search, read files, and analyze code structure.`,
    allowedTools: ["read_file", "grep", "find_in_file", "glob", "codebase_map"],
  },

  coder: {
    role: "coder",
    systemPrompt: `You are a code generation agent. Your role is to:
- Write high-quality, production-ready code
- Follow best practices and coding standards
- Ensure code is syntactically valid
- Write clean, maintainable code

Use tools to read existing code, write new files, and validate syntax.`,
    allowedTools: ["read_file", "write_file", "edit_file", "bash_exec", "validateCode"],
  },

  tester: {
    role: "tester",
    systemPrompt: `You are a test generation agent. Your role is to:
- Write comprehensive test suites
- Achieve high code coverage
- Test edge cases and error conditions
- Ensure tests are reliable and maintainable

Use tools to read code, write tests, and run them.`,
    allowedTools: ["read_file", "write_file", "run_tests", "get_coverage", "run_test_file"],
  },

  reviewer: {
    role: "reviewer",
    systemPrompt: `You are a code review agent. Your role is to:
- Identify code quality issues
- Check for security vulnerabilities
- Ensure best practices are followed
- Provide actionable feedback

Use tools to read and analyze code quality.`,
    allowedTools: ["read_file", "calculate_quality", "analyze_complexity", "grep"],
  },

  optimizer: {
    role: "optimizer",
    systemPrompt: `You are a code optimization agent. Your role is to:
- Reduce code complexity
- Eliminate duplication
- Improve performance
- Refactor for maintainability

Use tools to analyze and improve code.`,
    allowedTools: ["read_file", "write_file", "edit_file", "analyze_complexity", "grep"],
  },

  planner: {
    role: "planner",
    systemPrompt: `You are a task planning agent. Your role is to:
- Break down complex tasks into subtasks
- Identify dependencies between tasks
- Estimate complexity and effort
- Create actionable plans

Use tools to analyze requirements and explore the codebase.`,
    allowedTools: ["read_file", "grep", "glob", "codebase_map"],
  },
};

/**
 * Create an agent executor
 */
export function createAgentExecutor(provider: LLMProvider, toolRegistry: ToolRegistry): AgentExecutor {
  return new AgentExecutor(provider, toolRegistry);
}
