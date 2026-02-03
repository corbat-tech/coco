/**
 * Tests for converge phase module exports
 */

import { describe, it, expect } from "vitest";
import * as ConvergeExports from "./index.js";

describe("Converge phase module exports", () => {
  describe("Discovery Engine", () => {
    it("should export DiscoveryEngine", () => {
      expect(ConvergeExports.DiscoveryEngine).toBeDefined();
    });

    it("should export createDiscoveryEngine", () => {
      expect(ConvergeExports.createDiscoveryEngine).toBeDefined();
      expect(typeof ConvergeExports.createDiscoveryEngine).toBe("function");
    });

    it("should export DEFAULT_DISCOVERY_CONFIG", () => {
      expect(ConvergeExports.DEFAULT_DISCOVERY_CONFIG).toBeDefined();
    });
  });

  describe("Specification Generator", () => {
    it("should export SpecificationGenerator", () => {
      expect(ConvergeExports.SpecificationGenerator).toBeDefined();
    });

    it("should export createSpecificationGenerator", () => {
      expect(ConvergeExports.createSpecificationGenerator).toBeDefined();
      expect(typeof ConvergeExports.createSpecificationGenerator).toBe("function");
    });

    it("should export validateSpecification", () => {
      expect(ConvergeExports.validateSpecification).toBeDefined();
      expect(typeof ConvergeExports.validateSpecification).toBe("function");
    });

    it("should export DEFAULT_SPEC_CONFIG", () => {
      expect(ConvergeExports.DEFAULT_SPEC_CONFIG).toBeDefined();
    });
  });

  describe("Persistence", () => {
    it("should export SessionPersistence", () => {
      expect(ConvergeExports.SessionPersistence).toBeDefined();
    });

    it("should export SessionManager", () => {
      expect(ConvergeExports.SessionManager).toBeDefined();
    });

    it("should export createSessionManager", () => {
      expect(ConvergeExports.createSessionManager).toBeDefined();
      expect(typeof ConvergeExports.createSessionManager).toBe("function");
    });

    it("should export getPersistencePaths", () => {
      expect(ConvergeExports.getPersistencePaths).toBeDefined();
      expect(typeof ConvergeExports.getPersistencePaths).toBe("function");
    });

    it("should export createCheckpoint", () => {
      expect(ConvergeExports.createCheckpoint).toBeDefined();
      expect(typeof ConvergeExports.createCheckpoint).toBe("function");
    });
  });

  describe("Executor", () => {
    it("should export ConvergeExecutor", () => {
      expect(ConvergeExports.ConvergeExecutor).toBeDefined();
    });

    it("should export createConvergeExecutor", () => {
      expect(ConvergeExports.createConvergeExecutor).toBeDefined();
      expect(typeof ConvergeExports.createConvergeExecutor).toBe("function");
    });

    it("should export runConvergePhase", () => {
      expect(ConvergeExports.runConvergePhase).toBeDefined();
      expect(typeof ConvergeExports.runConvergePhase).toBe("function");
    });

    it("should export DEFAULT_CONVERGE_CONFIG", () => {
      expect(ConvergeExports.DEFAULT_CONVERGE_CONFIG).toBeDefined();
    });
  });

  describe("Prompts", () => {
    it("should export DISCOVERY_SYSTEM_PROMPT", () => {
      expect(ConvergeExports.DISCOVERY_SYSTEM_PROMPT).toBeDefined();
      expect(typeof ConvergeExports.DISCOVERY_SYSTEM_PROMPT).toBe("string");
    });

    it("should export INITIAL_ANALYSIS_PROMPT", () => {
      expect(ConvergeExports.INITIAL_ANALYSIS_PROMPT).toBeDefined();
      expect(typeof ConvergeExports.INITIAL_ANALYSIS_PROMPT).toBe("string");
    });

    it("should export GENERATE_QUESTIONS_PROMPT", () => {
      expect(ConvergeExports.GENERATE_QUESTIONS_PROMPT).toBeDefined();
      expect(typeof ConvergeExports.GENERATE_QUESTIONS_PROMPT).toBe("string");
    });

    it("should export fillPrompt", () => {
      expect(ConvergeExports.fillPrompt).toBeDefined();
      expect(typeof ConvergeExports.fillPrompt).toBe("function");
    });

    it("should export createMessage", () => {
      expect(ConvergeExports.createMessage).toBeDefined();
      expect(typeof ConvergeExports.createMessage).toBe("function");
    });

    it("should export buildConversation", () => {
      expect(ConvergeExports.buildConversation).toBeDefined();
      expect(typeof ConvergeExports.buildConversation).toBe("function");
    });
  });
});

describe("Converge phase defaults", () => {
  it("should have valid DEFAULT_DISCOVERY_CONFIG", () => {
    const config = ConvergeExports.DEFAULT_DISCOVERY_CONFIG;
    expect(config.maxQuestionsPerRound).toBeGreaterThan(0);
    expect(config.minRequirements).toBeGreaterThan(0);
  });

  it("should have valid DEFAULT_CONVERGE_CONFIG", () => {
    const config = ConvergeExports.DEFAULT_CONVERGE_CONFIG;
    expect(config.maxQuestionRounds).toBeGreaterThan(0);
    expect(config.maxQuestionsPerRound).toBeGreaterThan(0);
  });
});

describe("Converge utility functions", () => {
  describe("getPersistencePaths", () => {
    it("should return correct paths for a project", () => {
      const paths = ConvergeExports.getPersistencePaths("/test/project");

      expect(paths.baseDir).toContain(".coco");
      expect(paths.sessionFile).toContain("discovery-session.json");
      expect(paths.specFile).toContain("spec.md");
      expect(paths.conversationLog).toContain("conversation.jsonl");
      expect(paths.checkpointFile).toContain("checkpoint.json");
    });
  });

  describe("createCheckpoint", () => {
    it("should create a valid checkpoint", () => {
      const checkpoint = ConvergeExports.createCheckpoint(
        "session-123",
        "discovery",
        50,
        false,
        { customKey: "customValue" }
      );

      expect(checkpoint.id).toContain("converge-");
      expect(checkpoint.sessionId).toBe("session-123");
      expect(checkpoint.step).toBe("discovery");
      expect(checkpoint.progress).toBe(50);
      expect(checkpoint.specGenerated).toBe(false);
      expect(checkpoint.metadata.customKey).toBe("customValue");
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("fillPrompt", () => {
    it("should fill placeholders in prompts", () => {
      const template = "Hello {{name}}, you have {{count}} messages.";
      const filled = ConvergeExports.fillPrompt(template, {
        name: "User",
        count: 5,
      });

      expect(filled).toBe("Hello User, you have 5 messages.");
    });

    it("should handle object values by JSON stringifying them", () => {
      const template = "Data: {{data}}";
      const filled = ConvergeExports.fillPrompt(template, {
        data: { key: "value", nested: { a: 1 } },
      });

      expect(filled).toContain('"key": "value"');
      expect(filled).toContain('"nested"');
    });

    it("should handle array values", () => {
      const template = "Items: {{items}}";
      const filled = ConvergeExports.fillPrompt(template, {
        items: ["a", "b", "c"],
      });

      // fillPrompt uses JSON.stringify with 2-space indentation
      expect(filled).toContain('"a"');
      expect(filled).toContain('"b"');
      expect(filled).toContain('"c"');
    });

    it("should handle null and undefined values", () => {
      const template = "Null: {{nullVal}}, Undef: {{undefVal}}";
      const filled = ConvergeExports.fillPrompt(template, {
        nullVal: null,
        undefVal: undefined,
      });

      expect(filled).toContain("null");
    });

    it("should handle multiple occurrences of the same placeholder", () => {
      const template = "{{name}} likes {{name}}'s job";
      const filled = ConvergeExports.fillPrompt(template, {
        name: "Alice",
      });

      expect(filled).toBe("Alice likes Alice's job");
    });
  });

  describe("createMessage", () => {
    it("should create a user message", () => {
      const message = ConvergeExports.createMessage("user", "Hello");

      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello");
    });

    it("should create an assistant message", () => {
      const message = ConvergeExports.createMessage("assistant", "Hi there");

      expect(message.role).toBe("assistant");
      expect(message.content).toBe("Hi there");
    });

    it("should create a system message", () => {
      const message = ConvergeExports.createMessage("system", "You are a helpful assistant");

      expect(message.role).toBe("system");
      expect(message.content).toBe("You are a helpful assistant");
    });
  });

  describe("buildConversation", () => {
    it("should build conversation with system prompt and messages", () => {
      const systemPrompt = "You are a helpful assistant";
      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
        { role: "user" as const, content: "How are you?" },
      ];

      const conversation = ConvergeExports.buildConversation(systemPrompt, messages);

      expect(conversation.length).toBe(4);
      expect(conversation[0]?.role).toBe("system");
      expect(conversation[0]?.content).toBe(systemPrompt);
      expect(conversation[1]?.role).toBe("user");
      expect(conversation[1]?.content).toBe("Hello");
      expect(conversation[2]?.role).toBe("assistant");
      expect(conversation[3]?.role).toBe("user");
    });

    it("should handle empty messages array", () => {
      const systemPrompt = "System prompt";
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      const conversation = ConvergeExports.buildConversation(systemPrompt, messages);

      expect(conversation.length).toBe(1);
      expect(conversation[0]?.role).toBe("system");
    });
  });
});
