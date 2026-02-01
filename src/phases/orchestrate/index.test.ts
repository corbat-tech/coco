/**
 * Tests for orchestrate phase module exports
 */

import { describe, it, expect } from "vitest";
import * as OrchestrateExports from "./index.js";

describe("Orchestrate phase module exports", () => {
  describe("Architecture Generator", () => {
    it("should export ArchitectureGenerator", () => {
      expect(OrchestrateExports.ArchitectureGenerator).toBeDefined();
    });

    it("should export generateArchitectureMarkdown", () => {
      expect(OrchestrateExports.generateArchitectureMarkdown).toBeDefined();
      expect(typeof OrchestrateExports.generateArchitectureMarkdown).toBe("function");
    });

    it("should export createArchitectureGenerator", () => {
      expect(OrchestrateExports.createArchitectureGenerator).toBeDefined();
      expect(typeof OrchestrateExports.createArchitectureGenerator).toBe("function");
    });
  });

  describe("ADR Generator", () => {
    it("should export ADRGenerator", () => {
      expect(OrchestrateExports.ADRGenerator).toBeDefined();
    });

    it("should export generateADRMarkdown", () => {
      expect(OrchestrateExports.generateADRMarkdown).toBeDefined();
      expect(typeof OrchestrateExports.generateADRMarkdown).toBe("function");
    });

    it("should export generateADRIndexMarkdown", () => {
      expect(OrchestrateExports.generateADRIndexMarkdown).toBeDefined();
      expect(typeof OrchestrateExports.generateADRIndexMarkdown).toBe("function");
    });

    it("should export getADRFilename", () => {
      expect(OrchestrateExports.getADRFilename).toBeDefined();
      expect(typeof OrchestrateExports.getADRFilename).toBe("function");
    });

    it("should export createADRGenerator", () => {
      expect(OrchestrateExports.createADRGenerator).toBeDefined();
      expect(typeof OrchestrateExports.createADRGenerator).toBe("function");
    });

    it("should export ADR_TEMPLATES", () => {
      expect(OrchestrateExports.ADR_TEMPLATES).toBeDefined();
    });
  });

  describe("Backlog Generator", () => {
    it("should export BacklogGenerator", () => {
      expect(OrchestrateExports.BacklogGenerator).toBeDefined();
    });

    it("should export generateBacklogMarkdown", () => {
      expect(OrchestrateExports.generateBacklogMarkdown).toBeDefined();
      expect(typeof OrchestrateExports.generateBacklogMarkdown).toBe("function");
    });

    it("should export generateSprintMarkdown", () => {
      expect(OrchestrateExports.generateSprintMarkdown).toBeDefined();
      expect(typeof OrchestrateExports.generateSprintMarkdown).toBe("function");
    });

    it("should export createBacklogGenerator", () => {
      expect(OrchestrateExports.createBacklogGenerator).toBeDefined();
      expect(typeof OrchestrateExports.createBacklogGenerator).toBe("function");
    });
  });

  describe("Executor", () => {
    it("should export OrchestrateExecutor", () => {
      expect(OrchestrateExports.OrchestrateExecutor).toBeDefined();
    });

    it("should export createOrchestrateExecutor", () => {
      expect(OrchestrateExports.createOrchestrateExecutor).toBeDefined();
      expect(typeof OrchestrateExports.createOrchestrateExecutor).toBe("function");
    });

    it("should export runOrchestratePhase", () => {
      expect(OrchestrateExports.runOrchestratePhase).toBeDefined();
      expect(typeof OrchestrateExports.runOrchestratePhase).toBe("function");
    });
  });

  describe("Config defaults", () => {
    it("should export DEFAULT_SPRINT_CONFIG", () => {
      expect(OrchestrateExports.DEFAULT_SPRINT_CONFIG).toBeDefined();
    });

    it("should export DEFAULT_ORCHESTRATE_CONFIG", () => {
      expect(OrchestrateExports.DEFAULT_ORCHESTRATE_CONFIG).toBeDefined();
    });
  });

  describe("Prompts", () => {
    it("should export ARCHITECT_SYSTEM_PROMPT", () => {
      expect(OrchestrateExports.ARCHITECT_SYSTEM_PROMPT).toBeDefined();
      expect(typeof OrchestrateExports.ARCHITECT_SYSTEM_PROMPT).toBe("string");
    });

    it("should export GENERATE_ARCHITECTURE_PROMPT", () => {
      expect(OrchestrateExports.GENERATE_ARCHITECTURE_PROMPT).toBeDefined();
      expect(typeof OrchestrateExports.GENERATE_ARCHITECTURE_PROMPT).toBe("string");
    });

    it("should export GENERATE_ADRS_PROMPT", () => {
      expect(OrchestrateExports.GENERATE_ADRS_PROMPT).toBeDefined();
      expect(typeof OrchestrateExports.GENERATE_ADRS_PROMPT).toBe("string");
    });

    it("should export GENERATE_BACKLOG_PROMPT", () => {
      expect(OrchestrateExports.GENERATE_BACKLOG_PROMPT).toBeDefined();
      expect(typeof OrchestrateExports.GENERATE_BACKLOG_PROMPT).toBe("string");
    });

    it("should export fillPrompt", () => {
      expect(OrchestrateExports.fillPrompt).toBeDefined();
      expect(typeof OrchestrateExports.fillPrompt).toBe("function");
    });
  });
});

describe("Orchestrate phase defaults", () => {
  describe("DEFAULT_SPRINT_CONFIG", () => {
    it("should have valid sprint duration", () => {
      expect(OrchestrateExports.DEFAULT_SPRINT_CONFIG.sprintDuration).toBeGreaterThan(0);
    });

    it("should have valid target velocity", () => {
      expect(OrchestrateExports.DEFAULT_SPRINT_CONFIG.targetVelocity).toBeGreaterThan(0);
    });

    it("should have valid max stories per sprint", () => {
      expect(OrchestrateExports.DEFAULT_SPRINT_CONFIG.maxStoriesPerSprint).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_ORCHESTRATE_CONFIG", () => {
    it("should have sprint config", () => {
      expect(OrchestrateExports.DEFAULT_ORCHESTRATE_CONFIG.sprint).toBeDefined();
    });
  });
});

describe("Orchestrate utility functions", () => {
  describe("getADRFilename", () => {
    it("should generate correct ADR filename", () => {
      const adr: OrchestrateExports.ADR = {
        number: 1,
        title: "Use TypeScript",
        status: "accepted",
        date: new Date(),
        context: "Context",
        decision: "Decision",
        consequences: { positive: [], negative: [], neutral: [] },
        deciders: [],
        alternatives: [],
      };
      const filename = OrchestrateExports.getADRFilename(adr);
      expect(filename).toMatch(/^001-.*\.md$/);
      expect(filename).toContain("use-typescript");
    });

    it("should handle special characters in title", () => {
      const adr: OrchestrateExports.ADR = {
        number: 5,
        title: "API: REST vs GraphQL",
        status: "accepted",
        date: new Date(),
        context: "Context",
        decision: "Decision",
        consequences: { positive: [], negative: [], neutral: [] },
        deciders: [],
        alternatives: [],
      };
      const filename = OrchestrateExports.getADRFilename(adr);
      expect(filename).toMatch(/^005-.*\.md$/);
    });
  });

  describe("generateBacklogMarkdown", () => {
    it("should generate markdown for backlog", () => {
      const backlog = {
        epics: [
          {
            id: "epic-1",
            title: "User Management",
            description: "Handle user operations",
            stories: [],
            priority: 1 as const,
            dependencies: [],
            status: "planned" as const,
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
            points: 5 as const,
            status: "backlog" as const,
          },
        ],
        tasks: [],
        currentSprint: null,
        completedSprints: [],
      };

      const markdown = OrchestrateExports.generateBacklogMarkdown(backlog);

      expect(markdown).toContain("# Project Backlog");
      expect(markdown).toContain("User Management");
      expect(markdown).toContain("User Registration");
      expect(markdown).toContain("Generated by Corbat-Coco");
    });
  });

  describe("generateSprintMarkdown", () => {
    it("should generate markdown for sprint", () => {
      const sprint = {
        id: "sprint-1",
        name: "Sprint 1: Foundation",
        goal: "Set up project foundation",
        startDate: new Date("2025-01-01"),
        stories: ["story-1"],
        status: "planning" as const,
      };

      const backlog = {
        epics: [],
        stories: [
          {
            id: "story-1",
            epicId: "epic-1",
            title: "Setup Project",
            asA: "developer",
            iWant: "to setup the project",
            soThat: "I can start development",
            acceptanceCriteria: [],
            tasks: [],
            points: 3 as const,
            status: "ready" as const,
          },
        ],
        tasks: [],
        currentSprint: sprint,
        completedSprints: [],
      };

      const markdown = OrchestrateExports.generateSprintMarkdown(sprint, backlog);

      expect(markdown).toContain("# Sprint 1: Foundation");
      expect(markdown).toContain("Set up project foundation");
      expect(markdown).toContain("Setup Project");
    });
  });
});
