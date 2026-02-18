/**
 * LLM-based Interruption Classifier
 *
 * Uses a fast parallel LLM call to classify user messages captured during
 * agent execution. Falls back to keyword-based classification on timeout.
 *
 * The LLM understands semantics, multiple languages, and context — unlike
 * keyword patterns which are fragile and language-specific.
 *
 * @module cli/repl/interruptions/llm-classifier
 */

import type { LLMProvider, ChatOptions } from "../../../providers/types.js";
import type { QueuedMessage } from "../input/types.js";
import { InterruptionAction } from "../interruptions/types.js";
import { classifyInterruption } from "./classifier.js";
import { mapClassificationToAction } from "../input/action-selector.js";

/** Classification result from the LLM classifier */
export interface LLMClassificationResult {
  action: InterruptionAction;
  /** Whether the result came from the LLM or fell back to keywords */
  source: "llm" | "keywords";
}

/** Configuration for the LLM classifier */
export interface LLMClassifierConfig {
  /** Timeout in ms for the LLM call before falling back to keywords (default: 3000) */
  timeoutMs: number;
  /** Max tokens for the LLM response (default: 3) */
  maxTokens: number;
  /** Temperature for classification (default: 0 — deterministic) */
  temperature: number;
}

const DEFAULT_CONFIG: LLMClassifierConfig = {
  timeoutMs: 8000,
  maxTokens: 10,
  temperature: 0,
};

/**
 * System prompt for the classification LLM call.
 * Kept minimal to reduce latency and token usage.
 */
const CLASSIFICATION_SYSTEM_PROMPT = `You are a message classifier for a coding assistant. The user sent a message while the assistant was working on a task.

Classify the message into exactly ONE category. Reply with ONLY the category word, nothing else.

Categories:
- MODIFY: The message changes, corrects, or redirects the CURRENT task (e.g. "use Python instead", "no, make it blue", "add tests too", "hazlo en español", "better make it bigger")
- QUEUE: The message is a NEW, DIFFERENT task unrelated to what's being done (e.g. "what's 2+2", "tell me the weather", "create another file for X")
- ABORT: The message asks to stop/cancel the current work (e.g. "stop", "cancel", "para", "never mind")

Reply with exactly one word: MODIFY, QUEUE, or ABORT`;

/**
 * Build the user message for classification.
 * Includes the original task for context so the LLM can distinguish
 * "modify current task" from "new different task".
 */
function buildClassificationPrompt(
  userMessage: string,
  currentTask: string | null,
): string {
  if (currentTask) {
    return `Current task: "${currentTask}"\nUser's new message: "${userMessage}"`;
  }
  return `User's new message: "${userMessage}"`;
}

/**
 * Parse the LLM response into an InterruptionAction.
 * Returns null if the response doesn't match any known action.
 */
function parseResponse(response: string): InterruptionAction | null {
  const normalized = response.trim().toUpperCase();

  if (normalized.includes("MODIFY")) return InterruptionAction.Modify;
  if (normalized.includes("QUEUE")) return InterruptionAction.Queue;
  if (normalized.includes("ABORT")) return InterruptionAction.Abort;

  return null;
}

/**
 * Classify a message using keyword-based fallback (synchronous, instant).
 */
function classifyWithKeywords(message: QueuedMessage): InterruptionAction {
  const classified = classifyInterruption(message);
  return mapClassificationToAction(classified.type);
}

/**
 * Create an LLM-based classifier instance.
 *
 * @param provider - The LLM provider to use for classification calls
 * @param config - Optional configuration overrides
 * @returns Classifier with a `classify()` method
 */
export function createLLMClassifier(
  provider: LLMProvider,
  config?: Partial<LLMClassifierConfig>,
) {
  const cfg: LLMClassifierConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    /**
     * Classify a user message captured during agent execution.
     *
     * Makes a fast parallel LLM call. If the LLM doesn't respond within
     * the timeout, falls back to keyword-based classification.
     *
     * @param message - The captured message
     * @param currentTask - The original task the agent is working on (for context)
     * @returns Classification result with action and source
     */
    async classify(
      message: QueuedMessage,
      currentTask: string | null,
    ): Promise<LLMClassificationResult> {
      // Race: LLM classification vs timeout
      const llmPromise = classifyWithLLM(provider, message, currentTask, cfg);
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), cfg.timeoutMs),
      );

      const llmResult = await Promise.race([llmPromise, timeoutPromise]);

      if (llmResult !== null) {
        return { action: llmResult, source: "llm" };
      }

      // Timeout: fall back to keywords
      return {
        action: classifyWithKeywords(message),
        source: "keywords",
      };
    },
  };
}

/**
 * Make the actual LLM classification call.
 * Returns null if the call fails for any reason.
 */
async function classifyWithLLM(
  provider: LLMProvider,
  message: QueuedMessage,
  currentTask: string | null,
  cfg: LLMClassifierConfig,
): Promise<InterruptionAction | null> {
  try {
    const userPrompt = buildClassificationPrompt(message.text, currentTask);

    const options: ChatOptions = {
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      timeout: cfg.timeoutMs,
    };

    const response = await provider.chat(
      [{ role: "user", content: userPrompt }],
      options,
    );

    return parseResponse(response.content);
  } catch {
    // Any error (network, rate limit, etc.) → return null to trigger fallback
    return null;
  }
}

/** Type alias for the classifier instance */
export type LLMClassifier = ReturnType<typeof createLLMClassifier>;
