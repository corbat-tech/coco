import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the provider-bridge module BEFORE importing the tools
vi.mock("../agents/provider-bridge.js", () => ({
  getAgentProvider: vi.fn(),
  getAgentToolRegistry: vi.fn(),
  getAgentManager: vi.fn(),
}));

import {
  spawnSimpleAgentTool,
  checkAgentCapabilityTool,
  simpleAgentTools,
} from "./simple-agent.js";
import {
  getAgentProvider,
  getAgentToolRegistry,
  getAgentManager,
} from "../agents/provider-bridge.js";

const mockedGetAgentProvider = vi.mocked(getAgentProvider);
const mockedGetAgentToolRegistry = vi.mocked(getAgentToolRegistry);
const mockedGetAgentManager = vi.mocked(getAgentManager);

describe("simple-agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("spawnSimpleAgentTool", () => {
    it("should have correct metadata", () => {
      expect(spawnSimpleAgentTool.name).toBe("spawnSimpleAgent");
      expect(spawnSimpleAgentTool.category).toBe("build");
      expect(spawnSimpleAgentTool.description).toContain("Spawn a specialized sub-agent");
    });

    it("should return unavailable when agent manager is not initialized", async () => {
      mockedGetAgentManager.mockReturnValue(null);

      const result = await spawnSimpleAgentTool.execute({
        task: "Write tests",
        type: "test",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("unavailable");
      expect(parsed.success).toBe(false);
      expect(parsed.task).toBe("Write tests");
      expect(parsed.message).toContain("Agent provider not initialized");
      expect(result.exitCode).toBe(1);
    });

    it("should spawn agent with correct type via AgentManager", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-123" },
        success: true,
        output: "Tests written successfully",
        usage: { inputTokens: 1000, outputTokens: 500 },
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      const result = await spawnSimpleAgentTool.execute({
        task: "Write unit tests",
        type: "test",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("completed");
      expect(parsed.success).toBe(true);
      expect(parsed.agentType).toBe("test");
      expect(parsed.output).toBe("Tests written successfully");
      expect(result.exitCode).toBe(0);

      // Verify spawn was called with correct type
      expect(mockSpawn).toHaveBeenCalledWith("test", "Write unit tests", expect.any(Object));
    });

    it("should map legacy 'researcher' role to 'explore' type", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-456" },
        success: true,
        output: "Research complete",
        usage: { inputTokens: 500, outputTokens: 200 },
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      const result = await spawnSimpleAgentTool.execute({
        task: "Explore the codebase",
        role: "researcher",
        maxTurns: 5,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.agentType).toBe("explore");
      expect(mockSpawn).toHaveBeenCalledWith("explore", expect.any(String), expect.any(Object));
    });

    it("should map legacy 'coder' role to 'debug' type", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-789" },
        success: true,
        output: "Code written",
        usage: {},
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      await spawnSimpleAgentTool.execute({
        task: "Fix auth bug",
        role: "coder",
        maxTurns: 10,
      });

      expect(mockSpawn).toHaveBeenCalledWith("debug", expect.any(String), expect.any(Object));
    });

    it("should prefer 'type' over 'role' when both are provided", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-abc" },
        success: true,
        output: "Done",
        usage: {},
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      await spawnSimpleAgentTool.execute({
        task: "Review security",
        type: "security",
        role: "reviewer",
        maxTurns: 5,
      });

      expect(mockSpawn).toHaveBeenCalledWith("security", expect.any(String), expect.any(Object));
    });

    it("should prepend context to task description when provided", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-ctx" },
        success: true,
        output: "Done",
        usage: {},
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      await spawnSimpleAgentTool.execute({
        task: "Write auth module",
        context: "Use JWT for authentication",
        type: "debug",
        maxTurns: 5,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "debug",
        "Write auth module\n\nAdditional context: Use JWT for authentication",
        expect.any(Object),
      );
    });

    it("should return failed status when agent execution fails", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-fail" },
        success: false,
        output: "Agent reached maximum turns",
        usage: {},
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      const result = await spawnSimpleAgentTool.execute({
        task: "Complex task",
        type: "refactor",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("failed");
      expect(parsed.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should default to 'explore' when no type or role specified", async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        agent: { id: "test-agent-default" },
        success: true,
        output: "Done",
        usage: {},
      });

      mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

      await spawnSimpleAgentTool.execute({
        task: "Do something",
        maxTurns: 5,
      });

      expect(mockSpawn).toHaveBeenCalledWith("explore", expect.any(String), expect.any(Object));
    });

    it("should support all 12 agent types", async () => {
      const types = [
        "explore",
        "plan",
        "test",
        "debug",
        "review",
        "architect",
        "security",
        "tdd",
        "refactor",
        "e2e",
        "docs",
        "database",
      ];

      for (const type of types) {
        const mockSpawn = vi.fn().mockResolvedValue({
          agent: { id: `agent-${type}` },
          success: true,
          output: `${type} done`,
          usage: {},
        });

        mockedGetAgentManager.mockReturnValue({ spawn: mockSpawn } as any);

        const result = await spawnSimpleAgentTool.execute({
          task: `Task for ${type}`,
          type: type as any,
          maxTurns: 5,
        });

        const parsed = JSON.parse(result.stdout);
        expect(parsed.agentType).toBe(type);
        expect(parsed.success).toBe(true);
      }
    });
  });

  describe("checkAgentCapabilityTool", () => {
    it("should have correct metadata", () => {
      expect(checkAgentCapabilityTool.name).toBe("checkAgentCapability");
      expect(checkAgentCapabilityTool.category).toBe("build");
    });

    it("should report not ready when provider is not configured", async () => {
      mockedGetAgentProvider.mockReturnValue(null);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await checkAgentCapabilityTool.execute({});

      const parsed = JSON.parse(result.stdout);
      expect(parsed.multiAgentSupported).toBe(true);
      expect(parsed.providerConfigured).toBe(false);
      expect(parsed.toolRegistryConfigured).toBe(false);
      expect(parsed.ready).toBe(false);
      expect(parsed.features.taskDelegation).toContain("requires provider");
      expect(parsed.features.specializedAgents).toContain("requires provider");
      expect(result.exitCode).toBe(0);
    });

    it("should report ready when both provider and registry are configured", async () => {
      mockedGetAgentProvider.mockReturnValue({ id: "test" } as any);
      mockedGetAgentToolRegistry.mockReturnValue({} as any);

      const result = await checkAgentCapabilityTool.execute({});

      const parsed = JSON.parse(result.stdout);
      expect(parsed.ready).toBe(true);
      expect(parsed.providerConfigured).toBe(true);
      expect(parsed.toolRegistryConfigured).toBe(true);
      expect(parsed.features.taskDelegation).toBe("ready");
      expect(parsed.features.specializedAgents).toBe("ready");
      expect(parsed.availableTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "explore" }),
          expect.objectContaining({ type: "plan" }),
          expect.objectContaining({ type: "review" }),
        ]),
      );
      expect(result.exitCode).toBe(0);
    });

    it("should list all 12 agent types", async () => {
      mockedGetAgentProvider.mockReturnValue(null);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await checkAgentCapabilityTool.execute({});

      const parsed = JSON.parse(result.stdout);
      expect(parsed.availableTypes).toHaveLength(12);
      const typeNames = parsed.availableTypes.map((t: any) => t.type);
      expect(typeNames).toContain("explore");
      expect(typeNames).toContain("architect");
      expect(typeNames).toContain("security");
      expect(typeNames).toContain("database");
    });
  });

  describe("simpleAgentTools export", () => {
    it("should export both tools", () => {
      expect(simpleAgentTools).toHaveLength(2);
      expect(simpleAgentTools[0]?.name).toBe("spawnSimpleAgent");
      expect(simpleAgentTools[1]?.name).toBe("checkAgentCapability");
    });
  });
});
