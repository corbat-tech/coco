/**
 * Spec Agent — Interactive interview that turns a description into a BacklogSpec.
 *
 * Flow:
 *  1. LLM analyses the initial description and generates clarifying questions (≤4)
 *  2. Two fixed scope questions are always asked
 *  3. LLM generates a full BacklogSpec from all answers
 *  4. User confirms (or --skipConfirmation skips this)
 *  5. BacklogSpec is saved to <outputPath>/.coco/backlog.json
 */

import * as p from "@clack/prompts";
import fs from "node:fs/promises";
import path from "node:path";
import type { LLMProvider } from "../providers/types.js";
import type { BacklogSpec, BacklogTask, Sprint } from "./backlog-spec.js";
import { safeRole } from "./backlog-spec.js";

// ---------------------------------------------------------------------------
// Public error type — callers can catch this to distinguish user cancel
// from real errors
// ---------------------------------------------------------------------------

/** Thrown when the user cancels the spec interview interactively. */
export class UserCancelledError extends Error {
  constructor(message = "Spec interview cancelled by user.") {
    super(message);
    this.name = "UserCancelledError";
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SPEC_AGENT_SYSTEM = `You are a senior technical product manager specialising in rapid MVP delivery.
Your job is to help a developer plan a software project efficiently and honestly.
Always respond with valid JSON only — no markdown fences, no prose outside JSON.`;

// ---------------------------------------------------------------------------
// Types for LLM responses (internal)
// ---------------------------------------------------------------------------

interface ClarifyResponse {
  questions: Array<{
    question: string;
    options?: string[];
    defaultAnswer?: string;
  }>;
}

interface GeneratedBacklogSpec {
  projectName: string;
  description: string;
  techStack: string[];
  sprints: Array<{
    id: string;
    name: string;
    goal: string;
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      role: string;
      dependencies: string[];
      acceptanceCriteria: string[];
      estimatedTurns: number;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJson(text: string): string {
  // Strip optional markdown code fence if the LLM adds one despite instructions
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  return match ? (match[1] ?? text).trim() : text.trim();
}

function validateBacklogSpec(raw: GeneratedBacklogSpec): void {
  if (!raw.sprints || raw.sprints.length === 0) {
    throw new Error("LLM returned no sprints — cannot build a plan.");
  }
  for (const sprint of raw.sprints) {
    if (!sprint.tasks || sprint.tasks.length === 0) {
      throw new Error(`Sprint ${sprint.id} has no tasks.`);
    }
  }
}

/** Cancel the UI gracefully and throw UserCancelledError. Never calls process.exit. */
function cancel(message: string): never {
  p.cancel(message);
  throw new UserCancelledError(message);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SpecInterviewOptions {
  /** Skip the final "does this look good?" confirmation */
  skipConfirmation?: boolean;
}

/**
 * Run an interactive spec interview and produce a BacklogSpec.
 *
 * @param initialDescription  The user's initial description of the app to build
 * @param provider            LLM provider (already configured)
 * @param outputPath          Root directory where the generated project will live
 * @param options             Optional behaviour overrides
 * @throws {UserCancelledError} when the user cancels any prompt
 */
export async function runSpecInterview(
  initialDescription: string,
  provider: LLMProvider,
  outputPath: string,
  options?: SpecInterviewOptions,
): Promise<BacklogSpec> {
  p.intro("  Spec agent — planning your app");

  // ------------------------------------------------------------------
  // Round 1: LLM identifies ambiguities → ≤4 clarifying questions
  // ------------------------------------------------------------------
  const clarifyPrompt = `Analyze this app description and identify the most important ambiguities.
Return a JSON object with at most 4 clarifying questions.
If the description already covers a point clearly, do NOT ask about it.

Description:
"""
${initialDescription}
"""

Response format:
{
  "questions": [
    { "question": "...", "options": ["A", "B"], "defaultAnswer": "A" },
    { "question": "...", "defaultAnswer": "..." }
  ]
}`;

  const clarifyRaw = await provider.chat([
    { role: "system", content: SPEC_AGENT_SYSTEM },
    { role: "user", content: clarifyPrompt },
  ]);

  let clarifyQuestions: ClarifyResponse["questions"] = [];
  try {
    const parsed = JSON.parse(extractJson(clarifyRaw.content)) as ClarifyResponse;
    clarifyQuestions = (parsed.questions ?? []).slice(0, 4);
  } catch {
    // If LLM response is malformed, skip clarifying questions gracefully
    clarifyQuestions = [];
  }

  const answers: Record<string, string> = { originalDescription: initialDescription };

  // Ask each clarifying question — use .entries() to get index directly (avoids indexOf O(n²))
  for (const [idx, q] of clarifyQuestions.entries()) {
    let answer: string | symbol;

    if (q.options && q.options.length > 0) {
      answer = await p.select({
        message: q.question,
        options: q.options.map((o) => ({ value: o, label: o })),
        initialValue: q.defaultAnswer ?? q.options[0],
      });
    } else {
      answer = await p.text({
        message: q.question,
        placeholder: q.defaultAnswer ?? "",
        defaultValue: q.defaultAnswer ?? "",
      });
    }

    if (p.isCancel(answer)) {
      cancel("Spec interview cancelled.");
    }

    answers[`clarify_${idx}`] = answer as string;
  }

  // ------------------------------------------------------------------
  // Round 2: Fixed scope questions (always asked)
  // ------------------------------------------------------------------
  const mvpAnswer = await p.text({
    message: "What must work in the first version? (describe the core user flow)",
    placeholder: "e.g. User can sign up, log in, and create items",
  });
  if (p.isCancel(mvpAnswer)) {
    cancel("Spec interview cancelled.");
  }
  answers.mvpScope = mvpAnswer as string;

  const integrationsAnswer = await p.text({
    message: "Are there external integrations? (email, payments, third-party APIs…)",
    placeholder: "e.g. Stripe for payments, SendGrid for emails — or 'none'",
    defaultValue: "none",
  });
  if (p.isCancel(integrationsAnswer)) {
    cancel("Spec interview cancelled.");
  }
  answers.externalIntegrations = integrationsAnswer as string;

  // ------------------------------------------------------------------
  // Generate BacklogSpec
  // ------------------------------------------------------------------
  p.log.step("Generating sprint plan…");

  const generatePrompt = `You are building a sprint plan for a software project.

Project description: ${answers.originalDescription}
MVP scope: ${answers.mvpScope}
External integrations: ${answers.externalIntegrations}
${Object.entries(answers)
  .filter(([k]) => k.startsWith("clarify_"))
  .map(([, v], i) => `Answer to clarifying question ${i + 1}: ${v}`)
  .join("\n")}

Generate a complete BacklogSpec JSON.
Requirements:
- 2-4 sprints total (each sprint delivers something testable)
- Each sprint has 2-6 tasks
- Tasks must have: id (T001…), title, description, role (researcher|coder|tester|reviewer|optimizer),
  dependencies (other task IDs in the same sprint), acceptanceCriteria (3-5 items), estimatedTurns (5-20)
- Task titles must include role-hinting keywords:
  - researcher tasks: "research", "find", "analyze"
  - coder tasks: "implement", "create", "write code"
  - tester tasks: "test", "coverage", "write tests"
  - reviewer tasks: "review", "audit", "quality"
- Choose a realistic tech stack (include TypeScript and Vitest for testing)
- projectName: short camelCase or kebab-case name

Response format (JSON only, no prose):
{
  "projectName": "my-app",
  "description": "...",
  "techStack": ["TypeScript", "Node.js", ...],
  "sprints": [
    {
      "id": "S001",
      "name": "...",
      "goal": "...",
      "tasks": [
        {
          "id": "T001",
          "title": "Research and analyze...",
          "description": "...",
          "role": "researcher",
          "dependencies": [],
          "acceptanceCriteria": ["...", "..."],
          "estimatedTurns": 10
        }
      ]
    }
  ]
}`;

  const generateRaw = await provider.chat([
    { role: "system", content: SPEC_AGENT_SYSTEM },
    { role: "user", content: generatePrompt },
  ]);

  let generated: GeneratedBacklogSpec;
  try {
    generated = JSON.parse(extractJson(generateRaw.content)) as GeneratedBacklogSpec;
    validateBacklogSpec(generated);
  } catch (err) {
    throw new Error(
      `Spec agent failed to generate a valid plan: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Build final BacklogSpec with defaults and type-safe roles
  const spec: BacklogSpec = {
    projectName: generated.projectName ?? "my-app",
    description: generated.description ?? initialDescription,
    techStack: generated.techStack ?? ["TypeScript", "Node.js"],
    outputPath,
    qualityThreshold: 85,
    maxIterationsPerSprint: 3,
    sprints: generated.sprints.map(
      (s): Sprint => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        tasks: s.tasks.map(
          (t): BacklogTask => ({
            id: t.id,
            title: t.title,
            description: t.description,
            role: safeRole(t.role),
            dependencies: t.dependencies ?? [],
            acceptanceCriteria: t.acceptanceCriteria ?? [],
            estimatedTurns: t.estimatedTurns ?? 10,
          }),
        ),
      }),
    ),
  };

  // ------------------------------------------------------------------
  // Show summary
  // ------------------------------------------------------------------
  p.log.info(
    `Plan: ${spec.sprints.length} sprints, ` +
      `${spec.sprints.reduce((n, s) => n + s.tasks.length, 0)} tasks total`,
  );
  for (const sprint of spec.sprints) {
    p.log.info(`  ${sprint.id}: ${sprint.name} — ${sprint.goal}`);
    for (const task of sprint.tasks) {
      p.log.info(`    · [${task.role}] ${task.title}`);
    }
  }

  // ------------------------------------------------------------------
  // Confirmation
  // ------------------------------------------------------------------
  if (!options?.skipConfirmation) {
    const confirm = await p.confirm({
      message: "Start building with this plan?",
      initialValue: true,
    });
    if (p.isCancel(confirm) || !confirm) {
      cancel("Build cancelled.");
    }
  }

  // ------------------------------------------------------------------
  // Persist to <outputPath>/.coco/backlog.json
  // ------------------------------------------------------------------
  const cocoDir = path.join(outputPath, ".coco");
  await fs.mkdir(cocoDir, { recursive: true });
  await fs.writeFile(path.join(cocoDir, "backlog.json"), JSON.stringify(spec, null, 2), "utf-8");

  p.outro("  Spec saved — starting sprints");

  return spec;
}
