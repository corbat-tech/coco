/**
 * Debugging Enhancer — Systematic 4-phase debugging protocol.
 *
 * Inspired by: Superpowers (systematic-debugging skill), Codex CLI
 * ("fix at root cause, not surface-level patches"), research showing
 * 15-30min systematic vs 2-3hr guess-and-check.
 */

import type { PromptEnhancer } from "./types.js";

export const DEBUGGING_ENHANCER: PromptEnhancer = {
  name: "Systematic Debugging",
  description:
    "Enforces 4-phase root cause investigation before any fix attempt for bug and debug requests",
  triggers: ["bugfix", "debug"],
  priority: 25,
  enabled: true,
  content: `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION. Guessing wastes more time than investigating.

Phase 1 — Investigate (complete BEFORE any fix attempt):
1. Read the FULL error message and stack trace — don't skip warnings
2. Reproduce the issue — verify you can trigger it consistently
3. Check recent changes — git diff, new deps, config changes
4. Trace backward — follow the bad value upstream to its origin

Phase 2 — Analyze:
1. Find similar WORKING code in the codebase
2. List every difference between working and broken
3. Identify the specific line or condition causing the failure

Phase 3 — Hypothesize:
1. State your hypothesis clearly: "The bug is caused by X because Y"
2. Make the SMALLEST possible change to test it
3. Test ONE variable at a time — never multiple changes at once

Phase 4 — Fix:
1. Write a failing test that reproduces the bug FIRST
2. Implement the fix
3. Verify the test passes AND no other tests break
4. If the fix doesn't work, form a NEW hypothesis — don't pile fixes

CRITICAL: After 3+ failed attempts, STOP. This is likely architectural. Explain to the user what you've found so far.`,
};
