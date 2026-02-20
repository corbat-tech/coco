/**
 * Tests for backlog-spec types and shape validation.
 *
 * These tests are intentionally lightweight — the types are plain interfaces
 * with no runtime logic. We verify that objects that should satisfy the types
 * actually do (compile-time) and that derived calculations are correct.
 */

import { describe, it, expect } from "vitest";
import { safeRole } from "./backlog-spec.js";
import type {
  BacklogTask,
  Sprint,
  BacklogSpec,
  SprintResult,
  BuildResult,
} from "./backlog-spec.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: "T001",
    title: "Implement feature",
    description: "Write code for the feature",
    role: "coder",
    dependencies: [],
    acceptanceCriteria: ["Code compiles", "Tests pass"],
    estimatedTurns: 10,
    ...overrides,
  };
}

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: "S001",
    name: "Sprint 1",
    goal: "Deliver MVP",
    tasks: [makeTask()],
    ...overrides,
  };
}

function makeSpec(overrides: Partial<BacklogSpec> = {}): BacklogSpec {
  return {
    projectName: "my-app",
    description: "A test app",
    techStack: ["TypeScript", "Node.js"],
    outputPath: "/tmp/my-app",
    sprints: [makeSprint()],
    qualityThreshold: 85,
    maxIterationsPerSprint: 3,
    ...overrides,
  };
}

function makeSprintResult(overrides: Partial<SprintResult> = {}): SprintResult {
  return {
    sprintId: "S001",
    success: true,
    testsTotal: 10,
    testsPassing: 10,
    qualityScore: 90,
    durationMs: 5000,
    iterations: 1,
    errors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BacklogTask", () => {
  it("accepts all valid roles", () => {
    const roles: BacklogTask["role"][] = [
      "researcher",
      "coder",
      "tester",
      "reviewer",
      "optimizer",
    ];
    for (const role of roles) {
      const task = makeTask({ role });
      expect(task.role).toBe(role);
    }
  });

  it("can have dependencies", () => {
    const task = makeTask({ id: "T002", dependencies: ["T001"] });
    expect(task.dependencies).toContain("T001");
  });

  it("stores acceptance criteria as an array", () => {
    const task = makeTask({ acceptanceCriteria: ["A", "B", "C"] });
    expect(task.acceptanceCriteria).toHaveLength(3);
  });
});

describe("Sprint", () => {
  it("contains tasks", () => {
    const sprint = makeSprint({ tasks: [makeTask(), makeTask({ id: "T002" })] });
    expect(sprint.tasks).toHaveLength(2);
  });

  it("has a goal", () => {
    const sprint = makeSprint({ goal: "Ship auth" });
    expect(sprint.goal).toBe("Ship auth");
  });
});

describe("BacklogSpec", () => {
  it("has defaults for qualityThreshold and maxIterationsPerSprint", () => {
    const spec = makeSpec();
    expect(spec.qualityThreshold).toBe(85);
    expect(spec.maxIterationsPerSprint).toBe(3);
  });

  it("accepts custom quality threshold", () => {
    const spec = makeSpec({ qualityThreshold: 90 });
    expect(spec.qualityThreshold).toBe(90);
  });

  it("counts total tasks across all sprints", () => {
    const spec = makeSpec({
      sprints: [
        makeSprint({ tasks: [makeTask(), makeTask({ id: "T002" })] }),
        makeSprint({ id: "S002", tasks: [makeTask({ id: "T003" })] }),
      ],
    });
    const total = spec.sprints.reduce((n, s) => n + s.tasks.length, 0);
    expect(total).toBe(3);
  });
});

describe("SprintResult", () => {
  it("tracks passing/total tests ratio", () => {
    const result = makeSprintResult({ testsTotal: 20, testsPassing: 18 });
    expect(result.testsPassing / result.testsTotal).toBeCloseTo(0.9);
  });

  it("can carry errors", () => {
    const result = makeSprintResult({ success: false, errors: ["Timeout", "OOM"] });
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe("BuildResult", () => {
  it("aggregates sprint results", () => {
    const r1 = makeSprintResult({ sprintId: "S001", testsTotal: 10, testsPassing: 9 });
    const r2 = makeSprintResult({ sprintId: "S002", testsTotal: 5, testsPassing: 5 });

    const buildResult: BuildResult = {
      success: true,
      sprintResults: [r1, r2],
      totalTests: r1.testsTotal + r2.testsTotal,
      totalDurationMs: r1.durationMs + r2.durationMs,
      finalQualityScore: Math.round((r1.qualityScore + r2.qualityScore) / 2),
      outputPath: "/tmp/my-app",
    };

    expect(buildResult.totalTests).toBe(15);
    expect(buildResult.finalQualityScore).toBe(90);
    expect(buildResult.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// safeRole — behavioural tests (function now lives in backlog-spec)
// ---------------------------------------------------------------------------

describe("safeRole", () => {
  it("returns each valid role unchanged", () => {
    const valid = ["researcher", "coder", "tester", "reviewer", "optimizer"] as const;
    for (const role of valid) {
      expect(safeRole(role)).toBe(role);
    }
  });

  it("falls back to 'coder' for unknown strings", () => {
    expect(safeRole("INVALID_ROLE")).toBe("coder");
    expect(safeRole("llm-agent")).toBe("coder");
    expect(safeRole("")).toBe("coder");
  });

  it("is case-sensitive — mixed case returns 'coder'", () => {
    expect(safeRole("Coder")).toBe("coder");
    expect(safeRole("TESTER")).toBe("coder");
    expect(safeRole("Researcher")).toBe("coder");
  });
});
