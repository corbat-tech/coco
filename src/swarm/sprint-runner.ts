/**
 * Sprint Runner — executes a BacklogSpec via AgentCoordinator.
 *
 * For each sprint:
 *  1. Convert BacklogTasks → AgentTasks (with role-hinted titles)
 *  2. Run through AgentCoordinator (parallel, with dep ordering)
 *  3. GATE: run tests. If failures → fix iteration (up to maxIterationsPerSprint)
 *  4. GATE: quality check via reviewer agent
 *  5. Persist SprintResult to <outputPath>/.coco/sprints/<sprintId>.json
 *
 * After all sprints: integration sprint (tester + reviewer).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { LLMProvider } from "../providers/types.js";
import type { AgentTask } from "../agents/executor.js";
import { AgentExecutor, AGENT_ROLES } from "../agents/executor.js";
import { createAgentCoordinator } from "../agents/coordinator.js";
import { runTestsTool } from "../tools/test.js";
import { createFullToolRegistry } from "../tools/index.js";
import { getMaxSafeAgents } from "../utils/resource-monitor.js";
import type { BacklogSpec, BacklogTask, BuildResult, SprintResult } from "./backlog-spec.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip control characters (newlines, tabs, null bytes…) from a path before
 * embedding it in an LLM prompt. Prevents prompt-injection via crafted paths.
 */
function sanitizeForPrompt(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SprintRunnerOptions {
  spec: BacklogSpec;
  provider: LLMProvider;
  onProgress: (message: string) => void;
}

/**
 * Execute all sprints in a BacklogSpec and return a BuildResult.
 */
export async function runSprints(options: SprintRunnerOptions): Promise<BuildResult> {
  const { spec, provider, onProgress } = options;
  const startTime = Date.now();
  const sprintResults: SprintResult[] = [];

  // Set up executor + coordinator
  const toolRegistry = createFullToolRegistry();
  const executor = new AgentExecutor(provider, toolRegistry);

  // Build agent definitions map from AGENT_ROLES
  const agentDefsMap = new Map(
    Object.entries(AGENT_ROLES).map(([role, def]) => [role, { ...def, maxTurns: 20 }]),
  );
  const coordinator = createAgentCoordinator(executor, agentDefsMap);

  // Ensure output directory exists
  await fs.mkdir(spec.outputPath, { recursive: true });
  const sprintsDir = path.join(spec.outputPath, ".coco", "sprints");
  await fs.mkdir(sprintsDir, { recursive: true });

  // ------------------------------------------------------------------
  // Execute each sprint
  // ------------------------------------------------------------------
  for (const sprint of spec.sprints) {
    onProgress(`Starting ${sprint.id}: ${sprint.name}`);
    const sprintStart = Date.now();
    let iteration = 0;
    let sprintSuccess = false;
    let lastTestsTotal = 0;
    let lastTestsPassing = 0;
    let lastQualityScore = 0;
    const errors: string[] = [];

    // Convert BacklogTasks to AgentTasks
    let agentTasks = backlogTasksToAgentTasks(sprint.tasks, spec.outputPath);

    while (iteration < spec.maxIterationsPerSprint) {
      iteration++;

      // Step 1 — Run tasks through coordinator
      onProgress(
        `  ${sprint.id} iter ${iteration}: running ${agentTasks.length} tasks in parallel…`,
      );

      try {
        await coordinator.coordinateAgents(agentTasks, {
          maxParallelAgents: getMaxSafeAgents(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Coordinator error (iter ${iteration}): ${msg}`);
        onProgress(`  ${sprint.id} iter ${iteration}: coordinator error — ${msg}`);
      }

      // Step 2 — Test gate
      onProgress(`  ${sprint.id} iter ${iteration}: running tests…`);
      let testResult: Awaited<ReturnType<typeof runTestsTool.execute>> | null = null;
      try {
        testResult = await runTestsTool.execute({ cwd: spec.outputPath });
        lastTestsTotal = testResult.total;
        lastTestsPassing = testResult.passed;
      } catch {
        // If tests can't run (no test framework yet), treat as 0 tests passing
        lastTestsTotal = 0;
        lastTestsPassing = 0;
      }

      const hasFails = testResult ? testResult.failed > 0 : false;

      if (hasFails) {
        const failures = testResult?.failures ?? [];
        if (iteration < spec.maxIterationsPerSprint) {
          // Still have retries left — create fix tasks and continue
          onProgress(
            `  ${sprint.id} iter ${iteration}: ${failures.length} test failures — creating fix tasks…`,
          );
          agentTasks = buildFixTasks(sprint.id, iteration, failures);
          continue;
        } else {
          // Last iteration and tests still fail — record failure, skip quality gate
          onProgress(
            `  ${sprint.id}: max iterations reached with ${failures.length} test failures`,
          );
          errors.push(`Tests still failing after ${iteration} iterations`);
          lastQualityScore = 0;
          break;
        }
      }

      // Step 3 — Quality gate (reviewer agent) — only reached when tests pass
      onProgress(`  ${sprint.id} iter ${iteration}: quality review…`);
      const qualityScore = await runQualityCheck(
        coordinator,
        spec.outputPath,
        sprint.id,
        iteration,
      );
      lastQualityScore = qualityScore;

      if (qualityScore >= spec.qualityThreshold) {
        sprintSuccess = true;
        onProgress(
          `  ${sprint.id}: DONE — score ${qualityScore}, ` +
            `${lastTestsPassing}/${lastTestsTotal} tests pass`,
        );
        break;
      }

      if (iteration < spec.maxIterationsPerSprint) {
        onProgress(
          `  ${sprint.id} iter ${iteration}: quality ${qualityScore} < ${spec.qualityThreshold} — improving…`,
        );
        agentTasks = buildImprovementTasks(sprint.id, iteration, qualityScore);
      } else {
        onProgress(
          `  ${sprint.id}: max iterations reached — quality ${qualityScore} (threshold ${spec.qualityThreshold})`,
        );
        errors.push(`Quality threshold not met: ${qualityScore} < ${spec.qualityThreshold}`);
      }
    }

    const result: SprintResult = {
      sprintId: sprint.id,
      success: sprintSuccess,
      testsTotal: lastTestsTotal,
      testsPassing: lastTestsPassing,
      qualityScore: lastQualityScore,
      durationMs: Date.now() - sprintStart,
      iterations: iteration,
      errors,
    };

    sprintResults.push(result);
    await saveSprintResult(sprintsDir, result);
  }

  // ------------------------------------------------------------------
  // Integration sprint
  // ------------------------------------------------------------------
  onProgress("Running integration sprint…");
  const integrationResult = await runIntegrationSprint(coordinator, spec, onProgress);
  sprintResults.push(integrationResult);
  await saveSprintResult(sprintsDir, integrationResult);

  // ------------------------------------------------------------------
  // Aggregate — exclude integration sprint from totalTests to avoid
  // double-counting (integration re-runs the same suite as feature sprints)
  // ------------------------------------------------------------------
  const featureSprints = sprintResults.filter((r) => r.sprintId !== "integration");
  const totalTests = featureSprints.reduce((n, r) => n + r.testsTotal, 0);
  const successCount = sprintResults.filter((r) => r.success).length;
  const finalQualityScore =
    sprintResults.reduce((n, r) => n + r.qualityScore, 0) / (sprintResults.length || 1);

  return {
    success: successCount === sprintResults.length,
    sprintResults,
    totalTests,
    totalDurationMs: Date.now() - startTime,
    finalQualityScore: Math.round(finalQualityScore),
    outputPath: spec.outputPath,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function backlogTasksToAgentTasks(tasks: BacklogTask[], projectPath: string): AgentTask[] {
  return tasks.map((t) => ({
    id: t.id,
    // Role-hinted title so coordinator scores correctly
    description: buildTaskDescription(t),
    context: {
      projectPath,
      role: t.role,
      acceptanceCriteria: t.acceptanceCriteria,
    },
    dependencies: t.dependencies,
  }));
}

function buildTaskDescription(t: BacklogTask): string {
  const roleHints: Record<BacklogTask["role"], string> = {
    researcher: "Research and analyze",
    coder: "Implement and write code for",
    tester: "Write tests and coverage for",
    reviewer: "Review and audit quality of",
    optimizer: "Optimize and refactor",
  };
  const hint = roleHints[t.role] ?? "Implement";
  return (
    `[${t.role.toUpperCase()}] ${hint}: ${t.title}\n\n` +
    `${t.description}\n\n` +
    `Acceptance criteria:\n${t.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
  );
}

function buildFixTasks(
  sprintId: string,
  iteration: number,
  failures: Array<{ name: string; message: string; file: string }>,
): AgentTask[] {
  const failureSummary = failures
    .slice(0, 10)
    .map((f) => `- ${f.name} (${f.file}): ${f.message}`)
    .join("\n");

  return [
    {
      id: `${sprintId}-fix-${iteration}-coder`,
      description:
        `Implement fix for failing tests.\n\n` +
        `These tests are currently failing:\n${failureSummary}\n\n` +
        `Fix the implementation so all tests pass. Do not modify the tests themselves.`,
      context: { iteration, sprintId },
      dependencies: [],
    },
  ];
}

function buildImprovementTasks(
  sprintId: string,
  iteration: number,
  currentScore: number,
): AgentTask[] {
  return [
    {
      id: `${sprintId}-improve-${iteration}`,
      description:
        `Review and improve code quality (current score: ${currentScore}).\n\n` +
        `Audit the codebase for quality issues: complexity, duplication, naming, ` +
        `error handling, and maintainability. Refactor and optimize to bring the ` +
        `quality score above the threshold.`,
      context: { iteration, sprintId, currentScore },
      dependencies: [],
    },
  ];
}

async function runQualityCheck(
  coordinator: ReturnType<typeof createAgentCoordinator>,
  projectPath: string,
  sprintId: string,
  iteration: number,
): Promise<number> {
  const safePath = sanitizeForPrompt(projectPath);
  try {
    const reviewTask: AgentTask = {
      id: `${sprintId}-quality-${iteration}`,
      description:
        `Review and audit code quality of the project at ${safePath}.\n\n` +
        `Check: correctness, test coverage, error handling, maintainability, ` +
        `naming conventions, and code organization.\n\n` +
        `Return a quality score between 0-100 in your response, e.g. "Quality score: 87".`,
      context: { projectPath: safePath, sprintId },
      dependencies: [],
    };

    const coordResult = await coordinator.coordinateAgents([reviewTask], {
      maxParallelAgents: 1,
    });

    const result = coordResult.results.get(reviewTask.id);
    if (!result) return 65; // Reviewer produced no output — conservative default

    // Extract score from output (pattern: "score: NNN" or "NNN/100")
    const match = result.output.match(/(?:score|quality)[:\s]+(\d{1,3})/i);
    if (match) {
      const score = parseInt(match[1] ?? "65", 10);
      return Math.min(100, Math.max(0, score));
    }

    // Reviewer succeeded but provided no numeric score — use conservative default.
    // Do NOT return a passing score here: a reviewer that omits the score should
    // not silently pass the quality gate.
    return 65;
  } catch {
    return 65; // Default under error — conservative
  }
}

/**
 * Run the integration sprint: cross-feature tests + global quality review.
 * startTime is computed internally to avoid stale timestamps from callers.
 */
async function runIntegrationSprint(
  coordinator: ReturnType<typeof createAgentCoordinator>,
  spec: BacklogSpec,
  onProgress: (msg: string) => void,
): Promise<SprintResult> {
  const startTime = Date.now();
  const safePath = sanitizeForPrompt(spec.outputPath);

  const tasks: AgentTask[] = [
    {
      id: "integration-test",
      description:
        `Write and execute integration tests for the full project at ${safePath}.\n\n` +
        `Tests should cover cross-feature interactions. Ensure all features work together. ` +
        `Run the test suite and report results.`,
      context: { projectPath: safePath },
      dependencies: [],
    },
    {
      id: "integration-review",
      description:
        `Review and audit global quality of the project at ${safePath}.\n\n` +
        `Assess: overall architecture, consistency, error handling, and production readiness. ` +
        `Provide a final quality score between 0-100.`,
      context: { projectPath: safePath },
      dependencies: ["integration-test"],
    },
  ];

  let testsPassing = 0;
  let testsTotal = 0;
  let qualityScore = 65;
  const errors: string[] = [];

  try {
    onProgress("  Integration: running integration tests + global review…");
    const coordResult = await coordinator.coordinateAgents(tasks, { maxParallelAgents: 2 });

    // Try to parse test results from tester output
    const testOut = coordResult.results.get("integration-test");
    if (testOut) {
      const passMatch = testOut.output.match(/(\d+)\s+pass(?:ing)?/i);
      const totalMatch = testOut.output.match(/(\d+)\s+(?:test|spec)/i);
      testsPassing = passMatch ? parseInt(passMatch[1] ?? "0", 10) : 0;
      testsTotal = totalMatch ? parseInt(totalMatch[1] ?? "0", 10) : testsPassing;
    }

    // Extract quality score from reviewer output
    const reviewOut = coordResult.results.get("integration-review");
    if (reviewOut) {
      const match = reviewOut.output.match(/(?:score|quality)[:\s]+(\d{1,3})/i);
      if (match) {
        qualityScore = Math.min(100, Math.max(0, parseInt(match[1] ?? "65", 10)));
      }
      // If no score found, conservative default (65) is already set
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Integration sprint error: ${msg}`);
  }

  return {
    sprintId: "integration",
    success: errors.length === 0,
    testsTotal,
    testsPassing,
    qualityScore,
    durationMs: Date.now() - startTime,
    iterations: 1,
    errors,
  };
}

async function saveSprintResult(sprintsDir: string, result: SprintResult): Promise<void> {
  const filePath = path.join(sprintsDir, `${result.sprintId}.json`);
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
}
