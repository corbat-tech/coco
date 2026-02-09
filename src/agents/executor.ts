/**
 * Agent Executor
 * Executes specialized agents with autonomous loops
 */

import type { LLMProvider, Message } from "../providers/types.js";

// Simplified Tool interface (compatible with existing tools)
export interface Tool {
  name: string;
  description: string;
  execute: (input: any) => Promise<any>;
}

export interface AgentDefinition {
  role: "researcher" | "coder" | "tester" | "reviewer" | "optimizer" | "planner";
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
}

export interface AgentTask {
  id: string;
  description: string;
  context?: Record<string, any>;
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
 * Agent Executor - Runs autonomous agents with tool access
 */
export class AgentExecutor {
  private provider: LLMProvider;
  // Reserved for future tool use implementation
  // private availableTools: Map<string, Tool>;

  constructor(provider: LLMProvider, _tools: Tool[]) {
    this.provider = provider;
    // this.availableTools = new Map(tools.map((t) => [t.name, t]));
  }

  /**
   * Execute an agent on a task
   */
  async execute(agent: AgentDefinition, task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    const toolsUsed = new Set<string>();

    // Build initial messages
    const messages: Message[] = [
      {
        role: "system",
        content: agent.systemPrompt,
      },
      {
        role: "user",
        content: this.buildTaskPrompt(task),
      },
    ];

    // Filter tools for this agent (reserved for future use)
    // const agentTools = this.filterToolsForAgent(agent.allowedTools);

    // Autonomous loop
    let turn = 0;
    let totalTokens = 0;

    while (turn < agent.maxTurns) {
      turn++;

      try {
        // Get response from LLM (simplified - no tool use for now)
        const response = await this.provider.chat(messages);

        const usage = response.usage;
        totalTokens += (usage?.inputTokens || 0) + (usage?.outputTokens || 0);

        // Add assistant message
        messages.push({
          role: "assistant",
          content: response.content,
        });

        // Agent is done after response
        return {
          output: response.content,
          success: true,
          turns: turn,
          toolsUsed: Array.from(toolsUsed),
          tokensUsed: totalTokens,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          output: `Agent error: ${error instanceof Error ? error.message : String(error)}`,
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
   * Filter tools based on agent's allowed tools
   * (Reserved for future tool use implementation)
   */
  // private filterToolsForAgent(allowedToolNames: string[]): Tool[] {
  //   return allowedToolNames.map((name) => this.availableTools.get(name)).filter((t): t is Tool => t !== undefined);
  // }
}

/**
 * Predefined agent roles with system prompts
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
    allowedTools: ["readFile", "searchCode", "listFiles", "analyzeImports"],
  },

  coder: {
    role: "coder",
    systemPrompt: `You are a code generation agent. Your role is to:
- Write high-quality, production-ready code
- Follow best practices and coding standards
- Ensure code is syntactically valid
- Write clean, maintainable code

Use tools to validate syntax, check types, and ensure quality.`,
    allowedTools: ["writeFile", "validateCode", "formatCode", "findMissingImports"],
  },

  tester: {
    role: "tester",
    systemPrompt: `You are a test generation agent. Your role is to:
- Write comprehensive test suites
- Achieve high code coverage
- Test edge cases and error conditions
- Ensure tests are reliable and maintainable

Use tools to analyze code and generate tests.`,
    allowedTools: ["writeFile", "runTests", "calculateCoverage", "analyzeTestQuality"],
  },

  reviewer: {
    role: "reviewer",
    systemPrompt: `You are a code review agent. Your role is to:
- Identify code quality issues
- Check for security vulnerabilities
- Ensure best practices are followed
- Provide actionable feedback

Use tools to analyze code quality and security.`,
    allowedTools: ["readFile", "calculateQuality", "scanSecurity", "analyzeComplexity"],
  },

  optimizer: {
    role: "optimizer",
    systemPrompt: `You are a code optimization agent. Your role is to:
- Reduce code complexity
- Eliminate duplication
- Improve performance
- Refactor for maintainability

Use tools to analyze and improve code.`,
    allowedTools: ["readFile", "analyzeComplexity", "findDuplication", "writeFile"],
  },

  planner: {
    role: "planner",
    systemPrompt: `You are a task planning agent. Your role is to:
- Break down complex tasks into subtasks
- Identify dependencies between tasks
- Estimate complexity and effort
- Create actionable plans

Use tools to analyze requirements and create structured plans.`,
    allowedTools: ["readFile", "analyzeComplexity", "searchCode"],
  },
};

/**
 * Create an agent executor
 */
export function createAgentExecutor(provider: LLMProvider, tools: Tool[]): AgentExecutor {
  return new AgentExecutor(provider, tools);
}
