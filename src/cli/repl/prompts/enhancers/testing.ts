/**
 * Testing Enhancer — Test integrity and TDD reinforcement.
 *
 * Inspired by: Devin ("never modify tests unless explicitly requested"),
 * Superpowers (TDD skill — "write code before test? Delete it."),
 * Claude Code ("test behavior, not implementation details").
 */

import type { PromptEnhancer } from "./types.js";

export const TESTING_ENHANCER: PromptEnhancer = {
  name: "Testing Discipline",
  description:
    "Enforces test integrity rules: never modify tests without permission, regression tests for bugfixes",
  triggers: ["feature", "bugfix", "test"],
  priority: 30,
  enabled: true,
  content: `Rules for test integrity:
- NEVER modify existing tests to make them pass unless the user explicitly asks
- If tests fail after your change, the bug is in YOUR code, not the test
- Every bugfix MUST include a regression test proving the bug is fixed
- Test BEHAVIOR, not implementation details — tests should survive refactors

When writing new tests:
- One clear assertion per test
- Descriptive names: "should [expected] when [condition]"
- Test edge cases: empty input, null, boundary values, error paths
- Use real code paths — minimize mocks to external boundaries only

When tests fail unexpectedly:
1. Read the FULL test output — don't skip to the first failure
2. Check if YOUR change caused the failure (git stash, re-run)
3. Fix your code to match the expected behavior, not the other way around`,
};
