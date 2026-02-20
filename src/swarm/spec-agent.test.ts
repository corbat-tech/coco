/**
 * Tests for spec-agent.ts — runSpecInterview()
 *
 * We mock:
 *  - @clack/prompts  — avoid interactive stdin
 *  - node:fs/promises — avoid writing to the filesystem
 *  - The LLMProvider — return deterministic JSON responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @clack/prompts BEFORE importing the module under test
// ---------------------------------------------------------------------------
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    step: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  text: vi.fn().mockResolvedValue("mocked answer"),
  select: vi.fn().mockResolvedValue("mocked selection"),
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: vi.fn().mockReturnValue(false),
  cancel: vi.fn(),
}));

// Mock fs/promises to avoid disk writes
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

import { runSpecInterview, UserCancelledError } from "./spec-agent.js";
import type { LLMProvider, ChatResponse } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_CLARIFY_RESPONSE = JSON.stringify({
  questions: [
    { question: "What database do you want?", options: ["PostgreSQL", "SQLite"], defaultAnswer: "SQLite" },
  ],
});

const MOCK_BACKLOG_RESPONSE = JSON.stringify({
  projectName: "test-app",
  description: "A test application",
  techStack: ["TypeScript", "Node.js", "Vitest"],
  sprints: [
    {
      id: "S001",
      name: "Sprint 1 — Foundation",
      goal: "Set up project structure and core logic",
      tasks: [
        {
          id: "T001",
          title: "Research and analyze tech stack",
          description: "Research best practices for the chosen stack",
          role: "researcher",
          dependencies: [],
          acceptanceCriteria: ["Stack evaluated", "ADR written"],
          estimatedTurns: 8,
        },
        {
          id: "T002",
          title: "Implement core module",
          description: "Write code for the main module",
          role: "coder",
          dependencies: ["T001"],
          acceptanceCriteria: ["Module exports correct API", "No TypeScript errors"],
          estimatedTurns: 15,
        },
        {
          id: "T003",
          title: "Write tests for core module",
          description: "Achieve >80% coverage",
          role: "tester",
          dependencies: ["T002"],
          acceptanceCriteria: ["Coverage >80%", "All tests pass"],
          estimatedTurns: 10,
        },
      ],
    },
  ],
});

function makeMockProvider(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn().mockImplementation(async (): Promise<ChatResponse> => {
      const content = responses[callIndex] ?? responses[responses.length - 1] ?? "{}";
      callIndex++;
      return { content, usage: { inputTokens: 100, outputTokens: 200 } };
    }),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    getModel: vi.fn().mockReturnValue("mock-model"),
    countTokens: vi.fn().mockResolvedValue(100),
  } as unknown as LLMProvider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSpecInterview", () => {
  it("returns a valid BacklogSpec with at least one sprint", async () => {
    const provider = makeMockProvider([MOCK_CLARIFY_RESPONSE, MOCK_BACKLOG_RESPONSE]);

    const spec = await runSpecInterview(
      "Build a simple REST API",
      provider,
      "/tmp/test-output",
      { skipConfirmation: true },
    );

    expect(spec).toBeDefined();
    expect(spec.sprints.length).toBeGreaterThan(0);
    expect(spec.sprints[0]?.tasks.length).toBeGreaterThan(0);
  });

  it("sets outputPath to the provided value", async () => {
    const provider = makeMockProvider([MOCK_CLARIFY_RESPONSE, MOCK_BACKLOG_RESPONSE]);

    const spec = await runSpecInterview(
      "Build a todo app",
      provider,
      "/tmp/my-todo-app",
      { skipConfirmation: true },
    );

    expect(spec.outputPath).toBe("/tmp/my-todo-app");
  });

  it("uses default qualityThreshold of 85", async () => {
    const provider = makeMockProvider([MOCK_CLARIFY_RESPONSE, MOCK_BACKLOG_RESPONSE]);

    const spec = await runSpecInterview(
      "Simple app",
      provider,
      "/tmp/out",
      { skipConfirmation: true },
    );

    expect(spec.qualityThreshold).toBe(85);
  });

  it("uses default maxIterationsPerSprint of 3", async () => {
    const provider = makeMockProvider([MOCK_CLARIFY_RESPONSE, MOCK_BACKLOG_RESPONSE]);

    const spec = await runSpecInterview(
      "Simple app",
      provider,
      "/tmp/out",
      { skipConfirmation: true },
    );

    expect(spec.maxIterationsPerSprint).toBe(3);
  });

  it("maps task roles to valid SprintTaskRole values", async () => {
    const provider = makeMockProvider([MOCK_CLARIFY_RESPONSE, MOCK_BACKLOG_RESPONSE]);

    const spec = await runSpecInterview(
      "Build something",
      provider,
      "/tmp/out",
      { skipConfirmation: true },
    );

    const validRoles = ["researcher", "coder", "tester", "reviewer", "optimizer"];
    for (const sprint of spec.sprints) {
      for (const task of sprint.tasks) {
        expect(validRoles).toContain(task.role);
      }
    }
  });

  it("falls back gracefully if clarify response is invalid JSON", async () => {
    // First response is garbage, second is valid backlog
    const provider = makeMockProvider(["NOT VALID JSON AT ALL", MOCK_BACKLOG_RESPONSE]);

    const spec = await runSpecInterview(
      "Some description",
      provider,
      "/tmp/out",
      { skipConfirmation: true },
    );

    // Should still produce a spec (clarify questions are skipped on parse error)
    expect(spec.sprints.length).toBeGreaterThan(0);
  });

  it("forces unknown roles to 'coder'", async () => {
    const responseWithBadRole = JSON.stringify({
      projectName: "test",
      description: "test",
      techStack: ["TypeScript"],
      sprints: [
        {
          id: "S001",
          name: "Sprint 1",
          goal: "goal",
          tasks: [
            {
              id: "T001",
              title: "Do something",
              description: "...",
              role: "INVALID_ROLE", // unknown role
              dependencies: [],
              acceptanceCriteria: ["done"],
              estimatedTurns: 5,
            },
          ],
        },
      ],
    });

    const provider = makeMockProvider(["{\"questions\":[]}", responseWithBadRole]);

    const spec = await runSpecInterview(
      "test",
      provider,
      "/tmp/out",
      { skipConfirmation: true },
    );

    expect(spec.sprints[0]?.tasks[0]?.role).toBe("coder");
  });

  it("throws if LLM returns a spec with no sprints", async () => {
    const emptySpecResponse = JSON.stringify({
      projectName: "empty",
      description: "empty",
      techStack: [],
      sprints: [],
    });

    const provider = makeMockProvider(["{\"questions\":[]}", emptySpecResponse]);

    await expect(
      runSpecInterview("test", provider, "/tmp/out", { skipConfirmation: true }),
    ).rejects.toThrow(/no sprints/i);
  });

  it("calls provider.chat twice (clarify + generate)", async () => {
    const provider = makeMockProvider([MOCK_CLARIFY_RESPONSE, MOCK_BACKLOG_RESPONSE]);

    await runSpecInterview(
      "Build an API",
      provider,
      "/tmp/out",
      { skipConfirmation: true },
    );

    expect(provider.chat).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Cancellation path — F1 fix tests
// ---------------------------------------------------------------------------

describe("runSpecInterview — cancellation", () => {
  // Import the mocked clack module to reconfigure per-test
  let clack: typeof import("@clack/prompts");

  beforeEach(async () => {
    clack = await import("@clack/prompts");
    // Default: nothing is cancelled
    vi.mocked(clack.isCancel).mockReturnValue(false);
    vi.mocked(clack.text).mockResolvedValue("some answer");
    vi.mocked(clack.select).mockResolvedValue("some selection");
    vi.mocked(clack.confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws UserCancelledError when user cancels the MVP scope question", async () => {
    // LLM returns no clarifying questions so we go straight to the fixed questions
    const provider = makeMockProvider(["{\"questions\":[]}", MOCK_BACKLOG_RESPONSE]);

    // First p.text call (MVP scope) is cancelled
    vi.mocked(clack.text).mockResolvedValueOnce(Symbol("cancel") as unknown as string);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true); // first isCancel check → true

    await expect(
      runSpecInterview("test app", provider, "/tmp/out", { skipConfirmation: true }),
    ).rejects.toThrow(UserCancelledError);
  });

  it("throws UserCancelledError when user cancels the integrations question", async () => {
    const provider = makeMockProvider(["{\"questions\":[]}", MOCK_BACKLOG_RESPONSE]);

    // MVP scope passes, integrations question is cancelled
    vi.mocked(clack.text)
      .mockResolvedValueOnce("user can log in") // MVP answer (not cancelled)
      .mockResolvedValueOnce(Symbol("cancel") as unknown as string); // integrations (cancelled)
    vi.mocked(clack.isCancel)
      .mockReturnValueOnce(false) // MVP check → not cancelled
      .mockReturnValueOnce(true); // integrations check → cancelled

    await expect(
      runSpecInterview("test app", provider, "/tmp/out", { skipConfirmation: true }),
    ).rejects.toThrow(UserCancelledError);
  });

  it("throws UserCancelledError when user declines the confirmation prompt", async () => {
    const provider = makeMockProvider(["{\"questions\":[]}", MOCK_BACKLOG_RESPONSE]);

    // All text prompts pass, but confirm returns a cancel symbol
    vi.mocked(clack.text).mockResolvedValue("some answer");
    vi.mocked(clack.isCancel)
      .mockReturnValueOnce(false) // MVP
      .mockReturnValueOnce(false) // integrations
      .mockReturnValueOnce(true); // confirm → cancelled

    await expect(
      runSpecInterview("test app", provider, "/tmp/out", { skipConfirmation: false }),
    ).rejects.toThrow(UserCancelledError);
  });

  it("does NOT call process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit should not be called");
    });

    const provider = makeMockProvider(["{\"questions\":[]}", MOCK_BACKLOG_RESPONSE]);
    vi.mocked(clack.text).mockResolvedValueOnce(Symbol("cancel") as unknown as string);
    vi.mocked(clack.isCancel).mockReturnValueOnce(true);

    // Should throw UserCancelledError, NOT call process.exit
    await expect(
      runSpecInterview("test", provider, "/tmp/out", { skipConfirmation: true }),
    ).rejects.toThrow(UserCancelledError);

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
