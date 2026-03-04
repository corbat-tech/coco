/**
 * Context compactor for summarizing conversation history
 * Preserves key information while reducing token usage
 */

import type { LLMProvider, Message } from "../../../providers/types.js";

/**
 * Configuration for the context compactor
 */
export interface CompactorConfig {
  /** Number of recent messages to preserve unchanged (default 4) */
  preserveLastN: number;
  /** Maximum tokens for the summary (default 1000) */
  summaryMaxTokens: number;
}

/**
 * Default compactor configuration
 */
export const DEFAULT_COMPACTOR_CONFIG: CompactorConfig = {
  preserveLastN: 4,
  summaryMaxTokens: 1000,
};

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** The compacted messages array */
  messages: Message[];
  /** Original token count (estimated) */
  originalTokens: number;
  /** Compacted token count (estimated) */
  compactedTokens: number;
  /** Whether compaction was performed */
  wasCompacted: boolean;
  /** Key items that were preserved during compaction */
  preserved?: string[];
}

/**
 * Options for compaction
 */
export interface CompactOptions {
  /** Topic to focus on — details about this topic are preserved */
  focusTopic?: string;
  /** Abort signal */
  signal?: AbortSignal;
}

/**
 * Build the compaction prompt, optionally with a focus topic.
 */
function buildCompactionPrompt(focusTopic?: string): string {
  let prompt = `Summarize the following conversation history concisely, preserving:
1. Key decisions made
2. Important code/file changes discussed (always include file paths)
3. Current task context and goals
4. Any errors or issues encountered
5. Original user requests (verbatim if short)`;

  if (focusTopic) {
    prompt += `\n\n**IMPORTANT**: Preserve ALL details related to "${focusTopic}" — include specific code snippets, file paths, decisions, and context about this topic. You may be more concise about unrelated topics.`;
  }

  prompt += `\n\nKeep the summary under 500 words. Format as bullet points.\n\nCONVERSATION:\n`;
  return prompt;
}

/**
 * Compacts conversation history by summarizing older messages
 */
export class ContextCompactor {
  private config: CompactorConfig;

  constructor(config?: Partial<CompactorConfig>) {
    this.config = {
      ...DEFAULT_COMPACTOR_CONFIG,
      ...config,
    };
  }

  /**
   * Compact the conversation history
   *
   * @param messages - The full message history (excluding system prompt)
   * @param provider - The LLM provider to use for summarization
   * @returns Compacted messages with summary replacing older messages
   */
  async compact(
    messages: Message[],
    provider: LLMProvider,
    signalOrOptions?: AbortSignal | CompactOptions,
  ): Promise<CompactionResult> {
    // Support both old (signal) and new (options) calling convention
    const options: CompactOptions =
      signalOrOptions instanceof AbortSignal
        ? { signal: signalOrOptions }
        : signalOrOptions ?? {};
    const signal = options.signal;
    // Filter out system messages - those are handled separately
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // If not enough messages to compact, return as-is
    if (conversationMessages.length <= this.config.preserveLastN) {
      return {
        messages,
        originalTokens: this.estimateTokens(messages, provider),
        compactedTokens: this.estimateTokens(messages, provider),
        wasCompacted: false,
      };
    }

    // Split messages: older ones to summarize, recent ones to preserve.
    // IMPORTANT: The boundary must never fall between an assistant message that
    // has tool_calls and the user message that holds its tool_results.  If we
    // summarise the tool_call side but preserve the tool_result side, the API
    // will reject the request (tool_result without a matching tool_call).
    //
    // Strategy: start at the nominal boundary (-preserveLastN) and walk
    // backward until we find a message that is NOT a tool_result response.
    // That guarantees we never start the preserved window mid-pair.
    let preserveStart = conversationMessages.length - this.config.preserveLastN;
    if (preserveStart > 0) {
      while (preserveStart > 0) {
        const first = conversationMessages[preserveStart];
        if (!first) break;
        const isToolResult =
          Array.isArray(first.content) &&
          first.content.length > 0 &&
          (first.content[0] as { type?: string })?.type === "tool_result";
        if (!isToolResult) break;
        // This message is a tool_result — include the preceding assistant
        // message (with tool_calls) in the preserved window too.
        preserveStart--;
      }
    }
    const messagesToSummarize = conversationMessages.slice(0, preserveStart);
    const messagesToPreserve = conversationMessages.slice(preserveStart);

    // If nothing to summarize, return as-is
    if (messagesToSummarize.length === 0) {
      return {
        messages,
        originalTokens: this.estimateTokens(messages, provider),
        compactedTokens: this.estimateTokens(messages, provider),
        wasCompacted: false,
      };
    }

    // Estimate original token count
    const originalTokens = this.estimateTokens(messages, provider);

    // Format messages for summarization
    const conversationText = this.formatMessagesForSummary(messagesToSummarize);

    // Generate summary using the LLM, with optional focus topic
    const summary = await this.generateSummary(conversationText, provider, signal, options.focusTopic);

    // Create compacted message array
    // Include system messages at the start, then summary, then preserved messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const summaryMessage: Message = {
      role: "user",
      content: `[Previous conversation summary]\n${summary}\n[End of summary - continuing conversation]`,
    };

    const compactedMessages: Message[] = [...systemMessages, summaryMessage, ...messagesToPreserve];

    // Estimate compacted token count
    const compactedTokens = this.estimateTokens(compactedMessages, provider);

    return {
      messages: compactedMessages,
      originalTokens,
      compactedTokens,
      wasCompacted: true,
    };
  }

  /**
   * Format messages into a readable conversation format for summarization
   */
  private formatMessagesForSummary(messages: Message[]): string {
    return messages
      .map((m) => {
        const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
        const content = this.extractTextContent(m.content);
        return `${role}: ${content}`;
      })
      .join("\n\n");
  }

  /**
   * Extract text content from message content (handles various formats)
   */
  private extractTextContent(content: Message["content"]): string {
    if (typeof content === "string") {
      return content;
    }

    // Handle array content (tool calls, etc.)
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (block.type === "text") {
            return block.text;
          }
          if (block.type === "tool_use") {
            return `[Tool: ${block.name}]`;
          }
          if (block.type === "tool_result") {
            const preview = block.content.slice(0, 200);
            return `[Tool result: ${preview}${block.content.length > 200 ? "..." : ""}]`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }

    return String(content);
  }

  /**
   * Generate a summary of the conversation using the LLM
   */
  private async generateSummary(
    conversationText: string,
    provider: LLMProvider,
    signal?: AbortSignal,
    focusTopic?: string,
  ): Promise<string> {
    if (signal?.aborted) return "[Compaction cancelled]";

    const prompt = buildCompactionPrompt(focusTopic) + conversationText;

    try {
      const chatPromise = provider.chat([{ role: "user", content: prompt }], {
        maxTokens: this.config.summaryMaxTokens,
        temperature: 0.3, // Lower temperature for more consistent summaries
      });

      if (signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        const response = await Promise.race([chatPromise, abortPromise]);
        return response.content;
      }

      const response = await chatPromise;
      return response.content;
    } catch (error) {
      // Let abort errors propagate so callers can distinguish cancellation
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // If summarization fails, return a minimal summary
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `[Summary generation failed: ${errorMessage}. Previous conversation had ${conversationText.length} characters.]`;
    }
  }

  /**
   * Estimate token count for messages
   */
  private estimateTokens(messages: Message[], provider: LLMProvider): number {
    let total = 0;
    for (const message of messages) {
      const text = this.extractTextContent(message.content);
      total += provider.countTokens(text);
    }
    return total;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompactorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): CompactorConfig {
    return { ...this.config };
  }
}

/**
 * Create a context compactor with optional configuration
 */
export function createContextCompactor(config?: Partial<CompactorConfig>): ContextCompactor {
  return new ContextCompactor(config);
}
