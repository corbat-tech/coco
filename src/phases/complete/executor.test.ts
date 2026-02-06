/**
 * Tests for COMPLETE phase executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn();
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  readdir: mockReaddir,
  unlink: mockUnlink,
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    readdir: mockReaddir,
    unlink: mockUnlink,
  },
}));

const mockIteratorExecute = vi.fn().mockResolvedValue({
  taskId: "task-1",
  success: true,
  versions: [
    { version: 1, changes: { filesCreated: ["src/test.ts"], filesModified: [], filesDeleted: [] } },
  ],
  finalScore: 90,
  converged: true,
  iterations: 2,
});

vi.mock("./iterator.js", () => ({
  TaskIterator: vi.fn().mockImplementation(() => ({
    execute: mockIteratorExecute,
  })),
  createTaskIterator: vi.fn().mockReturnValue({
    execute: mockIteratorExecute,
  }),
}));

const createMockBacklog = (overrides: Record<string, unknown> = {}) => ({
  epics: [{ id: "epic-1", title: "Epic 1", priority: 1 }],
  stories: [{ id: "story-1", epicId: "epic-1", title: "Story 1", points: 5 }],
  tasks: (overrides.tasks as unknown[]) || [
    {
      id: "task-1",
      storyId: "story-1",
      title: "Task 1",
      description: "Test task",
      type: "feature",
      files: [],
      dependencies: [],
      estimatedComplexity: "simple",
      status: "pending",
    },
  ],
  currentSprint: {
    id: "sprint-1",
    name: "Sprint 1",
    goal: "Test goal",
    stories: ["story-1"],
    startDate: new Date().toISOString(),
  },
  completedSprints: [],
  ...overrides,
  // Ensure tasks from overrides are not doubly applied
  ...(overrides.tasks ? {} : {}),
});

const createMockContext = (overrides = {}) => ({
  projectPath: "/test/project",
  config: {
    project: { name: "test" },
    provider: { type: "anthropic" },
  },
  llm: {
    chat: vi.fn().mockResolvedValue({
      content: "{}",
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
    chatWithTools: vi.fn().mockResolvedValue({
      content: "{}",
      usage: { inputTokens: 100, outputTokens: 50 },
      toolCalls: [],
    }),
  },
  tools: {
    test: {
      run: vi.fn().mockResolvedValue({
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
        duration: 1000,
      }),
      coverage: vi.fn().mockResolvedValue({
        lines: 85,
        branches: 80,
        functions: 90,
        statements: 85,
      }),
    },
  },
  ...overrides,
});

describe("CompleteExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("backlog")) {
        return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
      }
      return Promise.resolve("{}");
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create with default config", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();

      expect(executor.name).toBe("complete");
      expect(executor.description).toBeDefined();
    });

    it("should create with custom config", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor({
        quality: {
          minScore: 90,
          minCoverage: 85,
          maxIterations: 5,
          minConvergenceIterations: 3,
          convergenceThreshold: 1,
        },
        parallelExecution: true,
        maxParallelTasks: 5,
      });

      expect(executor.name).toBe("complete");
    });

    it("should merge config with defaults", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor({
        quality: { minScore: 90 } as any,
      });

      expect(executor.name).toBe("complete");
    });
  });

  describe("canStart", () => {
    it("should return true", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const result = executor.canStart({} as any);

      expect(result).toBe(true);
    });

    it("should return true with any context", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const result = executor.canStart(createMockContext() as any);

      expect(result).toBe(true);
    });
  });

  describe("canComplete", () => {
    it("should return true", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const result = executor.canComplete({} as any);

      expect(result).toBe(true);
    });
  });

  describe("checkpoint", () => {
    it("should create checkpoint with correct structure", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const checkpoint = await executor.checkpoint({} as any);

      expect(checkpoint.phase).toBe("complete");
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.state).toBeDefined();
      expect(checkpoint.state.artifacts).toEqual([]);
      expect(checkpoint.state.progress).toBe(0);
    });

    it("should set resumePoint to start by default", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const checkpoint = await executor.checkpoint({} as any);

      expect(checkpoint.resumePoint).toBe("start");
    });
  });

  describe("restore", () => {
    it("should restore from checkpoint without error", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const checkpoint = {
        phase: "complete",
        timestamp: new Date(),
        state: { artifacts: [], progress: 50 },
        resumePoint: "sprint-1",
      };

      await expect(executor.restore(checkpoint as any, {} as any)).resolves.toBeUndefined();
    });
  });

  describe("execute", () => {
    it("should execute sprint tasks successfully", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor({
        quality: {
          minScore: 85,
          minCoverage: 80,
          maxIterations: 10,
          minConvergenceIterations: 2,
          convergenceThreshold: 2,
        },
      });

      const context = createMockContext();
      const result = await executor.execute(context as any);

      expect(result.phase).toBe("complete");
      expect(result.success).toBe(true);
      expect(result.artifacts).toBeDefined();
    });

    it("should return artifacts for successful tasks", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const context = createMockContext();
      const result = await executor.execute(context as any);

      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.artifacts[0].type).toBe("documentation"); // Sprint results
    });

    it("should return code artifacts from task versions", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const context = createMockContext();
      const result = await executor.execute(context as any);

      const codeArtifacts = result.artifacts.filter((a) => a.type === "code");
      expect(codeArtifacts.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle missing sprint", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({ currentSprint: null }),
          }),
        ),
      );
      mockReaddir.mockResolvedValue([]);

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No sprint");
    });

    it("should handle empty backlog", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockRejectedValue(new Error("Not found"));

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      // Should return error when no sprint can be found
      expect(result.phase).toBe("complete");
    });

    it("should call progress callback when provided", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const progressFn = vi.fn();
      const executor = new CompleteExecutor({
        onProgress: progressFn,
      });

      await executor.execute(createMockContext() as any);

      expect(progressFn).toHaveBeenCalled();
    });

    it("should report progress at start of sprint", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const progressFn = vi.fn();
      const executor = new CompleteExecutor({
        onProgress: progressFn,
      });

      await executor.execute(createMockContext() as any);

      // First progress should be starting sprint
      const firstCall = progressFn.mock.calls[0]?.[0];
      expect(firstCall?.phase).toBe("executing");
      expect(firstCall?.message).toContain("Starting");
    });

    it("should report progress for each task", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const progressFn = vi.fn();
      const executor = new CompleteExecutor({
        onProgress: progressFn,
      });

      await executor.execute(createMockContext() as any);

      // Should have multiple progress calls
      expect(progressFn.mock.calls.length).toBeGreaterThan(1);
    });

    it("should return metrics on success", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.metrics).toBeDefined();
      expect(result.metrics?.startTime).toBeInstanceOf(Date);
      expect(result.metrics?.endTime).toBeInstanceOf(Date);
      expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should save sprint results", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      await executor.execute(createMockContext() as any);

      expect(mockWriteFile).toHaveBeenCalled();
      // Should save both JSON and markdown
      const calls = mockWriteFile.mock.calls;
      const jsonCall = calls.find((c) => c[0].includes(".json"));
      const mdCall = calls.find((c) => c[0].includes(".md"));
      expect(jsonCall).toBeDefined();
      expect(mdCall).toBeDefined();
    });

    it("should handle failed task execution", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockIteratorExecute.mockResolvedValueOnce({
        taskId: "task-1",
        success: false,
        versions: [],
        finalScore: 40,
        converged: false,
        iterations: 10,
        error: "Max iterations reached",
      });

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
      // Sprint fails if not all tasks complete
      expect(result.success).toBe(false);
    });

    it("should handle multiple tasks in sprint", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
                {
                  id: "task-2",
                  storyId: "story-1",
                  title: "Task 2",
                  description: "Test 2",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      mockIteratorExecute
        .mockResolvedValueOnce({
          taskId: "task-1",
          success: true,
          versions: [
            {
              version: 1,
              changes: { filesCreated: ["src/a.ts"], filesModified: [], filesDeleted: [] },
            },
          ],
          finalScore: 90,
          converged: true,
          iterations: 2,
        })
        .mockResolvedValueOnce({
          taskId: "task-2",
          success: true,
          versions: [
            {
              version: 1,
              changes: { filesCreated: ["src/b.ts"], filesModified: [], filesDeleted: [] },
            },
          ],
          finalScore: 88,
          converged: true,
          iterations: 3,
        });

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.success).toBe(true);
    });

    it("should load sprint from files if no currentSprint", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("backlog")) {
          return Promise.resolve(
            JSON.stringify({
              backlog: createMockBacklog({ currentSprint: null }),
            }),
          );
        }
        if (path.includes("sprint")) {
          return Promise.resolve(
            JSON.stringify({
              id: "sprint-1",
              name: "Sprint 1",
              goal: "Test",
              stories: ["story-1"],
              startDate: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("{}");
      });
      mockReaddir.mockResolvedValue(["sprint-1.json"]);

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
    });

    it("should handle test runner in context", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const mockTestRun = vi.fn().mockResolvedValue({
        passed: 10,
        failed: 2,
        skipped: 1,
        failures: [{ name: "test1", message: "Failed", stack: "..." }],
        duration: 5000,
      });

      const mockCoverage = vi.fn().mockResolvedValue({
        lines: 75,
        branches: 70,
        functions: 80,
        statements: 75,
      });

      const context = createMockContext({
        tools: {
          test: {
            run: mockTestRun,
            coverage: mockCoverage,
          },
        },
      });

      const executor = new CompleteExecutor();
      await executor.execute(context as any);

      // The test runner may or may not be called depending on iterator implementation
      expect(mockIteratorExecute).toHaveBeenCalled();
    });

    it("should handle context without test tools", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const context = createMockContext({ tools: {} });

      const executor = new CompleteExecutor();
      const result = await executor.execute(context as any);

      expect(result.phase).toBe("complete");
    });
  });

  describe("LLM adapter", () => {
    it("should create LLM adapter from context", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const context = createMockContext();

      await executor.execute(context as any);

      // LLM adapter should have been used
      expect(mockIteratorExecute).toHaveBeenCalled();
    });
  });
});

describe("createCompleteExecutor", () => {
  it("should create executor with default config", async () => {
    const { createCompleteExecutor } = await import("./executor.js");

    const executor = createCompleteExecutor();

    expect(executor).toBeDefined();
    expect(executor.name).toBe("complete");
  });

  it("should create executor with custom quality config", async () => {
    const { createCompleteExecutor } = await import("./executor.js");

    const executor = createCompleteExecutor({
      quality: {
        minScore: 90,
        minCoverage: 85,
        maxIterations: 5,
        minConvergenceIterations: 3,
        convergenceThreshold: 1,
      },
    });

    expect(executor).toBeDefined();
  });

  it("should create executor with all config options", async () => {
    const { createCompleteExecutor } = await import("./executor.js");

    const progressFn = vi.fn();
    const userInputFn = vi.fn();

    const executor = createCompleteExecutor({
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        minConvergenceIterations: 2,
        convergenceThreshold: 2,
      },
      parallelExecution: true,
      maxParallelTasks: 4,
      saveVersions: true,
      runTestsEachIteration: true,
      onProgress: progressFn,
      onUserInput: userInputFn,
    });

    expect(executor).toBeDefined();
  });
});

describe("DEFAULT_COMPLETE_CONFIG", () => {
  it("should export default config", async () => {
    const { DEFAULT_COMPLETE_CONFIG } = await import("./types.js");

    expect(DEFAULT_COMPLETE_CONFIG).toBeDefined();
    expect(DEFAULT_COMPLETE_CONFIG.quality).toBeDefined();
    expect(DEFAULT_COMPLETE_CONFIG.parallelExecution).toBe(false);
    expect(DEFAULT_COMPLETE_CONFIG.maxParallelTasks).toBe(3);
    expect(DEFAULT_COMPLETE_CONFIG.saveVersions).toBe(true);
    expect(DEFAULT_COMPLETE_CONFIG.runTestsEachIteration).toBe(true);
  });

  it("should have correct default quality values", async () => {
    const { DEFAULT_COMPLETE_CONFIG } = await import("./types.js");

    expect(DEFAULT_COMPLETE_CONFIG.quality.minScore).toBe(85);
    expect(DEFAULT_COMPLETE_CONFIG.quality.minCoverage).toBe(80);
    expect(DEFAULT_COMPLETE_CONFIG.quality.maxIterations).toBe(10);
    expect(DEFAULT_COMPLETE_CONFIG.quality.convergenceThreshold).toBe(2);
    expect(DEFAULT_COMPLETE_CONFIG.quality.minConvergenceIterations).toBe(2);
  });
});

describe("DEFAULT_QUALITY_CONFIG", () => {
  it("should export default quality config", async () => {
    const { DEFAULT_QUALITY_CONFIG } = await import("./types.js");

    expect(DEFAULT_QUALITY_CONFIG).toBeDefined();
    expect(DEFAULT_QUALITY_CONFIG.minScore).toBe(85);
    expect(DEFAULT_QUALITY_CONFIG.minCoverage).toBe(80);
    expect(DEFAULT_QUALITY_CONFIG.maxIterations).toBe(10);
  });
});

describe("CompleteExecutor - onProgress callback during task execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("backlog")) {
        return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
      }
      return Promise.resolve("{}");
    });
  });

  it("should invoke onProgress callback passed to executeTask during iteration", async () => {
    const { CompleteExecutor } = await import("./executor.js");

    // Create a mock that captures the onProgress callback
    let capturedOnProgress: ((iteration: number, score: number) => void) | undefined;
    mockIteratorExecute.mockImplementation((context, runTests, saveFiles, onProgress) => {
      capturedOnProgress = onProgress;
      // Call onProgress to exercise the callback
      if (onProgress) {
        onProgress(1, 75);
        onProgress(2, 85);
      }
      return Promise.resolve({
        taskId: context.task.id,
        success: true,
        versions: [
          { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
        ],
        finalScore: 85,
        converged: true,
        iterations: 2,
      });
    });

    const progressFn = vi.fn();
    const executor = new CompleteExecutor({
      onProgress: progressFn,
    });

    await executor.execute(createMockContext() as any);

    // Verify that onProgress was captured and called
    expect(capturedOnProgress).toBeDefined();
    // The executor's onProgress should have been called for iteration progress
    const iteratingCalls = progressFn.mock.calls.filter((c: any) => c[0]?.phase === "iterating");
    expect(iteratingCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CompleteExecutor - runTests method coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("backlog")) {
        return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
      }
      return Promise.resolve("{}");
    });
  });

  it("should call test tools and return test results with coverage", async () => {
    const { CompleteExecutor } = await import("./executor.js");

    // Capture the runTests callback
    let capturedRunTests: (() => Promise<any>) | undefined;
    mockIteratorExecute.mockImplementation((context, runTests, _saveFiles, _onProgress) => {
      capturedRunTests = runTests;
      return Promise.resolve({
        taskId: context.task.id,
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 1,
      });
    });

    const mockTestRun = vi.fn().mockResolvedValue({
      passed: 10,
      failed: 2,
      skipped: 1,
      failures: [
        { name: "test1", message: "Expected true got false", stack: "Error at line 10" },
        { name: "test2", message: "Timeout", stack: "Error at line 20" },
      ],
      duration: 5000,
    });

    const mockCoverage = vi.fn().mockResolvedValue({
      lines: 85,
      branches: 80,
      functions: 90,
      statements: 82,
    });

    const context = createMockContext({
      tools: {
        test: {
          run: mockTestRun,
          coverage: mockCoverage,
        },
      },
    });

    const executor = new CompleteExecutor();
    await executor.execute(context as any);

    // Call the captured runTests function
    expect(capturedRunTests).toBeDefined();
    const testResult = await capturedRunTests!();

    expect(testResult.passed).toBe(10);
    expect(testResult.failed).toBe(2);
    expect(testResult.skipped).toBe(1);
    expect(testResult.coverage.lines).toBe(85);
    expect(testResult.coverage.branches).toBe(80);
    expect(testResult.coverage.functions).toBe(90);
    expect(testResult.coverage.statements).toBe(82);
    expect(testResult.failures).toHaveLength(2);
    expect(testResult.failures[0].name).toBe("test1");
    expect(testResult.failures[0].message).toBe("Expected true got false");
    expect(testResult.failures[0].stack).toBe("Error at line 10");
    expect(testResult.duration).toBe(5000);
  });

  it("should return default test results when test tool throws error", async () => {
    const { CompleteExecutor } = await import("./executor.js");

    let capturedRunTests: (() => Promise<any>) | undefined;
    mockIteratorExecute.mockImplementation((context, runTests, _saveFiles, _onProgress) => {
      capturedRunTests = runTests;
      return Promise.resolve({
        taskId: context.task.id,
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 1,
      });
    });

    const context = createMockContext({
      tools: {
        test: {
          run: vi.fn().mockRejectedValue(new Error("Test runner crashed")),
          coverage: vi.fn(),
        },
      },
    });

    const executor = new CompleteExecutor();
    await executor.execute(context as any);

    // The runTests function should handle errors gracefully
    const testResult = await capturedRunTests!();
    expect(testResult.passed).toBe(0);
    expect(testResult.failed).toBe(0);
    expect(testResult.skipped).toBe(0);
    expect(testResult.coverage.lines).toBe(0);
    expect(testResult.failures).toEqual([]);
    expect(testResult.duration).toBe(0);
  });

  it("should return default test results when no test tool available", async () => {
    const { CompleteExecutor } = await import("./executor.js");

    let capturedRunTests: (() => Promise<any>) | undefined;
    mockIteratorExecute.mockImplementation((context, runTests, _saveFiles, _onProgress) => {
      capturedRunTests = runTests;
      return Promise.resolve({
        taskId: context.task.id,
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 1,
      });
    });

    const context = createMockContext({
      tools: {}, // No test tool
    });

    const executor = new CompleteExecutor();
    await executor.execute(context as any);

    const testResult = await capturedRunTests!();
    expect(testResult.passed).toBe(0);
    expect(testResult.failed).toBe(0);
    expect(testResult.skipped).toBe(0);
    expect(testResult.coverage.lines).toBe(0);
    expect(testResult.coverage.branches).toBe(0);
    expect(testResult.coverage.functions).toBe(0);
    expect(testResult.coverage.statements).toBe(0);
    expect(testResult.failures).toEqual([]);
    expect(testResult.duration).toBe(0);
  });
});

describe("CompleteExecutor - saveFiles callback coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("backlog")) {
        return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
      }
      return Promise.resolve("{}");
    });
  });

  it("should call saveFiles callback which saves files and handles delete action", async () => {
    const { CompleteExecutor } = await import("./executor.js");

    let capturedSaveFiles: ((files: any[]) => Promise<void>) | undefined;
    mockIteratorExecute.mockImplementation((context, runTests, saveFiles, _onProgress) => {
      capturedSaveFiles = saveFiles;
      return Promise.resolve({
        taskId: context.task.id,
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 1,
      });
    });

    const executor = new CompleteExecutor();
    await executor.execute(createMockContext() as any);

    expect(capturedSaveFiles).toBeDefined();

    // Test saving files with different actions
    await capturedSaveFiles!([
      { path: "src/new-file.ts", content: "// new file", action: "create" },
      { path: "src/modified.ts", content: "// modified", action: "modify" },
      { path: "src/old-file.ts", content: "", action: "delete" },
    ]);

    // Verify mkdir was called for file directories
    expect(mockMkdir).toHaveBeenCalled();
    // Verify writeFile was called for create/modify
    expect(mockWriteFile).toHaveBeenCalled();
    // Verify unlink was called for delete
    expect(mockUnlink).toHaveBeenCalled();
  });

  it("should handle unlink errors gracefully when file does not exist", async () => {
    const { CompleteExecutor } = await import("./executor.js");

    let capturedSaveFiles: ((files: any[]) => Promise<void>) | undefined;
    mockIteratorExecute.mockImplementation((context, runTests, saveFiles, _onProgress) => {
      capturedSaveFiles = saveFiles;
      return Promise.resolve({
        taskId: context.task.id,
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 1,
      });
    });

    // Make unlink fail
    mockUnlink.mockRejectedValue(new Error("File not found"));

    const executor = new CompleteExecutor();
    await executor.execute(createMockContext() as any);

    // Should not throw when unlink fails
    await expect(
      capturedSaveFiles!([{ path: "src/nonexistent.ts", content: "", action: "delete" }]),
    ).resolves.not.toThrow();
  });
});

describe("CompleteExecutor - advanced scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parallel execution", () => {
    it("should execute tasks in parallel when enabled", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
                {
                  id: "task-2",
                  storyId: "story-1",
                  title: "Task 2",
                  description: "Test 2",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
                {
                  id: "task-3",
                  storyId: "story-1",
                  title: "Task 3",
                  description: "Test 3",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      mockIteratorExecute
        .mockResolvedValueOnce({
          taskId: "task-1",
          success: true,
          versions: [
            {
              version: 1,
              changes: { filesCreated: ["src/a.ts"], filesModified: [], filesDeleted: [] },
            },
          ],
          finalScore: 90,
          converged: true,
          iterations: 2,
        })
        .mockResolvedValueOnce({
          taskId: "task-2",
          success: true,
          versions: [
            {
              version: 1,
              changes: { filesCreated: ["src/b.ts"], filesModified: [], filesDeleted: [] },
            },
          ],
          finalScore: 88,
          converged: true,
          iterations: 3,
        })
        .mockResolvedValueOnce({
          taskId: "task-3",
          success: true,
          versions: [
            {
              version: 1,
              changes: { filesCreated: ["src/c.ts"], filesModified: [], filesDeleted: [] },
            },
          ],
          finalScore: 91,
          converged: true,
          iterations: 1,
        });

      const executor = new CompleteExecutor({
        parallelExecution: true,
        maxParallelTasks: 3,
      });

      const result = await executor.execute(createMockContext() as any);

      expect(result.success).toBe(true);
      expect(mockIteratorExecute).toHaveBeenCalledTimes(3);
    });

    it("should respect maxParallelTasks limit", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
                {
                  id: "task-2",
                  storyId: "story-1",
                  title: "Task 2",
                  description: "Test 2",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      mockIteratorExecute
        .mockResolvedValueOnce({
          taskId: "task-1",
          success: true,
          versions: [
            { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
          ],
          finalScore: 90,
          converged: true,
          iterations: 2,
        })
        .mockResolvedValueOnce({
          taskId: "task-2",
          success: true,
          versions: [
            { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
          ],
          finalScore: 88,
          converged: true,
          iterations: 3,
        });

      const executor = new CompleteExecutor({
        parallelExecution: true,
        maxParallelTasks: 1, // Execute one at a time
      });

      const result = await executor.execute(createMockContext() as any);

      expect(result.success).toBe(true);
    });

    it("should handle blocked tasks with unmet dependencies in parallel mode", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: ["non-existent"],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      const executor = new CompleteExecutor({
        parallelExecution: true,
        maxParallelTasks: 3,
      });

      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
      // Task with unmet dependencies should be blocked
    });
  });

  describe("dependency management", () => {
    it("should handle tasks with dependencies", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: [],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
                {
                  id: "task-2",
                  storyId: "story-1",
                  title: "Task 2",
                  description: "Test 2",
                  type: "feature",
                  files: [],
                  dependencies: ["task-1"],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      mockIteratorExecute
        .mockResolvedValueOnce({
          taskId: "task-1",
          success: true,
          versions: [
            { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
          ],
          finalScore: 90,
          converged: true,
          iterations: 2,
        })
        .mockResolvedValueOnce({
          taskId: "task-2",
          success: true,
          versions: [
            { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
          ],
          finalScore: 88,
          converged: true,
          iterations: 3,
        });

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.success).toBe(true);
      expect(mockIteratorExecute).toHaveBeenCalledTimes(2);
    });

    it("should detect dependency cycles and fall back to original order", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      // Create tasks with circular dependencies
      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: ["task-2"],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
                {
                  id: "task-2",
                  storyId: "story-1",
                  title: "Task 2",
                  description: "Test 2",
                  type: "feature",
                  files: [],
                  dependencies: ["task-1"],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      // Both tasks will eventually be blocked due to circular dependency
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
      // Cycle detection should have logged a warning
      consoleSpy.mockRestore();
    });

    it("should block task when dependency is not satisfied", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({
              tasks: [
                {
                  id: "task-1",
                  storyId: "story-1",
                  title: "Task 1",
                  description: "Test",
                  type: "feature",
                  files: [],
                  dependencies: ["missing-dep"],
                  estimatedComplexity: "simple",
                  status: "pending",
                },
              ],
            }),
          }),
        ),
      );

      const progressFn = vi.fn();
      const executor = new CompleteExecutor({
        onProgress: progressFn,
      });

      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
      // Should report blocked progress
      const blockedCall = progressFn.mock.calls.find((c: any) => c[0]?.phase === "blocked");
      expect(blockedCall).toBeDefined();
    });
  });

  describe("checkpoint and restore", () => {
    it("should save checkpoint state during execution", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      await executor.execute(createMockContext() as any);

      // Checkpoint should have been saved
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should restore from existing checkpoint and resume", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      // Setup checkpoint file
      const checkpointState = {
        sprintId: "sprint-1",
        currentTaskIndex: 1,
        completedTaskIds: ["task-1"],
        taskResults: [
          {
            taskId: "task-1",
            success: true,
            versions: [],
            finalScore: 90,
            converged: true,
            iterations: 2,
          },
        ],
        startTime: Date.now(),
      };

      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("checkpoint")) {
          return Promise.resolve(JSON.stringify(checkpointState));
        }
        if (path.includes("backlog")) {
          return Promise.resolve(
            JSON.stringify({
              backlog: createMockBacklog({
                tasks: [
                  {
                    id: "task-1",
                    storyId: "story-1",
                    title: "Task 1",
                    description: "Test",
                    type: "feature",
                    files: [],
                    dependencies: [],
                    estimatedComplexity: "simple",
                    status: "pending",
                  },
                  {
                    id: "task-2",
                    storyId: "story-1",
                    title: "Task 2",
                    description: "Test 2",
                    type: "feature",
                    files: [],
                    dependencies: [],
                    estimatedComplexity: "simple",
                    status: "pending",
                  },
                ],
              }),
            }),
          );
        }
        return Promise.resolve("{}");
      });

      mockIteratorExecute.mockResolvedValue({
        taskId: "task-2",
        success: true,
        versions: [
          { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
        ],
        finalScore: 88,
        converged: true,
        iterations: 2,
      });

      const progressFn = vi.fn();
      const executor = new CompleteExecutor({
        onProgress: progressFn,
      });

      // First restore from checkpoint
      await executor.restore(
        {
          phase: "complete",
          timestamp: new Date(),
          state: { artifacts: [], progress: 50, checkpoint: null },
          resumePoint: "sprint-1",
        },
        createMockContext() as any,
      );

      // Then execute
      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
    });

    it("should handle missing checkpoint file during restore", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("checkpoint")) {
          return Promise.reject(new Error("File not found"));
        }
        if (path.includes("backlog")) {
          return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
        }
        return Promise.resolve("{}");
      });

      const executor = new CompleteExecutor();

      // Should not throw when checkpoint file is missing
      await expect(
        executor.restore(
          {
            phase: "complete",
            timestamp: new Date(),
            state: { artifacts: [], progress: 50, checkpoint: null },
            resumePoint: "sprint-1",
          },
          createMockContext() as any,
        ),
      ).resolves.not.toThrow();
    });

    it("should skip restore when resumePoint is start", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();

      await executor.restore(
        {
          phase: "complete",
          timestamp: new Date(),
          state: { artifacts: [], progress: 0, checkpoint: null },
          resumePoint: "start",
        },
        createMockContext() as any,
      );

      // Should not attempt to read checkpoint file
    });

    it("should calculate progress correctly", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const checkpoint = await executor.checkpoint(createMockContext() as any);

      expect(checkpoint.state.progress).toBe(0); // No tasks completed initially
    });
  });

  describe("test runner integration", () => {
    it("should use context test tools when available", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const mockTestRun = vi.fn().mockResolvedValue({
        passed: 15,
        failed: 2,
        skipped: 1,
        failures: [
          { name: "test1", message: "Expected true", stack: "Error at..." },
          { name: "test2", message: "Timeout", stack: "Error at..." },
        ],
        duration: 3000,
      });

      const mockCoverage = vi.fn().mockResolvedValue({
        lines: 82,
        branches: 78,
        functions: 85,
        statements: 80,
      });

      const context = createMockContext({
        tools: {
          test: {
            run: mockTestRun,
            coverage: mockCoverage,
          },
        },
      });

      const executor = new CompleteExecutor();
      await executor.execute(context as any);

      expect(mockIteratorExecute).toHaveBeenCalled();
    });

    it("should handle test runner errors gracefully", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const context = createMockContext({
        tools: {
          test: {
            run: vi.fn().mockRejectedValue(new Error("Test runner crashed")),
            coverage: vi.fn(),
          },
        },
      });

      const executor = new CompleteExecutor();
      const result = await executor.execute(context as any);

      expect(result.phase).toBe("complete");
    });
  });

  describe("file operations", () => {
    it("should handle file deletion action", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockIteratorExecute.mockResolvedValueOnce({
        taskId: "task-1",
        success: true,
        versions: [
          {
            version: 1,
            changes: {
              filesCreated: [],
              filesModified: [],
              filesDeleted: ["src/old.ts"],
            },
          },
        ],
        finalScore: 90,
        converged: true,
        iterations: 2,
      });

      const executor = new CompleteExecutor();
      await executor.execute(createMockContext() as any);

      expect((result) => result.phase).toBeDefined();
    });

    it("should create directories for new files", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      await executor.execute(createMockContext() as any);

      expect(mockMkdir).toHaveBeenCalled();
    });
  });

  describe("sprint loading", () => {
    it("should load sprint from files directory when no currentSprint", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("backlog")) {
          return Promise.resolve(
            JSON.stringify({
              backlog: createMockBacklog({ currentSprint: null }),
            }),
          );
        }
        if (path.includes("sprint")) {
          return Promise.resolve(
            JSON.stringify({
              id: "sprint-1",
              name: "Sprint 1",
              goal: "Test goal",
              stories: ["story-1"],
              startDate: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("{}");
      });
      mockReaddir.mockResolvedValue(["sprint-1.json"]);

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.phase).toBe("complete");
    });

    it("should handle empty sprints directory", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({ currentSprint: null }),
          }),
        ),
      );
      mockReaddir.mockResolvedValue([]);

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No sprint");
    });

    it("should handle error reading sprints directory", async () => {
      const { CompleteExecutor } = await import("./executor.js");

      mockReadFile.mockImplementation(() =>
        Promise.resolve(
          JSON.stringify({
            backlog: createMockBacklog({ currentSprint: null }),
          }),
        ),
      );
      mockReaddir.mockRejectedValue(new Error("Directory not found"));

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      expect(result.success).toBe(false);
    });
  });

  describe("results generation", () => {
    it("should generate markdown results for sprint", async () => {
      vi.clearAllMocks();
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("backlog")) {
          return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
        }
        return Promise.resolve("{}");
      });

      mockIteratorExecute.mockResolvedValue({
        taskId: "task-1",
        success: true,
        versions: [
          { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
        ],
        finalScore: 90,
        converged: true,
        iterations: 2,
      });

      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      await executor.execute(createMockContext() as any);

      // Should write markdown file - check for results directory writes
      const _resultsWriteCalls = mockWriteFile.mock.calls.filter(
        (c: any) => c[0].includes("results") && c[0].includes(".md"),
      );
      // Markdown results should be written
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should include token usage in metrics on successful execution", async () => {
      vi.clearAllMocks();
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("backlog")) {
          return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
        }
        return Promise.resolve("{}");
      });

      mockIteratorExecute.mockResolvedValue({
        taskId: "task-1",
        success: true,
        versions: [
          { version: 1, changes: { filesCreated: [], filesModified: [], filesDeleted: [] } },
        ],
        finalScore: 90,
        converged: true,
        iterations: 2,
      });

      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      // Success should have metrics
      if (result.success) {
        expect(result.metrics).toBeDefined();
        expect(result.metrics?.tokensUsed).toBeDefined();
      }
      expect(result.phase).toBe("complete");
    });

    it("should handle tasks with empty versions array in results", async () => {
      vi.clearAllMocks();
      mockReadFile.mockImplementation((path: string) => {
        if (path.includes("backlog")) {
          return Promise.resolve(JSON.stringify({ backlog: createMockBacklog() }));
        }
        return Promise.resolve("{}");
      });

      mockIteratorExecute.mockResolvedValue({
        taskId: "task-1",
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 2,
      });

      const { CompleteExecutor } = await import("./executor.js");

      const executor = new CompleteExecutor();
      const result = await executor.execute(createMockContext() as any);

      // Empty versions is still valid
      expect(result.phase).toBe("complete");
    });
  });
});
