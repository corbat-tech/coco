/**
 * LLM Adapter for the COMPLETE phase
 *
 * Creates an LLM provider adapter from phase context with token tracking
 */

import type { PhaseContext } from "../types.js";
import type { LLMProvider } from "../../providers/types.js";

/**
 * Token usage tracker
 */
export interface TokenTracker {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
}

/**
 * LLM Provider with token tracking
 */
export interface TrackingLLMProvider extends LLMProvider {
  getTokenUsage(): TokenTracker;
  resetTokenUsage(): void;
}

/**
 * Create LLM adapter from phase context with token tracking
 */
export function createLLMAdapter(context: PhaseContext): TrackingLLMProvider {
  const llmContext = context.llm;

  // Token usage tracker
  const tokenUsage: TokenTracker = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    callCount: 0,
  };

  const trackUsage = (input: number, output: number) => {
    tokenUsage.inputTokens += input;
    tokenUsage.outputTokens += output;
    tokenUsage.totalTokens += input + output;
    tokenUsage.callCount++;
  };

  return {
    id: "phase-adapter",
    name: "Phase LLM Adapter",

    async initialize() {},

    async chat(messages) {
      const adapted = messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
      const response = await llmContext.chat(adapted);

      // Track token usage
      trackUsage(response.usage.inputTokens, response.usage.outputTokens);

      return {
        id: `chat-${Date.now()}`,
        content: response.content,
        stopReason: "end_turn" as const,
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
        model: "phase-adapter",
      };
    },

    async chatWithTools(messages, options) {
      const adapted = messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
      const tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      }));
      const response = await llmContext.chatWithTools(adapted, tools);

      // Track token usage
      trackUsage(response.usage.inputTokens, response.usage.outputTokens);

      return {
        id: `chat-${Date.now()}`,
        content: response.content,
        stopReason: "end_turn" as const,
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
        model: "phase-adapter",
        toolCalls: (response.toolCalls || []).map((tc) => ({
          id: tc.name,
          name: tc.name,
          input: tc.arguments,
        })),
      };
    },

    async *stream(messages) {
      const adapted = messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
      const response = await llmContext.chat(adapted);

      // Track token usage for stream
      trackUsage(response.usage.inputTokens, response.usage.outputTokens);

      yield {
        type: "text" as const,
        text: response.content,
      };
      yield {
        type: "done" as const,
      };
    },

    async *streamWithTools(messages, options) {
      // Fallback to chatWithTools for adapters (no real streaming support)
      const adapted = messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));
      const tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      }));
      const response = await llmContext.chatWithTools(adapted, tools);

      // Track token usage
      trackUsage(response.usage.inputTokens, response.usage.outputTokens);

      // Yield text if present
      if (response.content) {
        yield {
          type: "text" as const,
          text: response.content,
        };
      }

      // Yield tool calls
      for (const tc of response.toolCalls || []) {
        yield {
          type: "tool_use_start" as const,
          toolCall: {
            id: tc.name,
            name: tc.name,
          },
        };
        yield {
          type: "tool_use_end" as const,
          toolCall: {
            id: tc.name,
            name: tc.name,
            input: tc.arguments,
          },
        };
      }

      yield {
        type: "done" as const,
      };
    },

    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },

    getContextWindow(): number {
      return 200000;
    },

    async isAvailable(): Promise<boolean> {
      return true;
    },

    // Token tracking methods
    getTokenUsage(): TokenTracker {
      return { ...tokenUsage };
    },

    resetTokenUsage(): void {
      tokenUsage.inputTokens = 0;
      tokenUsage.outputTokens = 0;
      tokenUsage.totalTokens = 0;
      tokenUsage.callCount = 0;
    },
  };
}
