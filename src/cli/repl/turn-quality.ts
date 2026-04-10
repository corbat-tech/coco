import type { ExecutedToolCall } from "./types.js";

export interface TurnQualityMetrics {
  score: number;
  iterationsUsed: number;
  maxIterations: number;
  executedToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  hadError: boolean;
  repeatedOutputsSuppressed: number;
  observedLargeOutputs?: number;
  observedLargeOutputChars?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeTurnQualityMetrics(input: {
  iterationsUsed: number;
  maxIterations: number;
  executedTools: ExecutedToolCall[];
  hadError: boolean;
  repeatedOutputsSuppressed: number;
  observedLargeOutputs?: number;
  observedLargeOutputChars?: number;
}): TurnQualityMetrics {
  const executedToolCalls = input.executedTools.length;
  const successfulToolCalls = input.executedTools.filter((t) => t.result.success).length;
  const failedToolCalls = executedToolCalls - successfulToolCalls;

  let score = 100;

  if (input.hadError) score -= 25;
  if (executedToolCalls > 0) {
    const failureRatio = failedToolCalls / executedToolCalls;
    score -= Math.round(failureRatio * 35);
  }

  if (input.maxIterations > 0) {
    const iterationRatio = input.iterationsUsed / input.maxIterations;
    if (iterationRatio > 0.8) score -= 10;
    if (iterationRatio >= 1) score -= 10;
  }

  // Suppressing repeated outputs is positive for context efficiency.
  score += Math.min(input.repeatedOutputsSuppressed * 2, 8);

  return {
    score: clamp(score, 0, 100),
    iterationsUsed: input.iterationsUsed,
    maxIterations: input.maxIterations,
    executedToolCalls,
    successfulToolCalls,
    failedToolCalls,
    hadError: input.hadError,
    repeatedOutputsSuppressed: input.repeatedOutputsSuppressed,
    observedLargeOutputs: input.observedLargeOutputs ?? 0,
    observedLargeOutputChars: input.observedLargeOutputChars ?? 0,
  };
}

export interface OutputSuppressionResult {
  content: string;
  suppressed: boolean;
}

export class RepeatedOutputSuppressor {
  private readonly seen = new Map<string, number>();

  transform(toolName: string, content: string): OutputSuppressionResult {
    const fingerprint = this.fingerprint(toolName, content);
    const count = this.seen.get(fingerprint) ?? 0;
    this.seen.set(fingerprint, count + 1);

    if (count === 0) {
      return { content, suppressed: false };
    }

    return {
      content:
        `[Repeated tool output suppressed: '${toolName}' produced the same output as before ` +
        `(occurrence ${count + 1}). If needed, re-run with different inputs.]`,
      suppressed: true,
    };
  }

  private fingerprint(toolName: string, content: string): string {
    const head = content.slice(0, 200);
    const tail = content.slice(-200);
    return `${toolName}|${content.length}|${head}|${tail}`;
  }
}
