/**
 * LLM Adapter for the COMPLETE phase
 *
 * Creates an LLM provider adapter from phase context
 */

import type { PhaseContext } from "../types.js";
import type { LLMProvider } from "../../providers/types.js";

/**
 * Create LLM adapter from phase context
 */
export function createLLMAdapter(context: PhaseContext): LLMProvider {
  const llmContext = context.llm;

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
      yield {
        type: "text" as const,
        text: response.content,
      };
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
  };
}
