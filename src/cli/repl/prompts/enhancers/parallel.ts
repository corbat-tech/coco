/**
 * Parallel Execution Enhancer — Concurrent tool calling strategy.
 *
 * Inspired by: Cursor ("CRITICAL INSTRUCTION" for parallel calls),
 * Codex CLI (multi_tool_use.parallel), research showing 3-5x speedup.
 */

import type { PromptEnhancer } from "./types.js";

export const PARALLEL_ENHANCER: PromptEnhancer = {
  name: "Parallel Tool Execution",
  description:
    "Instructs the agent to execute independent tool calls concurrently for 3-5x speedup",
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
  priority: 20,
  enabled: true,
  content: `ALWAYS execute independent operations concurrently. This is 3-5x faster.

Parallel (no data dependency):
- Reading multiple files → call all read_file in one batch
- Multiple grep/glob searches → call all in one batch
- Checking git status + reading files → parallel
- Running typecheck + listing directories → parallel

Sequential ONLY when output of step A is needed as input for step B:
- Search → read results (need file paths from search)
- Write file → run tests (need file written first)
- Read file → edit file (need current content first)

DEFAULT IS PARALLEL. Only go sequential if you can name the specific data dependency.
Do NOT read files one by one — batch all reads together.
Do NOT alternate search-read-search-read — search all at once, then read all at once.`,
};
