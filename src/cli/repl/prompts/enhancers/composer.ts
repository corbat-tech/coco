/**
 * Enhancer Composer — assembles selected enhancers into a single prompt string.
 *
 * Respects a character budget and drops lowest-priority enhancers
 * when the combined content would exceed the limit.
 */

import type { PromptEnhancer } from "./types.js";

/**
 * Default maximum characters for enhancer content (~2000 tokens, ~1% of 200K context).
 * Each enhancer is roughly 300-600 chars, so this fits 4-8 enhancers comfortably.
 */
const DEFAULT_MAX_CHARS = 8000;

/**
 * Compose an array of enhancers into a single prompt string.
 *
 * Enhancers are assumed to be pre-sorted by priority (lowest first).
 * If the total content exceeds `maxChars`, enhancers are dropped from
 * the end (lowest priority = highest number) until within budget.
 *
 * @param enhancers - Sorted array of enhancers to compose
 * @param maxChars - Maximum total characters for the composed output
 * @returns The composed enhancer text, or empty string if no enhancers
 */
export function composeEnhancers(enhancers: PromptEnhancer[], maxChars?: number): string {
  if (enhancers.length === 0) return "";

  const budget = maxChars ?? DEFAULT_MAX_CHARS;
  const sections: string[] = [];
  let totalChars = 0;

  for (const enhancer of enhancers) {
    const section = `## ${enhancer.name}\n\n${enhancer.content}`;
    // Separator (\n\n) only comes before the 2nd+ section
    const separator = sections.length > 0 ? 2 : 0;
    const sectionLen = separator + section.length;

    if (totalChars + sectionLen > budget && sections.length > 0) {
      // Budget exceeded — stop adding more enhancers
      break;
    }

    sections.push(section);
    totalChars += sectionLen;
  }

  return sections.join("\n\n");
}
