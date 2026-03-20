/**
 * Context compactor for summarizing conversation history
 * Preserves key information while reducing token usage
 */

import type {
  LLMProvider,
  Message,
  MessageContent,
  TextContent,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
} from "../../../providers/types.js";

type ContentBlock = TextContent | ImageContent | ToolUseContent | ToolResultContent;

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
 * Default compactor configuration.
 * preserveLastN=8 keeps the last 4 user/assistant exchange pairs (8 messages)
 * verbatim — this is the "hot tail" that the LLM needs for immediate reasoning.
 * Everything older is summarized. Claude Code keeps ~last 10 pairs; aider ~4.
 * 8 is a good balance for typical coding tasks.
 */
export const DEFAULT_COMPACTOR_CONFIG: CompactorConfig = {
  preserveLastN: 8,
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
 * Chars kept from the head of a large tool result when trimming within the
 * preserved window during compaction. The last HOT_TAIL_TOOL_PAIRS pairs are
 * kept verbatim; older pairs in the preserved window are soft-capped here.
 * This mirrors Claude Code's "cold storage" concept without disk I/O.
 */
const PRESERVED_RESULT_SOFT_CAP = 16000;
const PRESERVED_RESULT_SOFT_HEAD = 13000;
const PRESERVED_RESULT_SOFT_TAIL = 1500;

/** Number of most-recent tool-result pairs to keep fully verbatim. */
const HOT_TAIL_TOOL_PAIRS = 4;

/**
 * Build the compaction prompt.
 *
 * Structured after the Claude Code compaction prompt — keeps the summary
 * machine-readable so the agent can recover task state post-compaction.
 */
function buildCompactionPrompt(focusTopic?: string): string {
  let prompt = `This is a coding agent session that needs to be compacted due to context length.
Create a structured summary that preserves everything the agent needs to continue working.

## Required sections (use these exact headings):

### Original Request
State the user's original task or question verbatim (or paraphrase if very long).

### Work Completed
List every concrete action taken: files created/modified (with paths), commands run,
bugs fixed, features implemented. Be specific — include file paths and function names.

### Key Decisions
Document architectural decisions, approaches chosen, and the reasoning behind them.

### Current State
Describe exactly where the work stands: what is done, what is in progress, what remains.

### Files Touched
List all file paths that were read, modified, or created during this session.

### Errors & Resolutions
Document any errors encountered and how they were resolved (or if still unresolved).

### Next Steps
If the task is incomplete, list the immediate next actions the agent should take.`;

  if (focusTopic) {
    prompt += `\n\n**PRIORITY**: Preserve ALL details related to "${focusTopic}" — include specific code snippets, exact file paths, and full context. Be concise about unrelated topics.`;
  }

  prompt +=
    `\n\nKeep the total summary under 600 words. Use bullet points within each section.` +
    `\n\nSESSION HISTORY TO SUMMARIZE:\n`;
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
        : (signalOrOptions ?? {});
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
    // Apply hot-tail policy to the preserved window: the last HOT_TAIL_TOOL_PAIRS
    // tool-result pairs are kept fully verbatim; older pairs in the preserved
    // window have their large results soft-capped to avoid stale large outputs
    // that were added before the inline cap was in place.
    const messagesToPreserve = this.trimPreservedToolResults(
      conversationMessages.slice(preserveStart),
    );

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
    const summary = await this.generateSummary(
      conversationText,
      provider,
      signal,
      options.focusTopic,
    );

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
   * Hot-tail policy: apply a soft cap to tool results in the preserved window.
   *
   * The last HOT_TAIL_TOOL_PAIRS tool-result pairs are kept verbatim (hot tail).
   * Older pairs in the preserved window that contain results larger than
   * PRESERVED_RESULT_SOFT_CAP are trimmed to head+tail with a marker.
   *
   * This handles legacy results that were stored before the inline cap was in
   * place, ensuring that a single large stale tree/grep/web result cannot fill
   * the context even after compaction.
   */
  private trimPreservedToolResults(messages: Message[]): Message[] {
    // Walk backwards to find the start of the hot tail (last N tool-result pairs)
    let hotTailStart = messages.length;
    let pairsFound = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const isToolResultMsg =
        Array.isArray(msg.content) &&
        msg.content.length > 0 &&
        (msg.content[0] as { type?: string })?.type === "tool_result";
      if (isToolResultMsg) {
        pairsFound++;
        if (pairsFound >= HOT_TAIL_TOOL_PAIRS) {
          // Include the corresponding assistant(tool_use) message too
          hotTailStart = i > 0 ? i - 1 : i;
          break;
        }
      }
    }

    return messages.map((msg, idx) => {
      if (idx >= hotTailStart) return msg; // hot tail: verbatim
      if (!Array.isArray(msg.content)) return msg;

      const hasOversized = msg.content.some((block) => {
        const b = block as { type?: string; content?: string };
        return (
          b.type === "tool_result" &&
          typeof b.content === "string" &&
          b.content.length > PRESERVED_RESULT_SOFT_CAP
        );
      });
      if (!hasOversized) return msg;

      const blocks = msg.content as ContentBlock[];
      const trimmedContent: ContentBlock[] = blocks.map((block) => {
        if (block.type === "tool_result" && block.content.length > PRESERVED_RESULT_SOFT_CAP) {
          const full = block.content;
          const head = full.slice(0, PRESERVED_RESULT_SOFT_HEAD);
          const tail = full.slice(-PRESERVED_RESULT_SOFT_TAIL);
          const omitted = full.length - PRESERVED_RESULT_SOFT_HEAD - PRESERVED_RESULT_SOFT_TAIL;
          const trimmedResult: ToolResultContent = {
            ...block,
            content:
              `${head}\n` +
              `[... ${omitted.toLocaleString()} chars trimmed (compaction soft-cap) ...]\n` +
              `${tail}`,
          };
          return trimmedResult;
        }
        return block;
      });

      return { ...msg, content: trimmedContent as MessageContent };
    });
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
