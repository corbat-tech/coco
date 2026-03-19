/**
 * Planning Enhancer — Lightweight task planning for multi-step work.
 *
 * Inspired by: Windsurf (dynamic plan updating), Cursor (todo management),
 * Superpowers (writing-plans — 2-5 min atomic tasks), AWS AI-DLC (adaptive depth).
 */

import type { PromptEnhancer } from "./types.js";

export const PLANNING_ENHANCER: PromptEnhancer = {
  name: "Task Planning",
  description:
    "Encourages lightweight planning before multi-step tasks to prevent aimless implementation",
  triggers: ["feature", "plan", "refactor"],
  priority: 35,
  enabled: true,
  content: `For tasks with 3+ steps, plan before coding:
1. List the concrete changes needed (files to create or modify)
2. Identify dependencies between changes (what must come first)
3. Break into atomic steps — each step is one focused action
4. Include verification after each step (test, typecheck, visual check)

Keep plans lightweight — a brief numbered list, not a document.
Update the plan as you discover new information.
Check off steps as you complete them.

For large features: implement vertically (one complete slice end-to-end) rather than horizontally (all models, then all services, then all tests). This validates the approach early.`,
};
