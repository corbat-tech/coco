/**
 * Interruption Processor
 *
 * Processes classified interruptions to determine the appropriate action:
 * - Abort: Signal to stop agent execution immediately
 * - Modify: Queue as context for the next agent turn
 * - Correct: Queue as high-priority context for the next turn
 * - Info: Queue as supplementary context
 *
 * @module cli/repl/interruptions/processor
 */

import { InterruptionType, type ClassifiedInterruption, type ProcessingResult } from "./types.js";

/**
 * Process a batch of classified interruptions
 *
 * @param interruptions - Classified interruptions to process
 * @returns Processing result with abort flag and context messages
 */
export function processInterruptions(interruptions: ClassifiedInterruption[]): ProcessingResult {
  if (interruptions.length === 0) {
    return {
      shouldAbort: false,
      contextMessages: [],
      summary: "No interruptions to process",
    };
  }

  const shouldAbort = interruptions.some((i) => i.type === InterruptionType.Abort);
  const nonAbort = interruptions.filter((i) => i.type !== InterruptionType.Abort);

  const contextMessages: string[] = [];
  const summaryParts: string[] = [];

  if (shouldAbort) {
    summaryParts.push("Abort requested by user");
  }

  // Group non-abort interruptions by type
  const corrections = nonAbort.filter((i) => i.type === InterruptionType.Correct);
  const modifications = nonAbort.filter((i) => i.type === InterruptionType.Modify);
  const info = nonAbort.filter((i) => i.type === InterruptionType.Info);

  // Build context messages (corrections first, then modifications, then info)
  if (corrections.length > 0) {
    contextMessages.push(
      "**Corrections from user (high priority):**\n" +
        corrections.map((c, i) => `${i + 1}. ${c.text}`).join("\n"),
    );
    summaryParts.push(`${corrections.length} correction(s)`);
  }

  if (modifications.length > 0) {
    contextMessages.push(
      "**Modifications requested by user:**\n" +
        modifications.map((m, i) => `${i + 1}. ${m.text}`).join("\n"),
    );
    summaryParts.push(`${modifications.length} modification(s)`);
  }

  if (info.length > 0) {
    contextMessages.push(
      "**Additional context from user:**\n" + info.map((inf, i) => `${i + 1}. ${inf.text}`).join("\n"),
    );
    summaryParts.push(`${info.length} info message(s)`);
  }

  return {
    shouldAbort,
    contextMessages,
    summary: summaryParts.join(", ") || "No actionable interruptions",
  };
}

/**
 * Format interruption context for injection into the next agent turn
 *
 * @param result - Processing result from processInterruptions
 * @returns Formatted string to append to agent messages, or empty string
 */
export function formatInterruptionContext(result: ProcessingResult): string {
  if (result.contextMessages.length === 0) return "";

  return (
    "\n\n---\n## User provided additional instructions while you were working:\n\n" +
    result.contextMessages.join("\n\n") +
    "\n\nPlease incorporate this feedback into your current work.\n"
  );
}
