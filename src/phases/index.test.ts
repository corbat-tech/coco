/**
 * Tests for phases module exports
 */

import { describe, it, expect } from "vitest";
import * as PhaseExports from "./index.js";

describe("Phases module exports", () => {
  describe("CONVERGE phase", () => {
    it("should export ConvergeExecutor", () => {
      expect(PhaseExports.ConvergeExecutor).toBeDefined();
    });

    it("should export createConvergeExecutor", () => {
      expect(PhaseExports.createConvergeExecutor).toBeDefined();
      expect(typeof PhaseExports.createConvergeExecutor).toBe("function");
    });

    it("should export DEFAULT_CONVERGE_CONFIG", () => {
      expect(PhaseExports.DEFAULT_CONVERGE_CONFIG).toBeDefined();
      expect(PhaseExports.DEFAULT_CONVERGE_CONFIG.maxQuestionRounds).toBeGreaterThan(0);
    });

    it("should export DiscoveryEngine", () => {
      expect(PhaseExports.DiscoveryEngine).toBeDefined();
    });

    it("should export createDiscoveryEngine", () => {
      expect(PhaseExports.createDiscoveryEngine).toBeDefined();
      expect(typeof PhaseExports.createDiscoveryEngine).toBe("function");
    });

    it("should export SpecificationGenerator", () => {
      expect(PhaseExports.SpecificationGenerator).toBeDefined();
    });

    it("should export createSpecificationGenerator", () => {
      expect(PhaseExports.createSpecificationGenerator).toBeDefined();
      expect(typeof PhaseExports.createSpecificationGenerator).toBe("function");
    });

    it("should export validateSpecification", () => {
      expect(PhaseExports.validateSpecification).toBeDefined();
      expect(typeof PhaseExports.validateSpecification).toBe("function");
    });

    it("should export SessionManager", () => {
      expect(PhaseExports.SessionManager).toBeDefined();
    });

    it("should export createSessionManager", () => {
      expect(PhaseExports.createSessionManager).toBeDefined();
      expect(typeof PhaseExports.createSessionManager).toBe("function");
    });
  });

  describe("ORCHESTRATE phase", () => {
    it("should export OrchestrateExecutor", () => {
      expect(PhaseExports.OrchestrateExecutor).toBeDefined();
    });

    it("should export createOrchestrateExecutor", () => {
      expect(PhaseExports.createOrchestrateExecutor).toBeDefined();
      expect(typeof PhaseExports.createOrchestrateExecutor).toBe("function");
    });

    it("should export DEFAULT_ORCHESTRATE_CONFIG", () => {
      expect(PhaseExports.DEFAULT_ORCHESTRATE_CONFIG).toBeDefined();
    });

    it("should export ArchitectureGenerator", () => {
      expect(PhaseExports.ArchitectureGenerator).toBeDefined();
    });

    it("should export generateArchitectureMarkdown", () => {
      expect(PhaseExports.generateArchitectureMarkdown).toBeDefined();
      expect(typeof PhaseExports.generateArchitectureMarkdown).toBe("function");
    });

    it("should export ADRGenerator", () => {
      expect(PhaseExports.ADRGenerator).toBeDefined();
    });

    it("should export generateADRMarkdown", () => {
      expect(PhaseExports.generateADRMarkdown).toBeDefined();
      expect(typeof PhaseExports.generateADRMarkdown).toBe("function");
    });

    it("should export getADRFilename", () => {
      expect(PhaseExports.getADRFilename).toBeDefined();
      expect(typeof PhaseExports.getADRFilename).toBe("function");
    });

    it("should export generateADRIndexMarkdown", () => {
      expect(PhaseExports.generateADRIndexMarkdown).toBeDefined();
      expect(typeof PhaseExports.generateADRIndexMarkdown).toBe("function");
    });

    it("should export BacklogGenerator", () => {
      expect(PhaseExports.BacklogGenerator).toBeDefined();
    });

    it("should export generateBacklogMarkdown", () => {
      expect(PhaseExports.generateBacklogMarkdown).toBeDefined();
      expect(typeof PhaseExports.generateBacklogMarkdown).toBe("function");
    });

    it("should export generateSprintMarkdown", () => {
      expect(PhaseExports.generateSprintMarkdown).toBeDefined();
      expect(typeof PhaseExports.generateSprintMarkdown).toBe("function");
    });
  });

  describe("COMPLETE phase", () => {
    it("should export CompleteExecutor", () => {
      expect(PhaseExports.CompleteExecutor).toBeDefined();
    });

    it("should export createCompleteExecutor", () => {
      expect(PhaseExports.createCompleteExecutor).toBeDefined();
      expect(typeof PhaseExports.createCompleteExecutor).toBe("function");
    });

    it("should export DEFAULT_COMPLETE_CONFIG", () => {
      expect(PhaseExports.DEFAULT_COMPLETE_CONFIG).toBeDefined();
    });

    it("should export TaskIterator", () => {
      expect(PhaseExports.TaskIterator).toBeDefined();
    });

    it("should export createTaskIterator", () => {
      expect(PhaseExports.createTaskIterator).toBeDefined();
      expect(typeof PhaseExports.createTaskIterator).toBe("function");
    });

    it("should export CodeReviewer", () => {
      expect(PhaseExports.CodeReviewer).toBeDefined();
    });

    it("should export createCodeReviewer", () => {
      expect(PhaseExports.createCodeReviewer).toBeDefined();
      expect(typeof PhaseExports.createCodeReviewer).toBe("function");
    });
  });

  describe("OUTPUT phase", () => {
    it("should export OutputExecutor", () => {
      expect(PhaseExports.OutputExecutor).toBeDefined();
    });

    it("should export createOutputExecutor", () => {
      expect(PhaseExports.createOutputExecutor).toBeDefined();
      expect(typeof PhaseExports.createOutputExecutor).toBe("function");
    });

    it("should export DEFAULT_OUTPUT_CONFIG", () => {
      expect(PhaseExports.DEFAULT_OUTPUT_CONFIG).toBeDefined();
    });

    it("should export CICDGenerator", () => {
      expect(PhaseExports.CICDGenerator).toBeDefined();
    });

    it("should export createDefaultCICDConfig", () => {
      expect(PhaseExports.createDefaultCICDConfig).toBeDefined();
      expect(typeof PhaseExports.createDefaultCICDConfig).toBe("function");
    });

    it("should export DockerGenerator", () => {
      expect(PhaseExports.DockerGenerator).toBeDefined();
    });

    it("should export DocsGenerator", () => {
      expect(PhaseExports.DocsGenerator).toBeDefined();
    });
  });
});

describe("Phase defaults validation", () => {
  describe("DEFAULT_CONVERGE_CONFIG", () => {
    it("should have valid maxQuestionRounds", () => {
      expect(PhaseExports.DEFAULT_CONVERGE_CONFIG.maxQuestionRounds).toBeGreaterThan(0);
      expect(PhaseExports.DEFAULT_CONVERGE_CONFIG.maxQuestionsPerRound).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_ORCHESTRATE_CONFIG", () => {
    it("should have valid configuration", () => {
      const config = PhaseExports.DEFAULT_ORCHESTRATE_CONFIG;
      expect(config).toBeDefined();
    });
  });

  describe("DEFAULT_COMPLETE_CONFIG", () => {
    it("should have valid configuration", () => {
      const config = PhaseExports.DEFAULT_COMPLETE_CONFIG;
      expect(config).toBeDefined();
    });
  });

  describe("DEFAULT_OUTPUT_CONFIG", () => {
    it("should have valid configuration", () => {
      const config = PhaseExports.DEFAULT_OUTPUT_CONFIG;
      expect(config).toBeDefined();
    });
  });
});
