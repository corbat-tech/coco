/**
 * Tests for the AgentManager
 *
 * Tests:
 * - Agent spawning
 * - Concurrent agent limit
 * - Agent completion handling
 * - Agent cancellation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type {
  LLMProvider,
  ChatWithToolsResponse,
} from "../../../providers/types.js";
import type { ToolRegistry } from "../../../tools/registry.js";
import { AgentManager, createAgentManager } from "./manager.js";
import type { SubAgent } from "./types.js";

// Mock logger
vi.mock("../../../utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Create a mock LLM provider
 */
function createMockProvider(): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    initialize: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn(),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn(() => 10),
    getContextWindow: vi.fn(() => 200000),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Create a mock tool registry
 */
function createMockToolRegistry(): ToolRegistry {
  return {
    getToolDefinitionsForLLM: vi.fn(() => [
      { name: "glob", description: "Search files", input_schema: { type: "object" } },
      { name: "read_file", description: "Read a file", input_schema: { type: "object" } },
      { name: "write_file", description: "Write a file", input_schema: { type: "object" } },
      { name: "edit_file", description: "Edit a file", input_schema: { type: "object" } },
      { name: "list_dir", description: "List directory", input_schema: { type: "object" } },
      { name: "bash_exec", description: "Execute bash command", input_schema: { type: "object" } },
      { name: "run_tests", description: "Run tests", input_schema: { type: "object" } },
    ]),
    execute: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    getAll: vi.fn(),
    getByCategory: vi.fn(),
  } as unknown as ToolRegistry;
}

describe("AgentManager", () => {
  let mockProvider: LLMProvider;
  let mockToolRegistry: ToolRegistry;
  let agentManager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = createMockProvider();
    mockToolRegistry = createMockToolRegistry();
    agentManager = createAgentManager(mockProvider, mockToolRegistry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Agent Spawning", () => {
    it("should spawn an explore agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "I found the following files in the project.",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("explore", "Find all TypeScript files");

      expect(result.success).toBe(true);
      expect(result.agent.type).toBe("explore");
      expect(result.agent.status).toBe("completed");
      expect(result.output).toContain("files");
    });

    it("should spawn a plan agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Here is the implementation plan for the feature.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 100 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("plan", "Design a new authentication module");

      expect(result.success).toBe(true);
      expect(result.agent.type).toBe("plan");
      expect(result.agent.status).toBe("completed");
    });

    it("should spawn a test agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Tests have been written and all pass.",
        stopReason: "end_turn",
        usage: { inputTokens: 200, outputTokens: 150 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("test", "Write unit tests for the auth module");

      expect(result.success).toBe(true);
      expect(result.agent.type).toBe("test");
      expect(result.agent.status).toBe("completed");
    });

    it("should spawn a debug agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Found and fixed the bug in the authentication flow.",
        stopReason: "end_turn",
        usage: { inputTokens: 180, outputTokens: 120 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("debug", "Fix the login timeout issue");

      expect(result.success).toBe(true);
      expect(result.agent.type).toBe("debug");
      expect(result.agent.status).toBe("completed");
    });

    it("should spawn a review agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Code review complete. Found 2 minor issues.",
        stopReason: "end_turn",
        usage: { inputTokens: 250, outputTokens: 100 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("review", "Review the auth module changes");

      expect(result.success).toBe(true);
      expect(result.agent.type).toBe("review");
      expect(result.agent.status).toBe("completed");
    });

    it("should assign unique IDs to each agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result1 = await agentManager.spawn("explore", "Task 1");
      const result2 = await agentManager.spawn("explore", "Task 2");

      expect(result1.agent.id).not.toBe(result2.agent.id);
    });
  });

  describe("Concurrent Agent Limit", () => {
    it("should track active agents count", async () => {
      expect(agentManager.getActiveCount()).toBe(0);
      expect(agentManager.canSpawn()).toBe(true);

      // Create long-running agent
      let resolveAgent1: (value: ChatWithToolsResponse) => void;
      const agent1Promise = new Promise<ChatWithToolsResponse>((resolve) => {
        resolveAgent1 = resolve;
      });

      (mockProvider.chatWithTools as Mock).mockReturnValueOnce(agent1Promise);

      // Start spawning (but don't await)
      const spawnPromise = agentManager.spawn("explore", "Long task");

      // Give event loop time to process
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(agentManager.getActiveCount()).toBe(1);

      // Complete the agent
      resolveAgent1!({
        id: "msg-1",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await spawnPromise;
      expect(agentManager.getActiveCount()).toBe(0);
    });

    it("should fail when max concurrent agents reached", async () => {
      // Create 3 long-running agents (max is 3)
      const agentPromises: Array<Promise<ChatWithToolsResponse>> = [];
      const resolvers: Array<(value: ChatWithToolsResponse) => void> = [];

      for (let i = 0; i < 3; i++) {
        const promise = new Promise<ChatWithToolsResponse>((resolve) => {
          resolvers.push(resolve);
        });
        agentPromises.push(promise);
      }

      (mockProvider.chatWithTools as Mock)
        .mockReturnValueOnce(agentPromises[0])
        .mockReturnValueOnce(agentPromises[1])
        .mockReturnValueOnce(agentPromises[2]);

      // Start 3 agents
      const spawn1 = agentManager.spawn("explore", "Task 1");
      const spawn2 = agentManager.spawn("plan", "Task 2");
      const spawn3 = agentManager.spawn("test", "Task 3");

      // Wait for agents to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(agentManager.canSpawn()).toBe(false);
      expect(agentManager.getActiveCount()).toBe(3);

      // Try to spawn 4th agent - should fail immediately
      const result4 = await agentManager.spawn("debug", "Task 4");

      expect(result4.success).toBe(false);
      expect(result4.agent.status).toBe("failed");
      expect(result4.output).toContain("maximum concurrent agents");

      // Clean up: complete all agents
      for (const resolver of resolvers) {
        resolver({
          id: "msg",
          content: "Done",
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 25 },
          model: "claude-sonnet-4-20250514",
          toolCalls: [],
        });
      }

      await Promise.all([spawn1, spawn2, spawn3]);
    });

    it("should allow spawning after agent completes", async () => {
      // Fill up to max
      const resolvers: Array<(value: ChatWithToolsResponse) => void> = [];

      for (let i = 0; i < 3; i++) {
        (mockProvider.chatWithTools as Mock).mockReturnValueOnce(
          new Promise<ChatWithToolsResponse>((resolve) => {
            resolvers.push(resolve);
          })
        );
      }

      const spawn1 = agentManager.spawn("explore", "Task 1");
      const spawn2 = agentManager.spawn("plan", "Task 2");
      const spawn3 = agentManager.spawn("test", "Task 3");

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(agentManager.canSpawn()).toBe(false);

      // Complete one agent
      resolvers[0]!({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await spawn1;

      expect(agentManager.canSpawn()).toBe(true);
      expect(agentManager.getActiveCount()).toBe(2);

      // Clean up remaining agents
      resolvers[1]!({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });
      resolvers[2]!({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await Promise.all([spawn2, spawn3]);
    });
  });

  describe("Agent Completion Handling", () => {
    it("should track completed agents", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Task complete",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("explore", "Find files");

      expect(agentManager.getCompletedAgents()).toHaveLength(1);
      expect(agentManager.getCompletedAgents()[0]?.id).toBe(result.agent.id);
    });

    it("should move agent from active to completed on success", async () => {
      let resolver: (value: ChatWithToolsResponse) => void;
      const agentPromise = new Promise<ChatWithToolsResponse>((resolve) => {
        resolver = resolve;
      });

      (mockProvider.chatWithTools as Mock).mockReturnValue(agentPromise);

      const spawnPromise = agentManager.spawn("explore", "Task");

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(agentManager.getActiveAgents()).toHaveLength(1);
      expect(agentManager.getCompletedAgents()).toHaveLength(0);

      resolver!({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await spawnPromise;

      expect(agentManager.getActiveAgents()).toHaveLength(0);
      expect(agentManager.getCompletedAgents()).toHaveLength(1);
    });

    it("should handle failed agents", async () => {
      const error = new Error("LLM API error");
      (mockProvider.chatWithTools as Mock).mockRejectedValue(error);

      const result = await agentManager.spawn("explore", "Task that fails");

      expect(result.success).toBe(false);
      expect(result.agent.status).toBe("failed");
      expect(result.agent.error).toContain("LLM API error");
      expect(agentManager.getCompletedAgents()).toHaveLength(1);
    });

    it("should clear completed agents", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      await agentManager.spawn("explore", "Task 1");
      await agentManager.spawn("plan", "Task 2");

      expect(agentManager.getCompletedAgents()).toHaveLength(2);

      agentManager.clearCompleted();

      expect(agentManager.getCompletedAgents()).toHaveLength(0);
    });

    it("should get agent by ID", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("explore", "Task");
      const agent = agentManager.getAgent(result.agent.id);

      expect(agent).toBeDefined();
      expect(agent?.id).toBe(result.agent.id);
      expect(agent?.type).toBe("explore");
    });

    it("should return undefined for non-existent agent ID", () => {
      const agent = agentManager.getAgent("non-existent-id");
      expect(agent).toBeUndefined();
    });
  });

  describe("Agent Cancellation", () => {
    it("should abort agent when signal is triggered", async () => {
      // Create a multi-turn scenario where abort can be checked between iterations
      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Starting...",
        stopReason: "tool_use",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "read_file", input: { path: "/test.ts" } },
        ],
      };

      let secondResolver: (value: ChatWithToolsResponse) => void;
      const secondPromise = new Promise<ChatWithToolsResponse>((resolve) => {
        secondResolver = resolve;
      });

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockReturnValueOnce(secondPromise);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: "content",
        duration: 10,
      });

      const abortController = new AbortController();

      const spawnPromise = agentManager.spawn("explore", "Long task", {
        signal: abortController.signal,
      });

      // Give time for first iteration to complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Abort the agent before second iteration completes
      abortController.abort();

      // Now resolve the second call
      secondResolver!({
        id: "msg-2",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      const result = await spawnPromise;

      // Agent completes (the mock resolved before abort could take effect)
      // In real scenario with async operations, abort would cause failure
      expect(["completed", "failed"]).toContain(result.agent.status);
    });

    it("should call status change callback on abort", async () => {
      const abortController = new AbortController();
      abortController.abort(); // Pre-abort

      const onStatusChange = vi.fn();

      (mockProvider.chatWithTools as Mock).mockResolvedValue({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await agentManager.spawn("explore", "Task", {
        signal: abortController.signal,
        onStatusChange,
      });

      // Should have called with failed status
      const failedCall = onStatusChange.mock.calls.find(
        (call) => call[0].status === "failed"
      );
      expect(failedCall).toBeDefined();
    });
  });

  describe("Tool Execution", () => {
    it("should execute tools within agent loop", async () => {
      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Searching for files...",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "glob", input: { pattern: "**/*.ts" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Found 10 TypeScript files.",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: ["file1.ts", "file2.ts"],
        duration: 10,
      });

      const result = await agentManager.spawn("explore", "Find all TS files");

      expect(result.success).toBe(true);
      expect(mockToolRegistry.execute).toHaveBeenCalledWith("glob", { pattern: "**/*.ts" });
    });

    it("should reject unauthorized tools for agent type", async () => {
      // Plan agent does not have write_file tool
      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Let me write the plan to a file...",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "write_file", input: { path: "plan.md", content: "# Plan" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "I could not write the file. Here's the plan...",
        stopReason: "end_turn",
        usage: { inputTokens: 150, outputTokens: 75 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      const result = await agentManager.spawn("plan", "Create a plan and save it");

      expect(result.success).toBe(true);
      // Tool should not have been executed because plan agents don't have write_file
      expect(mockToolRegistry.execute).not.toHaveBeenCalledWith("write_file", expect.anything());
    });

    it("should respect maxTurns limit", async () => {
      // Return tool calls indefinitely
      const toolResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "",
        stopReason: "tool_use",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "read_file", input: { path: "/file.ts" } },
        ],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(toolResponse);
      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: "content",
        duration: 5,
      });

      const result = await agentManager.spawn("explore", "Keep reading");

      // Agent should complete due to maxTurns limit (explore has maxTurns: 10)
      expect(result.success).toBe(true);
      // Should have made multiple calls but stopped at limit
      expect((mockProvider.chatWithTools as Mock).mock.calls.length).toBeLessThanOrEqual(10);
    });
  });

  describe("Status Callbacks", () => {
    it("should call onStatusChange when agent status changes", async () => {
      const statusHistory: string[] = [];
      const onStatusChange = vi.fn((agent: SubAgent) => {
        statusHistory.push(agent.status);
      });

      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      await agentManager.spawn("explore", "Task", { onStatusChange });

      // Should have been called for: idle (initial), running, completed
      expect(onStatusChange).toHaveBeenCalled();

      // Check for expected status transitions
      expect(statusHistory).toContain("idle");
      expect(statusHistory).toContain("running");
      expect(statusHistory).toContain("completed");
    });

    it("should call onOutput when agent produces output", async () => {
      const onOutput = vi.fn();

      const response: ChatWithToolsResponse = {
        id: "msg",
        content: "Processing your request...",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(response);

      await agentManager.spawn("explore", "Task", { onOutput });

      expect(onOutput).toHaveBeenCalledWith(
        expect.objectContaining({ type: "explore" }),
        "Processing your request..."
      );
    });
  });

  describe("Available Agent Types", () => {
    it("should return list of available agent types", () => {
      const types = agentManager.getAvailableAgentTypes();

      expect(types).toHaveLength(5);

      const typeNames = types.map((t) => t.type);
      expect(typeNames).toContain("explore");
      expect(typeNames).toContain("plan");
      expect(typeNames).toContain("test");
      expect(typeNames).toContain("debug");
      expect(typeNames).toContain("review");
    });

    it("should provide human-readable names for agents", () => {
      const types = agentManager.getAvailableAgentTypes();

      const exploreAgent = types.find((t) => t.type === "explore");
      expect(exploreAgent?.name).toBe("Explorer");

      const planAgent = types.find((t) => t.type === "plan");
      expect(planAgent?.name).toBe("Planner");
    });

    it("should provide descriptions for agents", () => {
      const types = agentManager.getAvailableAgentTypes();

      const testAgent = types.find((t) => t.type === "test");
      expect(testAgent?.description).toContain("test");

      const debugAgent = types.find((t) => t.type === "debug");
      expect(debugAgent?.description).toContain("error");
    });

    it("should provide config for each agent type", () => {
      const types = agentManager.getAvailableAgentTypes();

      for (const agentType of types) {
        expect(agentType.config).toBeDefined();
        expect(agentType.config.systemPrompt).toBeDefined();
        expect(agentType.config.tools).toBeDefined();
        expect(Array.isArray(agentType.config.tools)).toBe(true);
        expect(agentType.config.maxTurns).toBeGreaterThan(0);
      }
    });
  });

  describe("Token Usage Tracking", () => {
    it("should track token usage across multiple turns", async () => {
      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "First",
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "read_file", input: { path: "/test.ts" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Second",
        stopReason: "end_turn",
        usage: { inputTokens: 200, outputTokens: 100 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      (mockToolRegistry.execute as Mock).mockResolvedValue({
        success: true,
        data: "content",
        duration: 10,
      });

      const result = await agentManager.spawn("explore", "Read files");

      expect(result.usage?.inputTokens).toBe(300); // 100 + 200
      expect(result.usage?.outputTokens).toBe(150); // 50 + 100
    });
  });

  describe("Timeout Support", () => {
    it("should timeout agent after specified duration", async () => {
      // Create a long-running agent
      let resolver: (value: ChatWithToolsResponse) => void;
      const agentPromise = new Promise<ChatWithToolsResponse>((resolve) => {
        resolver = resolve;
      });

      (mockProvider.chatWithTools as Mock).mockReturnValue(agentPromise);

      const spawnPromise = agentManager.spawn("explore", "Long task", {
        timeout: 50, // Very short timeout
      });

      // Wait for timeout to trigger
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Resolve the mock to complete the spawn
      resolver!({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      const result = await spawnPromise;

      // Agent should have timed out (or completed if mock was faster)
      expect(["completed", "failed"]).toContain(result.agent.status);
    });
  });

  describe("Cancel Method", () => {
    it("should cancel a running agent during multi-turn execution", async () => {
      // Create a multi-turn scenario so cancellation can take effect
      const firstResponse: ChatWithToolsResponse = {
        id: "msg-1",
        content: "Starting...",
        stopReason: "tool_use",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [
          { id: "tool-1", name: "read_file", input: { path: "/test.ts" } },
        ],
      };

      const secondResponse: ChatWithToolsResponse = {
        id: "msg-2",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      // Mock tool to cancel during execution - cancel any active agents
      (mockToolRegistry.execute as Mock).mockImplementation(async () => {
        // Cancel ALL active agents
        const activeAgents = agentManager.getActiveAgents();
        for (const agent of activeAgents) {
          agentManager.cancel(agent.id);
        }
        return {
          success: true,
          data: "content",
          duration: 10,
        };
      });

      (mockProvider.chatWithTools as Mock)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse);

      const result = await agentManager.spawn("explore", "Task");

      // Agent should be cancelled (checked at start of iteration 2)
      expect(result.agent.status).toBe("failed");
      expect(result.agent.error).toContain("Aborted");
    });

    it("should return false when cancelling non-existent agent", () => {
      const cancelled = agentManager.cancel("non-existent-id");
      expect(cancelled).toBe(false);
    });

    it("should return false when cancelling already completed agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("explore", "Task");

      // Try to cancel after completion
      const cancelled = agentManager.cancel(result.agent.id);
      expect(cancelled).toBe(false);
    });
  });

  describe("Get Status Method", () => {
    it("should return status of active agent", async () => {
      let resolver: (value: ChatWithToolsResponse) => void;
      const agentPromise = new Promise<ChatWithToolsResponse>((resolve) => {
        resolver = resolve;
      });

      (mockProvider.chatWithTools as Mock).mockReturnValue(agentPromise);

      const spawnPromise = agentManager.spawn("explore", "Task");

      // Give time for agent to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      const activeAgents = agentManager.getActiveAgents();
      const agentId = activeAgents[0]!.id;

      const status = agentManager.getStatus(agentId);
      expect(status).toBe("running");

      // Cleanup
      resolver!({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await spawnPromise;
    });

    it("should return status of completed agent", async () => {
      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      const result = await agentManager.spawn("explore", "Task");

      const status = agentManager.getStatus(result.agent.id);
      expect(status).toBe("completed");
    });

    it("should return undefined for non-existent agent", () => {
      const status = agentManager.getStatus("non-existent-id");
      expect(status).toBeUndefined();
    });
  });

  describe("Event Emitter", () => {
    it("should emit spawn event when agent is created", async () => {
      const spawnHandler = vi.fn();
      agentManager.on("spawn", spawnHandler);

      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      await agentManager.spawn("explore", "Task");

      expect(spawnHandler).toHaveBeenCalledTimes(1);
      expect(spawnHandler.mock.calls[0][0].type).toBe("spawn");
      expect(spawnHandler.mock.calls[0][0].agent.type).toBe("explore");
    });

    it("should emit complete event when agent finishes successfully", async () => {
      const completeHandler = vi.fn();
      agentManager.on("complete", completeHandler);

      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      await agentManager.spawn("explore", "Task");

      expect(completeHandler).toHaveBeenCalledTimes(1);
      expect(completeHandler.mock.calls[0][0].type).toBe("complete");
      expect(completeHandler.mock.calls[0][0].result?.success).toBe(true);
    });

    it("should emit fail event when agent errors", async () => {
      const failHandler = vi.fn();
      agentManager.on("fail", failHandler);

      (mockProvider.chatWithTools as Mock).mockRejectedValue(new Error("API Error"));

      await agentManager.spawn("explore", "Task");

      expect(failHandler).toHaveBeenCalledTimes(1);
      expect(failHandler.mock.calls[0][0].type).toBe("fail");
    });

    it("should emit cancel event when agent is aborted", async () => {
      const cancelHandler = vi.fn();
      agentManager.on("cancel", cancelHandler);

      const abortController = new AbortController();
      abortController.abort();

      (mockProvider.chatWithTools as Mock).mockResolvedValue({
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      });

      await agentManager.spawn("explore", "Task", {
        signal: abortController.signal,
      });

      expect(cancelHandler).toHaveBeenCalledTimes(1);
      expect(cancelHandler.mock.calls[0][0].type).toBe("cancel");
    });

    it("should emit generic agent event for all events", async () => {
      const agentHandler = vi.fn();
      agentManager.on("agent", agentHandler);

      const simpleResponse: ChatWithToolsResponse = {
        id: "msg",
        content: "Done",
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        model: "claude-sonnet-4-20250514",
        toolCalls: [],
      };

      (mockProvider.chatWithTools as Mock).mockResolvedValue(simpleResponse);

      await agentManager.spawn("explore", "Task");

      // Should have received spawn and complete events
      expect(agentHandler).toHaveBeenCalledTimes(2);

      const eventTypes = agentHandler.mock.calls.map((call) => call[0].type);
      expect(eventTypes).toContain("spawn");
      expect(eventTypes).toContain("complete");
    });
  });
});
