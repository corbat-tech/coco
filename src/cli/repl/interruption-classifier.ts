/**
 * Interruption Classifier
 *
 * Classifies user interruptions during agent execution using LLM to determine:
 * - modify: Add context or change requirements for current task
 * - interrupt: Cancel/stop current work
 * - queue: Add new separate task to background queue
 * - clarification: User asking question about current work
 */

import type { LLMProvider } from "../../providers/types.js";
import type { QueuedInterruption } from "./interruption-handler.js";

/**
 * Interruption action types
 */
export type InterruptionAction = "modify" | "interrupt" | "queue" | "clarification";

/**
 * Queued task for background execution
 */
export interface QueuedTask {
  title: string;
  description: string;
}

/**
 * Interruption routing decision
 */
export interface InterruptionRouting {
  /** Action to take */
  action: InterruptionAction;
  /** Reasoning for the decision */
  reasoning: string;
  /** Combined message for modify action */
  synthesizedMessage?: string;
  /** Tasks to queue for queue action */
  queuedTasks?: QueuedTask[];
  /** Response for clarification action */
  response?: string;
}

/**
 * Classify user interruptions to determine routing
 */
export async function classifyInterruptions(
  interruptions: QueuedInterruption[],
  currentTask: string,
  provider: LLMProvider,
): Promise<InterruptionRouting> {
  // Combine all interruption messages
  const combinedInput = interruptions.map((i) => i.message).join("\n");

  const prompt = `You are analyzing user input that came in WHILE you were working on a task.

**Current task:** ${currentTask}

**User's interruption(s):**
${combinedInput}

Classify the interruption as one of:
1. **modify**: User wants to add context or change requirements for CURRENT task
   - Examples: "also add validation", "use PostgreSQL instead", "make it async"
2. **interrupt**: User wants to CANCEL/STOP current work
   - Examples: "stop", "cancel", "wait", "never mind"
3. **queue**: User wants to add a NEW separate task
   - Examples: "also create a README", "add tests for X later"
4. **clarification**: User is asking a question about current work
   - Examples: "why did you choose X?", "what's the status?"

Respond in JSON format:
{
  "action": "modify" | "interrupt" | "queue" | "clarification",
  "reasoning": "brief explanation",
  "synthesizedMessage": "combined message if action=modify",
  "queuedTasks": [{"title": "...", "description": "..."}] if action=queue,
  "response": "answer to question" if action=clarification
}`;

  try {
    const response = await provider.chat([
      { role: "system", content: "You are a task routing assistant. Analyze user interruptions and classify them." },
      { role: "user", content: prompt },
    ]);

    // Extract JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from LLM response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as InterruptionRouting;

    // Validate the response
    if (!["modify", "interrupt", "queue", "clarification"].includes(parsed.action)) {
      throw new Error(`Invalid action: ${parsed.action}`);
    }

    return parsed;
  } catch {
    // Fallback: treat as clarification if classification fails
    return {
      action: "clarification",
      reasoning: "Failed to classify interruption, treating as clarification for safety",
      response: `I received your message: "${combinedInput}". However, I couldn't determine the intent. Could you clarify?`,
    };
  }
}
