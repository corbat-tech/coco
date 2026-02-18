/**
 * Interruption Classifier
 *
 * Classifies user messages captured during agent execution into
 * one of four types: Abort, Modify, Correct, or Info.
 *
 * Uses keyword matching with confidence scoring. Simple and fast —
 * no LLM call needed for classification.
 *
 * @module cli/repl/interruptions/classifier
 */

import { InterruptionType, type ClassifiedInterruption } from "./types.js";
import type { QueuedMessage } from "../input/types.js";

/**
 * Keyword patterns for each interruption type
 * Patterns are checked in order of priority (Abort > Modify > Correct > Info)
 */
const ABORT_PATTERNS: RegExp[] = [
  /^(para|stop|cancel|abort|quit|exit|detente|basta)$/i,
  /^(para\s+ya|stop\s+it|cancel\s+that)$/i,
  /\b(para|stop|cancel|abort)\b/i,
];

const MODIFY_PATTERNS: RegExp[] = [
  /^(a[ñn]ade|add|incluye|include|pon|put|agrega)\b/i,
  /^(cambia|change|modifica|modify|usa|use|haz|make)\b/i,
  /^no[,.]?\s+/i, // "no, mejor de la griega" — negation signals redirection
  /^(prefiero|prefer|quiero|i\s+want)\b/i, // "prefiero en gijon" — preference signals redirection
  /\b(a[ñn]ade|add|incluye|include)\s+/i,
  /\b(cambia|change|modifica|modify)\s+/i,
  /\b(en\s+vez\s+de|instead\s+of|rather\s+than)\b/i,
  /\b(prefiero|prefer|mejor|better|más|more|less|menos|bigger|smaller|larger)\b/i,
  /\b(también|also|además|additionally)\b/i,
];

const CORRECT_PATTERNS: RegExp[] = [
  /^(error|bug|fallo|wrong|mal|incorrect)\b/i,
  /^(arregla|fix|corrige|correct|repara|repair)\b/i,
  /\b(error\s+en|bug\s+in|fallo\s+en)\b/i,
  /\b(está\s+mal|is\s+wrong|no\s+funciona|doesn'?t\s+work)\b/i,
  /\b(arregla|fix|corrige|correct)\s+/i,
];

/**
 * Calculate match confidence for a set of patterns
 *
 * @param text - Input text to check
 * @param patterns - Array of regex patterns
 * @returns Confidence score (0-1), 0 if no match
 */
function matchPatterns(text: string, patterns: RegExp[]): number {
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i]!.test(text)) {
      // Earlier patterns = higher confidence (more specific)
      return 1.0 - i * 0.1;
    }
  }
  return 0;
}

/**
 * Classify a captured message into an interruption type
 *
 * @param message - The queued message to classify
 * @returns Classified interruption with type and confidence
 */
export function classifyInterruption(message: QueuedMessage): ClassifiedInterruption {
  const text = message.text;

  // Check patterns in priority order
  const abortConf = matchPatterns(text, ABORT_PATTERNS);
  const modifyConf = matchPatterns(text, MODIFY_PATTERNS);
  const correctConf = matchPatterns(text, CORRECT_PATTERNS);

  // Pick the highest confidence match
  if (abortConf > 0 && abortConf >= modifyConf && abortConf >= correctConf) {
    return {
      text,
      type: InterruptionType.Abort,
      confidence: Math.min(1, abortConf),
      timestamp: message.timestamp,
    };
  }

  if (modifyConf > 0 && modifyConf >= correctConf) {
    return {
      text,
      type: InterruptionType.Modify,
      confidence: Math.min(1, modifyConf),
      timestamp: message.timestamp,
    };
  }

  if (correctConf > 0) {
    return {
      text,
      type: InterruptionType.Correct,
      confidence: Math.min(1, correctConf),
      timestamp: message.timestamp,
    };
  }

  // Default: treat as additional info/context
  return {
    text,
    type: InterruptionType.Info,
    confidence: 0.5,
    timestamp: message.timestamp,
  };
}

/**
 * Classify multiple messages and return them sorted by priority
 * (Abort first, then by timestamp)
 *
 * @param messages - Array of queued messages
 * @returns Array of classified interruptions sorted by priority
 */
export function classifyAll(messages: QueuedMessage[]): ClassifiedInterruption[] {
  const classified = messages.map(classifyInterruption);

  // Sort: Abort first, then by timestamp
  return classified.sort((a, b) => {
    if (a.type === InterruptionType.Abort && b.type !== InterruptionType.Abort) return -1;
    if (b.type === InterruptionType.Abort && a.type !== InterruptionType.Abort) return 1;
    return a.timestamp - b.timestamp;
  });
}
