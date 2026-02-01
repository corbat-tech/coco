/**
 * Tests for backlog generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BacklogGenerator,
  createBacklogGenerator,
  generateBacklogMarkdown,
  generateSprintMarkdown,
} from "./backlog.js";
import type { OrchestrateConfig } from "./types.js";
import type { Backlog, Sprint } from "../../types/task.js";
import type { LLMProvider, ChatResponse } from "../../providers/types.js";

// Helper to create mock LLM
function createMockLLM(responseContent: string): LLMProvider {
  return {
    async initialize() {},
    async chat(): Promise<ChatResponse> {
      return {
        content: responseContent,
        role: "assistant",
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      };
    },
    async chatWithTools() {
      return {
        content: responseContent,
        role: "assistant" as const,
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      };
    },
  };
}

// Minimal config for tests
const mockConfig: OrchestrateConfig = {
  breakdownStrategy: "vertical",
  maxEpics: 10,
  maxStoriesPerEpic: 5,
  maxTasksPerStory: 10,
  maxADRs: 5,
  sprint: {
    sprintDuration: 14,
    targetVelocity: 20,
    maxStoriesPerSprint: 5,
    bufferPercentage: 20,
  },
};

// Minimal architecture for tests
const mockArchitecture = {
  overview: {
    pattern: "layered" as const,
    layers: ["ui", "api", "data"],
    qualityAttributes: [],
    keyDecisions: [],
  },
  components: [
    {
      name: "UserService",
      type: "service" as const,
      layer: "api",
      responsibilities: ["user management"],
      interfaces: [],
      dependencies: [],
    },
  ],
  dataModels: [
    {
      name: "User",
      description: "User model",
      fields: [],
      relationships: [],
    },
  ],
  integrations: [],
  diagrams: [],
};

// Minimal specification for tests
const mockSpecification = {
  projectName: "test-project",
  overview: {
    type: "api" as const,
    summary: "Test project",
    goals: ["Test goal"],
    nonGoals: [],
    successCriteria: [],
  },
  requirements: {
    functional: [
      {
        id: "req-1",
        title: "User Registration",
        description: "Users can register",
        priority: "must-have" as const,
        acceptance: [],
      },
    ],
    nonFunctional: [
      {
        id: "nfr-1",
        title: "Performance",
        category: "performance" as const,
        specification: "Response time < 200ms",
      },
    ],
  },
  technical: {
    stack: {
      language: "TypeScript",
      runtime: "Node.js",
      framework: "Express",
      database: "PostgreSQL",
    },
    constraints: [],
    dependencies: [],
  },
  assumptions: [],
  risks: [],
  timeline: {
    startDate: new Date().toISOString(),
    estimatedDuration: "4 weeks",
    milestones: [],
  },
};

describe("BacklogGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create generator with config", () => {
      const mockLLM = createMockLLM("{}");
      const generator = new BacklogGenerator(mockLLM, mockConfig);
      expect(generator).toBeDefined();
    });
  });

  describe("generate", () => {
    it("should generate backlog from architecture and specification", async () => {
      const mockResponse = JSON.stringify({
        epics: [
          {
            id: "epic-1",
            title: "User Authentication",
            description: "Handle user auth",
            priority: 1,
            dependencies: [],
            status: "planned",
          },
        ],
        stories: [
          {
            id: "story-1",
            epicId: "epic-1",
            title: "User Registration",
            asA: "new user",
            iWant: "to register",
            soThat: "I can access the system",
            acceptanceCriteria: ["AC1", "AC2"],
            points: 5,
            status: "backlog",
          },
        ],
        tasks: [
          {
            id: "task-1",
            storyId: "story-1",
            title: "Create user entity",
            description: "Define user model",
            type: "feature",
            files: ["src/models/user.ts"],
            dependencies: [],
            estimatedComplexity: "simple",
          },
        ],
        estimatedSprints: 3,
        warnings: [],
      });

      const mockLLM = createMockLLM(mockResponse);
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      // @ts-expect-error - using minimal mocks for testing
      const result = await generator.generate(mockArchitecture, mockSpecification);

      expect(result.backlog).toBeDefined();
      expect(result.backlog.epics.length).toBe(1);
      expect(result.backlog.stories.length).toBe(1);
      expect(result.backlog.tasks.length).toBe(1);
      expect(result.estimatedSprints).toBe(3);
    });

    it("should handle empty response", async () => {
      const mockResponse = JSON.stringify({
        epics: [],
        stories: [],
        tasks: [],
      });

      const mockLLM = createMockLLM(mockResponse);
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      // @ts-expect-error - using minimal mocks for testing
      const result = await generator.generate(mockArchitecture, mockSpecification);

      expect(result.backlog.epics).toEqual([]);
      expect(result.backlog.stories).toEqual([]);
      expect(result.backlog.tasks).toEqual([]);
    });

    it("should throw PhaseError when JSON parsing fails", async () => {
      const mockLLM = createMockLLM("This is not valid JSON");
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      // @ts-expect-error - using minimal mocks for testing
      await expect(generator.generate(mockArchitecture, mockSpecification))
        .rejects.toThrow("Failed to generate backlog");
    });

    it("should provide default values for missing fields", async () => {
      const mockResponse = JSON.stringify({
        epics: [{}],
        stories: [{}],
        tasks: [{}],
      });

      const mockLLM = createMockLLM(mockResponse);
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      // @ts-expect-error - using minimal mocks for testing
      const result = await generator.generate(mockArchitecture, mockSpecification);

      expect(result.backlog.epics[0]?.title).toBe("Epic");
      expect(result.backlog.epics[0]?.priority).toBe(3);
      expect(result.backlog.stories[0]?.title).toBe("Story");
      expect(result.backlog.stories[0]?.points).toBe(3);
      expect(result.backlog.tasks[0]?.title).toBe("Task");
      expect(result.backlog.tasks[0]?.type).toBe("feature");
    });

    it("should calculate estimated sprints from velocity", async () => {
      const mockResponse = JSON.stringify({
        epics: [],
        stories: [
          { points: 8 },
          { points: 8 },
          { points: 5 },
          { points: 5 },
        ],
        tasks: [],
      });

      const mockLLM = createMockLLM(mockResponse);
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      // @ts-expect-error - using minimal mocks for testing
      const result = await generator.generate(mockArchitecture, mockSpecification);

      // Total points: 26, velocity: 20, so 2 sprints
      expect(result.estimatedSprints).toBe(2);
    });
  });

  describe("planFirstSprint", () => {
    it("should plan sprint from backlog", async () => {
      const mockResponse = JSON.stringify({
        sprint: {
          id: "sprint-1",
          name: "Sprint 1: Setup",
          goal: "Set up project foundation",
          stories: ["story-1", "story-2"],
          plannedPoints: 10,
          status: "planning",
        },
      });

      const mockLLM = createMockLLM(mockResponse);
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      const backlog: Backlog = {
        epics: [
          {
            id: "epic-1",
            title: "Foundation",
            description: "",
            stories: [],
            priority: 1,
            dependencies: [],
            status: "planned",
          },
        ],
        stories: [
          {
            id: "story-1",
            epicId: "epic-1",
            title: "Setup",
            asA: "developer",
            iWant: "setup",
            soThat: "start",
            acceptanceCriteria: [],
            tasks: [],
            points: 5,
            status: "backlog",
          },
          {
            id: "story-2",
            epicId: "epic-1",
            title: "Config",
            asA: "developer",
            iWant: "config",
            soThat: "deploy",
            acceptanceCriteria: [],
            tasks: [],
            points: 5,
            status: "ready",
          },
        ],
        tasks: [],
        currentSprint: null,
        completedSprints: [],
      };

      const sprint = await generator.planFirstSprint(backlog);

      expect(sprint).toBeDefined();
      expect(sprint.name).toBe("Sprint 1: Setup");
      expect(sprint.stories).toContain("story-1");
    });

    it("should auto-select stories when LLM response invalid", async () => {
      const mockLLM = createMockLLM("Invalid response");
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      const backlog: Backlog = {
        epics: [
          {
            id: "epic-1",
            title: "Foundation",
            description: "",
            stories: [],
            priority: 1,
            dependencies: [],
            status: "planned",
          },
        ],
        stories: [
          {
            id: "story-1",
            epicId: "epic-1",
            title: "Setup",
            asA: "developer",
            iWant: "setup",
            soThat: "start",
            acceptanceCriteria: [],
            tasks: [],
            points: 5,
            status: "backlog",
          },
        ],
        tasks: [],
        currentSprint: null,
        completedSprints: [],
      };

      const sprint = await generator.planFirstSprint(backlog);

      expect(sprint).toBeDefined();
      expect(sprint.name).toBe("Sprint 1: Foundation");
      expect(sprint.stories).toContain("story-1");
    });

    it("should filter stories by epic dependencies", async () => {
      const mockLLM = createMockLLM("{}");
      const generator = new BacklogGenerator(mockLLM, mockConfig);

      const backlog: Backlog = {
        epics: [
          {
            id: "epic-1",
            title: "First",
            description: "",
            stories: [],
            priority: 1,
            dependencies: [],
            status: "planned",
          },
          {
            id: "epic-2",
            title: "Second",
            description: "",
            stories: [],
            priority: 2,
            dependencies: ["epic-1"],
            status: "planned",
          },
        ],
        stories: [
          {
            id: "story-1",
            epicId: "epic-1",
            title: "First story",
            asA: "user",
            iWant: "feature",
            soThat: "benefit",
            acceptanceCriteria: [],
            tasks: [],
            points: 5,
            status: "backlog",
          },
          {
            id: "story-2",
            epicId: "epic-2",
            title: "Second story",
            asA: "user",
            iWant: "feature",
            soThat: "benefit",
            acceptanceCriteria: [],
            tasks: [],
            points: 3,
            status: "backlog",
          },
        ],
        tasks: [],
        currentSprint: null,
        completedSprints: [],
      };

      const sprint = await generator.planFirstSprint(backlog);

      expect(sprint.stories).toContain("story-1");
      expect(sprint.stories).not.toContain("story-2");
    });

    it("should respect max stories per sprint", async () => {
      const mockLLM = createMockLLM("{}");
      const configWithLowLimit = {
        ...mockConfig,
        sprint: { ...mockConfig.sprint, maxStoriesPerSprint: 2 },
      };
      const generator = new BacklogGenerator(mockLLM, configWithLowLimit);

      const backlog: Backlog = {
        epics: [],
        stories: [
          {
            id: "story-1",
            epicId: "",
            title: "Story 1",
            asA: "user",
            iWant: "1",
            soThat: "1",
            acceptanceCriteria: [],
            tasks: [],
            points: 1,
            status: "backlog",
          },
          {
            id: "story-2",
            epicId: "",
            title: "Story 2",
            asA: "user",
            iWant: "2",
            soThat: "2",
            acceptanceCriteria: [],
            tasks: [],
            points: 1,
            status: "backlog",
          },
          {
            id: "story-3",
            epicId: "",
            title: "Story 3",
            asA: "user",
            iWant: "3",
            soThat: "3",
            acceptanceCriteria: [],
            tasks: [],
            points: 1,
            status: "backlog",
          },
        ],
        tasks: [],
        currentSprint: null,
        completedSprints: [],
      };

      const sprint = await generator.planFirstSprint(backlog);

      expect(sprint.stories.length).toBeLessThanOrEqual(2);
    });
  });
});

describe("createBacklogGenerator", () => {
  it("should create a BacklogGenerator instance", () => {
    const mockLLM = createMockLLM("{}");
    const generator = createBacklogGenerator(mockLLM, mockConfig);
    expect(generator).toBeInstanceOf(BacklogGenerator);
  });
});

describe("generateBacklogMarkdown", () => {
  it("should generate markdown for backlog", () => {
    const backlog: Backlog = {
      epics: [
        {
          id: "epic-1",
          title: "User Management",
          description: "Handle user operations",
          stories: [],
          priority: 1,
          dependencies: [],
          status: "planned",
        },
      ],
      stories: [
        {
          id: "story-1",
          epicId: "epic-1",
          title: "User Registration",
          asA: "new user",
          iWant: "to register",
          soThat: "I can access the system",
          acceptanceCriteria: ["AC1", "AC2"],
          tasks: [],
          points: 5,
          status: "backlog",
        },
      ],
      tasks: [
        {
          id: "task-1",
          storyId: "story-1",
          title: "Create user model",
          description: "Define user entity",
          type: "feature",
          files: [],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "pending",
        },
      ],
      currentSprint: null,
      completedSprints: [],
    };

    const markdown = generateBacklogMarkdown(backlog);

    expect(markdown).toContain("# Project Backlog");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("**Epics:** 1");
    expect(markdown).toContain("**Stories:** 1");
    expect(markdown).toContain("**Tasks:** 1");
    expect(markdown).toContain("User Management");
    expect(markdown).toContain("User Registration");
    expect(markdown).toContain("AC1");
    expect(markdown).toContain("Create user model");
    expect(markdown).toContain("Generated by Corbat-Coco");
  });

  it("should handle empty backlog", () => {
    const backlog: Backlog = {
      epics: [],
      stories: [],
      tasks: [],
      currentSprint: null,
      completedSprints: [],
    };

    const markdown = generateBacklogMarkdown(backlog);

    expect(markdown).toContain("# Project Backlog");
    expect(markdown).toContain("**Epics:** 0");
    expect(markdown).toContain("**Stories:** 0");
    expect(markdown).toContain("**Tasks:** 0");
    expect(markdown).toContain("**Total Points:** 0");
  });

  it("should calculate total points correctly", () => {
    const backlog: Backlog = {
      epics: [],
      stories: [
        {
          id: "story-1",
          epicId: "",
          title: "Story 1",
          asA: "user",
          iWant: "feature",
          soThat: "benefit",
          acceptanceCriteria: [],
          tasks: [],
          points: 5,
          status: "backlog",
        },
        {
          id: "story-2",
          epicId: "",
          title: "Story 2",
          asA: "user",
          iWant: "feature",
          soThat: "benefit",
          acceptanceCriteria: [],
          tasks: [],
          points: 8,
          status: "backlog",
        },
      ],
      tasks: [],
      currentSprint: null,
      completedSprints: [],
    };

    const markdown = generateBacklogMarkdown(backlog);

    expect(markdown).toContain("**Total Points:** 13");
  });
});

describe("generateSprintMarkdown", () => {
  it("should generate markdown for sprint", () => {
    const sprint: Sprint = {
      id: "sprint-1",
      name: "Sprint 1: Foundation",
      goal: "Set up project foundation",
      startDate: new Date("2025-01-01"),
      stories: ["story-1"],
      status: "planning",
    };

    const backlog: Backlog = {
      epics: [],
      stories: [
        {
          id: "story-1",
          epicId: "",
          title: "Setup Project",
          asA: "developer",
          iWant: "to setup the project",
          soThat: "I can start development",
          acceptanceCriteria: [],
          tasks: [],
          points: 3,
          status: "ready",
        },
      ],
      tasks: [
        {
          id: "task-1",
          storyId: "story-1",
          title: "Initialize repo",
          description: "Create git repo",
          type: "feature",
          files: [],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "pending",
        },
      ],
      currentSprint: sprint,
      completedSprints: [],
    };

    const markdown = generateSprintMarkdown(sprint, backlog);

    expect(markdown).toContain("# Sprint 1: Foundation");
    expect(markdown).toContain("2025-01-01");
    expect(markdown).toContain("planning");
    expect(markdown).toContain("Set up project foundation");
    expect(markdown).toContain("Setup Project");
    expect(markdown).toContain("**Total Points:** 3");
    expect(markdown).toContain("Initialize repo");
  });

  it("should show completed tasks with checkmark", () => {
    const sprint: Sprint = {
      id: "sprint-1",
      name: "Sprint 1",
      goal: "Goal",
      startDate: new Date(),
      stories: ["story-1"],
      status: "active",
    };

    const backlog: Backlog = {
      epics: [],
      stories: [
        {
          id: "story-1",
          epicId: "",
          title: "Story",
          asA: "user",
          iWant: "feature",
          soThat: "benefit",
          acceptanceCriteria: [],
          tasks: [],
          points: 3,
          status: "in_progress",
        },
      ],
      tasks: [
        {
          id: "task-1",
          storyId: "story-1",
          title: "Completed Task",
          description: "",
          type: "feature",
          files: [],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "completed",
        },
        {
          id: "task-2",
          storyId: "story-1",
          title: "Pending Task",
          description: "",
          type: "feature",
          files: [],
          dependencies: [],
          estimatedComplexity: "simple",
          status: "pending",
        },
      ],
      currentSprint: sprint,
      completedSprints: [],
    };

    const markdown = generateSprintMarkdown(sprint, backlog);

    expect(markdown).toContain("[x] Completed Task");
    expect(markdown).toContain("[ ] Pending Task");
  });

  it("should handle sprint with no stories", () => {
    const sprint: Sprint = {
      id: "sprint-1",
      name: "Empty Sprint",
      goal: "No goal",
      startDate: new Date(),
      stories: [],
      status: "planning",
    };

    const backlog: Backlog = {
      epics: [],
      stories: [],
      tasks: [],
      currentSprint: null,
      completedSprints: [],
    };

    const markdown = generateSprintMarkdown(sprint, backlog);

    expect(markdown).toContain("# Empty Sprint");
    expect(markdown).toContain("**Total Points:** 0");
  });
});
