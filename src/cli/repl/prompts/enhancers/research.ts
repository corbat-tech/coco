/**
 * Research Enhancer — Proactive codebase investigation before changes.
 *
 * Inspired by: Cursor (codebase_search as primary tool), Windsurf ("proactively search"),
 * Augment Code ("always call codebase-retrieval first"), Devin ("examine surrounding code").
 */

import type { PromptEnhancer } from "./types.js";

export const RESEARCH_ENHANCER: PromptEnhancer = {
  name: "Proactive Codebase Research",
  description:
    "Mandates codebase investigation before any code modification to prevent breaking changes",
  triggers: ["feature", "bugfix", "refactor", "debug"],
  priority: 15,
  enabled: true,
  content: `YOU MUST understand the impact zone before writing or editing ANY code.

Before modifying a function, type, or variable:
1. SEARCH for all usages — grep for the symbol name across the codebase
2. SEARCH for similar implementations — avoid duplicating what already exists
3. READ related files — not just the target file, also its importers and dependencies
4. CHECK patterns — how does existing code in this area handle similar cases?

This prevents:
- Breaking 5 files you didn't know import that function
- Reimplementing something that already exists nearby
- Violating established conventions and patterns

NEVER edit a file you haven't read in the current conversation.
NEVER modify a function without checking its callers first.
NEVER add a new utility without searching for existing similar utilities.
When the codebase already has a pattern for something, follow that pattern.`,
};
