/**
 * Tests for sprint-runner.ts — runSprints()
 *
 * We mock:
 *  - AgentCoordinator / createAgentCoordinator — avoid real LLM calls
 *  - runTestsTool.execute — return controlled test results
 *  - node:fs/promises — avoid disk I/O
 *  - resource-monitor — deterministic safe agents count
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock handles (must be declared before vi.mock calls, which are hoisted)
// ---------------------------------------------------------------------------
const { mockCoordinateAgents, mockRunTests } = vi.hoisted(() => ({
  mockCoordinateAgents: vi.fn(),
  mockRunTests: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock resource monitor
vi.mock("../utils/resource-monitor.js", () => ({
  getMaxSafeAgents: vi.fn().mockReturnValue(2),
}));

// Mock AgentExecutor + AGENT_ROLES
vi.mock("../agents/executor.js", () => ({
  AgentExecutor: vi.fn().mockImplementation(() => ({})),
  AGENT_ROLES: {
    researcher: { role: "researcher", systemPrompt: "", allowedTools: [] },
    coder: { role: "coder", systemPrompt: "", allowedTools: [] },
    tester: { role: "tester", systemPrompt: "", allowedTools: [] },
    reviewer: { role: "reviewer", systemPrompt: "", allowedTools: [] },
    optimizer: { role: "optimizer", systemPrompt: "", allowedTools: [] },
    planner: { role: "planner", systemPrompt: "", allowedTools: [] },
  },
}));

// Mock tool registry (sprint-runner uses createFullToolRegistry from tools/index.js)
vi.mock("../tools/index.js", () => ({
  createFullToolRegistry: vi.fn().mockReturnValue({}),
}));

// Mock coordinator — returned by createAgentCoordinator
vi.mock("../agents/coordinator.js", () => ({
  createAgentCoordinator: vi.fn().mockImplementation(() => ({
    coordinateAgents: mockCoordinateAgents,
  })),
}));

// Mock runTestsTool
vi.mock("../tools/test.js", () => ({
  runTestsTool: {
    execute: mockRunTests,
  },
}));

// Mock fs/promises — avoid real disk I/O
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

import { runSprints } from "./sprint-runner.js";
import type { BacklogSpec } from "./backlog-spec.js";
import type { LLMProvider } from "../providers/types.js";
import type { CoordinationResult } from "../agents/coordinator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(overrides: Partial<BacklogSpec> = {}): BacklogSpec {
  return {
    projectName: "test-app",
    description: "Test",
    techStack: ["TypeScript"],
    outputPath: "/tmp/test-app",
    qualityThreshold: 85,
    maxIterationsPerSprint: 3,
    sprints: [
      {
        id: "S001",
        name: "Sprint 1",
        goal: "Build core",
        tasks: [
          {
            id: "T001",
            title: "Implement core",
            description: "Write code",
            role: "coder",
            dependencies: [],
            acceptanceCriteria: ["Tests pass"],
            estimatedTurns: 10,
          },
        ],
      },
    ],
    ...overrides,
  };
}

const mockProvider = {} as LLMProvider;

function successCoordResult(): CoordinationResult {
  return {
    results: new Map([
      [
        "S001-quality-1",
        { output: "Quality score: 90", success: true, turns: 5, toolsUsed: [], duration: 100 },
      ],
      [
        "integration-test",
        {
          output: "5 passing tests, 5 total",
          success: true,
          turns: 3,
          toolsUsed: [],
          duration: 200,
        },
      ],
      [
        "integration-review",
        { output: "Quality score: 88", success: true, turns: 3, toolsUsed: [], duration: 150 },
      ],
    ]),
    totalDuration: 500,
    levelsExecuted: 2,
    parallelismAchieved: 1,
  };
}

function passingTestResult() {
  return {
    passed: 5,
    failed: 0,
    skipped: 0,
    total: 5,
    duration: 1000,
    success: true,
    failures: [],
  };
}

function failingTestResult() {
  return {
    passed: 3,
    failed: 2,
    skipped: 0,
    total: 5,
    duration: 1200,
    success: false,
    failures: [
      { name: "should pass", file: "src/index.test.ts", message: "Expected true, got false" },
      { name: "should work", file: "src/other.test.ts", message: "ReferenceError" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSprints", () => {
  it("returns a BuildResult with success=true when all sprints pass", async () => {
    mockCoordinateAgents.mockResolvedValue(successCoordResult());
    mockRunTests.mockResolvedValue(passingTestResult());

    const result = await runSprints({
      spec: makeSpec(),
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(result.sprintResults.length).toBeGreaterThan(0);
  });

  it("includes integration sprint in results", async () => {
    mockCoordinateAgents.mockResolvedValue(successCoordResult());
    mockRunTests.mockResolvedValue(passingTestResult());

    const result = await runSprints({
      spec: makeSpec(),
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    const hasIntegration = result.sprintResults.some((r) => r.sprintId === "integration");
    expect(hasIntegration).toBe(true);
  });

  it("retries on test failures and creates fix tasks", async () => {
    // First iteration: tests fail → retry with fix tasks → pass on second
    mockRunTests
      .mockResolvedValueOnce(failingTestResult())
      .mockResolvedValue(passingTestResult());

    // Quality check returns passing score
    mockCoordinateAgents.mockResolvedValue(successCoordResult());

    const onProgress = vi.fn();
    await runSprints({
      spec: makeSpec({ maxIterationsPerSprint: 3 }),
      provider: mockProvider,
      onProgress,
    });

    // Should have logged a retry message
    const retryCall = onProgress.mock.calls.find((c) => String(c[0]).includes("test failures"));
    expect(retryCall).toBeDefined();
  });

  it("reports iterations count correctly", async () => {
    // Fail once, then pass
    mockRunTests
      .mockResolvedValueOnce(failingTestResult())
      .mockResolvedValue(passingTestResult());
    mockCoordinateAgents.mockResolvedValue(successCoordResult());

    const result = await runSprints({
      spec: makeSpec({ maxIterationsPerSprint: 3 }),
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    const sprintResult = result.sprintResults.find((r) => r.sprintId === "S001");
    expect(sprintResult).toBeDefined();
    expect(sprintResult!.iterations).toBeGreaterThan(1); // At least one retry
  });

  it("stops retrying after maxIterationsPerSprint", async () => {
    // Tests always fail
    mockRunTests.mockResolvedValue(failingTestResult());
    // Quality check still returns something
    mockCoordinateAgents.mockResolvedValue(successCoordResult());

    const result = await runSprints({
      spec: makeSpec({ maxIterationsPerSprint: 2 }),
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    const sprintResult = result.sprintResults.find((r) => r.sprintId === "S001");
    expect(sprintResult).toBeDefined();
    expect(sprintResult!.iterations).toBeLessThanOrEqual(2);
  });

  it("calls onProgress with sprint status messages", async () => {
    mockCoordinateAgents.mockResolvedValue(successCoordResult());
    mockRunTests.mockResolvedValue(passingTestResult());

    const onProgress = vi.fn();
    await runSprints({
      spec: makeSpec(),
      provider: mockProvider,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalled();
    const messages = onProgress.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("S001"))).toBe(true);
  });

  it("handles coordinator errors gracefully", async () => {
    mockCoordinateAgents.mockRejectedValue(new Error("LLM timeout"));
    mockRunTests.mockResolvedValue(passingTestResult());

    const result = await runSprints({
      spec: makeSpec(),
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    // Should still produce a result (not throw)
    expect(result).toBeDefined();
    expect(result.sprintResults.length).toBeGreaterThan(0);
  });

  it("aggregates total test counts across sprints", async () => {
    const spec = makeSpec({
      sprints: [
        {
          id: "S001",
          name: "Sprint 1",
          goal: "g1",
          tasks: [
            {
              id: "T001",
              title: "code",
              description: "d",
              role: "coder",
              dependencies: [],
              acceptanceCriteria: [],
              estimatedTurns: 5,
            },
          ],
        },
        {
          id: "S002",
          name: "Sprint 2",
          goal: "g2",
          tasks: [
            {
              id: "T002",
              title: "code",
              description: "d",
              role: "coder",
              dependencies: [],
              acceptanceCriteria: [],
              estimatedTurns: 5,
            },
          ],
        },
      ],
    });

    mockCoordinateAgents.mockResolvedValue(successCoordResult());
    mockRunTests.mockResolvedValue(passingTestResult()); // 5 tests each sprint

    const result = await runSprints({
      spec,
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    // Fix C3: integration sprint is excluded from totalTests to avoid double-counting.
    // 2 sprints × 5 tests = 10 feature tests (integration not included in totalTests).
    expect(result.totalTests).toBe(10);
  });

  it("excludes integration sprint from totalTests (no double-counting)", async () => {
    mockCoordinateAgents.mockResolvedValue(successCoordResult());
    mockRunTests.mockResolvedValue(passingTestResult()); // 5 tests

    const result = await runSprints({
      spec: makeSpec(), // 1 feature sprint
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    // totalTests must equal only the feature sprint tests, not integration
    // integration sprint is still in sprintResults but excluded from totalTests
    expect(result.totalTests).toBe(5);
    expect(result.sprintResults.find((r) => r.sprintId === "integration")).toBeDefined();
  });

  it("creates improvement tasks when quality is below threshold", async () => {
    // First coordinator call (run tasks): no score in output
    // Second coordinator call (quality check iter 1): returns score 60 → below threshold → improve
    // Third coordinator call (improvement tasks): quality check again → score 90 → pass
    // Integration sprint: use success result
    const lowScoreResult: typeof successCoordResult = () => ({
      results: new Map([
        [
          "S001-quality-1",
          {
            output: "Quality score: 60",
            success: true,
            turns: 3,
            toolsUsed: [],
            duration: 100,
          },
        ],
        [
          "S001-quality-2",
          {
            output: "Quality score: 90",
            success: true,
            turns: 3,
            toolsUsed: [],
            duration: 100,
          },
        ],
        [
          "integration-test",
          { output: "5 passing", success: true, turns: 2, toolsUsed: [], duration: 100 },
        ],
        [
          "integration-review",
          { output: "Quality score: 88", success: true, turns: 2, toolsUsed: [], duration: 100 },
        ],
      ]),
      totalDuration: 300,
      levelsExecuted: 2,
      parallelismAchieved: 1,
    });

    mockRunTests.mockResolvedValue(passingTestResult());

    // Call 1: run sprint tasks → no quality map entry needed
    // Call 2: quality check → score 60
    // Call 3: improvement tasks
    // Call 4: quality check again → score 90
    // Call 5: integration sprint
    mockCoordinateAgents
      .mockResolvedValueOnce({ ...successCoordResult(), results: new Map() }) // sprint tasks
      .mockResolvedValueOnce({
        // quality check 1 → score 60
        results: new Map([
          [
            "S001-quality-1",
            { output: "Quality score: 60", success: true, turns: 3, toolsUsed: [], duration: 100 },
          ],
        ]),
        totalDuration: 100,
        levelsExecuted: 1,
        parallelismAchieved: 1,
      })
      .mockResolvedValueOnce({ ...successCoordResult(), results: new Map() }) // improvement tasks
      .mockResolvedValueOnce({
        // quality check 2 → score 90
        results: new Map([
          [
            "S001-quality-2",
            { output: "Quality score: 90", success: true, turns: 3, toolsUsed: [], duration: 100 },
          ],
        ]),
        totalDuration: 100,
        levelsExecuted: 1,
        parallelismAchieved: 1,
      })
      .mockResolvedValue(lowScoreResult()); // integration sprint

    const onProgress = vi.fn();
    const result = await runSprints({
      spec: makeSpec({ qualityThreshold: 85, maxIterationsPerSprint: 3 }),
      provider: mockProvider,
      onProgress,
    });

    const s001 = result.sprintResults.find((r) => r.sprintId === "S001");
    expect(s001).toBeDefined();
    expect(s001!.iterations).toBeGreaterThan(1);

    // Should have logged an improvement message
    const improvingMsg = onProgress.mock.calls.find((c) => String(c[0]).includes("improving"));
    expect(improvingMsg).toBeDefined();
  });

  it("records qualityScore=0 and does not run quality gate when tests fail on last iteration", async () => {
    // Tests always fail → last iteration → quality gate must not run
    mockRunTests.mockResolvedValue(failingTestResult());
    mockCoordinateAgents.mockResolvedValue(successCoordResult());

    const result = await runSprints({
      spec: makeSpec({ maxIterationsPerSprint: 1 }), // only 1 iteration allowed
      provider: mockProvider,
      onProgress: vi.fn(),
    });

    const s001 = result.sprintResults.find((r) => r.sprintId === "S001");
    expect(s001).toBeDefined();
    expect(s001!.success).toBe(false);
    expect(s001!.qualityScore).toBe(0);
    // errors should mention tests failing
    expect(s001!.errors.some((e) => /failing|test/i.test(e))).toBe(true);
  });
});
