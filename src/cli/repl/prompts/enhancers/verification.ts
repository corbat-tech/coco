/**
 * Verification Enhancer — Evidence before claims.
 *
 * Inspired by: Superpowers (verification-before-completion), Cursor (linter management),
 * Codex CLI (git status sanity check), Claude Code (professional objectivity).
 *
 * Research basis: Meincke et al. (2025) — authority language doubles LLM compliance.
 */

import type { PromptEnhancer } from "./types.js";

export const VERIFICATION_ENHANCER: PromptEnhancer = {
  name: "Verification Protocol",
  description: "Mandates evidence-based verification before any completion claim",
  triggers: [
    "feature",
    "bugfix",
    "refactor",
    "test",
    "review",
    "question",
    "plan",
    "debug",
    "general",
  ],
  priority: 10,
  enabled: true,
  content: `YOU MUST verify before ANY completion claim. No exceptions.

Gate function (all 5 steps mandatory):
1. IDENTIFY the proving command for your claim (test, build, typecheck, lint)
2. RUN it freshly — cached or remembered results are NOT evidence
3. READ the full output including exit codes
4. VERIFY output matches your claim exactly
5. STATE the result WITH evidence (paste relevant output)

When you catch yourself doing any of these, STOP IMMEDIATELY:
- Using "should", "probably", "seems to", "I believe" → Run verification first
- Saying "Done!", "Fixed!", "Works now!" before running checks → Run checks first
- About to commit or push without ALL checks green → Run the full check suite first
- Trusting a previous test run after making changes → Re-run after every change

Anti-rationalization:
- "Should work now" → RUN the verification. Belief is not evidence.
- "It's a tiny change" → Tiny changes break systems. Verify.
- "I'm confident" → Confidence without evidence is negligence.
- "Tests passed before my change" → Re-run. Your change may have broken them.

After 2 failed fixes on the same issue: STOP guessing. Read error messages thoroughly. Trace data flow backward. Investigate root cause.
After 3+ failures: This is likely architectural. Explain the situation to the user instead of continuing to guess.`,
};
