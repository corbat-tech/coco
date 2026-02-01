/**
 * Tests for the Discovery Engine
 */

import { describe, it, expect } from "vitest";
import { DiscoveryEngine, DEFAULT_DISCOVERY_CONFIG } from "./discovery.js";
import type { LLMProvider, ChatResponse } from "../../providers/types.js";

// Mock LLM provider
function createMockLLM(responses: string[]): LLMProvider {
  let callIndex = 0;

  return {
    async initialize() {},

    async chat(): Promise<ChatResponse> {
      const response = responses[callIndex] || responses[responses.length - 1] || "{}";
      callIndex++;

      return {
        content: response,
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },

    async chatWithTools() {
      return {
        content: "",
        finishReason: "stop" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },

    async *stream() {
      yield { type: "content" as const, content: "test" };
    },

    async shutdown() {},
  };
}

describe("DiscoveryEngine", () => {
  describe("startSession", () => {
    it("should create a new session with initial input", async () => {
      const mockResponse = JSON.stringify({
        projectType: "cli",
        complexity: "simple",
        completeness: 40,
        requirements: [
          {
            category: "functional",
            priority: "must_have",
            title: "Command line interface",
            description: "The tool should have a CLI",
            explicit: true,
          },
        ],
        assumptions: [
          {
            category: "platform",
            statement: "The tool will run on Unix-like systems",
            confidence: "medium",
            impactIfWrong: "May need Windows support",
          },
        ],
        questions: [
          {
            category: "clarification",
            question: "What programming language should we use?",
            context: "Need to determine the tech stack",
            importance: "critical",
          },
        ],
        techRecommendations: [
          {
            area: "language",
            decision: "TypeScript",
            alternatives: ["Python", "Go"],
            rationale: "Good for CLI tools",
          },
        ],
      });

      const llm = createMockLLM([mockResponse]);
      const engine = new DiscoveryEngine(llm);

      const session = await engine.startSession("Build a CLI tool for managing tasks");

      expect(session.id).toBeDefined();
      expect(session.status).toBe("clarifying"); // Has critical question
      expect(session.initialInput).toBe("Build a CLI tool for managing tasks");
      expect(session.requirements.length).toBe(1);
      expect(session.requirements[0]?.title).toBe("Command line interface");
      expect(session.assumptions.length).toBe(1);
      expect(session.openQuestions.length).toBe(1);
      expect(session.techDecisions.length).toBe(1);
    });

    it("should handle minimal input", async () => {
      const mockResponse = JSON.stringify({
        projectType: "unknown",
        complexity: "moderate",
        completeness: 10,
        requirements: [],
        assumptions: [],
        questions: [
          {
            category: "expansion",
            question: "What should this project do?",
            context: "Need more details",
            importance: "critical",
          },
        ],
        techRecommendations: [],
      });

      const llm = createMockLLM([mockResponse]);
      const engine = new DiscoveryEngine(llm);

      const session = await engine.startSession("Build something");

      expect(session.status).toBe("clarifying");
      expect(session.openQuestions.length).toBe(1);
    });
  });

  describe("processAnswer", () => {
    it("should process user answers and update session", async () => {
      const initialResponse = JSON.stringify({
        projectType: "cli",
        complexity: "simple",
        completeness: 30,
        requirements: [],
        assumptions: [],
        questions: [
          {
            category: "clarification",
            question: "What language?",
            context: "Tech stack",
            importance: "critical",
          },
        ],
        techRecommendations: [],
      });

      const answerResponse = JSON.stringify({
        affectedRequirements: [],
        modifications: [],
        newRequirements: [
          {
            category: "technical",
            priority: "must_have",
            title: "TypeScript implementation",
            description: "Use TypeScript for the project",
          },
        ],
        confirmedAssumptions: [],
      });

      const llm = createMockLLM([initialResponse, answerResponse]);
      const engine = new DiscoveryEngine(llm);

      const session = await engine.startSession("Build a tool");
      const questionId = session.openQuestions[0]?.id;

      if (questionId) {
        await engine.processAnswer(questionId, "TypeScript");

        const updated = engine.getSession();
        expect(updated?.clarifications.length).toBe(1);
        expect(updated?.clarifications[0]?.answer).toBe("TypeScript");
        // The question should be removed from open questions
        expect(updated?.openQuestions.find((q) => q.id === questionId)).toBeUndefined();
      }
    });
  });

  describe("processMessage", () => {
    it("should extract requirements from free-form messages", async () => {
      const initialResponse = JSON.stringify({
        projectType: "api",
        complexity: "moderate",
        completeness: 50,
        requirements: [],
        assumptions: [],
        questions: [],
        techRecommendations: [],
      });

      const messageResponse = JSON.stringify({
        newRequirements: [
          {
            category: "functional",
            priority: "must_have",
            title: "User authentication",
            description: "Users should be able to log in",
          },
          {
            category: "functional",
            priority: "should_have",
            title: "Password reset",
            description: "Users should be able to reset their password",
          },
        ],
        modifiedRequirements: [],
        techPreferences: [
          {
            area: "database",
            preference: "PostgreSQL",
            reason: "Good for relational data",
          },
        ],
      });

      const llm = createMockLLM([initialResponse, messageResponse]);
      const engine = new DiscoveryEngine(llm);

      await engine.startSession("Build an API");

      const result = await engine.processMessage(
        "I need user authentication with login and password reset"
      );

      expect(result.newRequirements.length).toBe(2);
      expect(result.newRequirements[0]?.title).toBe("User authentication");

      const session = engine.getSession();
      expect(session?.techDecisions.some((t) => t.decision === "PostgreSQL")).toBe(true);
    });
  });

  describe("generateQuestions", () => {
    it("should generate follow-up questions", async () => {
      const initialResponse = JSON.stringify({
        projectType: "web_app",
        complexity: "complex",
        completeness: 40,
        requirements: [
          {
            category: "functional",
            priority: "must_have",
            title: "Dashboard",
            description: "Show analytics dashboard",
          },
        ],
        assumptions: [
          {
            category: "ui",
            statement: "Will use React",
            confidence: "low",
            impactIfWrong: "UI framework change",
          },
        ],
        questions: [],
        techRecommendations: [],
      });

      const questionsResponse = JSON.stringify({
        questions: [
          {
            category: "decision",
            question: "Which UI framework do you prefer?",
            context: "Need to decide on frontend stack",
            importance: "important",
            options: ["React", "Vue", "Angular"],
          },
        ],
        reasoning: "UI framework affects architecture",
      });

      const llm = createMockLLM([initialResponse, questionsResponse]);
      const engine = new DiscoveryEngine(llm);

      await engine.startSession("Build a web app with dashboard");

      const questions = await engine.generateQuestions();

      expect(questions.length).toBeGreaterThan(0);
      expect(questions[0]?.options?.length).toBe(3);
    });
  });

  describe("isComplete", () => {
    it("should return false for incomplete sessions", async () => {
      const mockResponse = JSON.stringify({
        projectType: "cli",
        complexity: "simple",
        completeness: 30,
        requirements: [{ category: "functional", priority: "must_have", title: "Test", description: "Test" }],
        assumptions: [],
        questions: [
          {
            category: "clarification",
            question: "What?",
            context: "Need info",
            importance: "critical",
          },
        ],
        techRecommendations: [],
      });

      const llm = createMockLLM([mockResponse]);
      const engine = new DiscoveryEngine(llm);

      await engine.startSession("Build something");

      expect(engine.isComplete()).toBe(false);
    });

    it("should return true after markComplete is called", async () => {
      const mockResponse = JSON.stringify({
        projectType: "cli",
        complexity: "simple",
        completeness: 80,
        requirements: [
          { category: "functional", priority: "must_have", title: "Test", description: "Test" },
          { category: "functional", priority: "must_have", title: "Test2", description: "Test2" },
          { category: "functional", priority: "must_have", title: "Test3", description: "Test3" },
        ],
        assumptions: [],
        questions: [],
        techRecommendations: [],
      });

      const llm = createMockLLM([mockResponse]);
      const engine = new DiscoveryEngine(llm);

      await engine.startSession("Build a complete tool");
      engine.markComplete();

      expect(engine.isComplete()).toBe(true);
    });
  });

  describe("getCriticalQuestions", () => {
    it("should return only critical unanswered questions", async () => {
      const mockResponse = JSON.stringify({
        projectType: "api",
        complexity: "moderate",
        completeness: 50,
        requirements: [],
        assumptions: [],
        questions: [
          {
            category: "clarification",
            question: "Critical question?",
            context: "Very important",
            importance: "critical",
          },
          {
            category: "clarification",
            question: "Helpful question?",
            context: "Nice to know",
            importance: "helpful",
          },
        ],
        techRecommendations: [],
      });

      const llm = createMockLLM([mockResponse]);
      const engine = new DiscoveryEngine(llm);

      await engine.startSession("Build an API");

      const critical = engine.getCriticalQuestions();

      expect(critical.length).toBe(1);
      expect(critical[0]?.importance).toBe("critical");
    });
  });

  describe("configuration", () => {
    it("should use custom configuration", async () => {
      const customConfig = {
        maxQuestionsPerRound: 5,
        minRequirements: 10,
      };

      const llm = createMockLLM([JSON.stringify({
        projectType: "cli",
        complexity: "simple",
        completeness: 50,
        requirements: [],
        assumptions: [],
        questions: [],
        techRecommendations: [],
      })]);

      const engine = new DiscoveryEngine(llm, customConfig);
      const session = await engine.startSession("Test");

      // Session should be in gathering mode because minRequirements is 10
      expect(session.status).toBe("gathering");
    });
  });
});

describe("DEFAULT_DISCOVERY_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_DISCOVERY_CONFIG.maxQuestionsPerRound).toBe(3);
    expect(DEFAULT_DISCOVERY_CONFIG.minRequirements).toBe(3);
    expect(DEFAULT_DISCOVERY_CONFIG.autoConfirmLowConfidence).toBe(false);
    expect(DEFAULT_DISCOVERY_CONFIG.defaultLanguage).toBe("typescript");
    expect(DEFAULT_DISCOVERY_CONFIG.includeDiagrams).toBe(true);
  });
});
