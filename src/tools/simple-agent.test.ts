import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the provider-bridge module BEFORE importing the tools
vi.mock("../agents/provider-bridge.js", () => ({
  getAgentProvider: vi.fn(),
  getAgentToolRegistry: vi.fn(),
}));

// Mock AgentExecutor class
vi.mock("../agents/executor.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    AgentExecutor: vi.fn().mockImplementation(() => ({
      execute: vi.fn(),
    })),
  };
});

import {
  spawnSimpleAgentTool,
  checkAgentCapabilityTool,
  simpleAgentTools,
} from "./simple-agent.js";
import { getAgentProvider, getAgentToolRegistry } from "../agents/provider-bridge.js";
import { AgentExecutor, AGENT_ROLES } from "../agents/executor.js";

const mockedGetAgentProvider = vi.mocked(getAgentProvider);
const mockedGetAgentToolRegistry = vi.mocked(getAgentToolRegistry);

describe("simple-agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("spawnSimpleAgentTool", () => {
    it("should have correct metadata", () => {
      expect(spawnSimpleAgentTool.name).toBe("spawnSimpleAgent");
      expect(spawnSimpleAgentTool.category).toBe("build");
      expect(spawnSimpleAgentTool.description).toContain("Spawn a sub-agent");
    });

    it("should return unavailable when provider is not initialized", async () => {
      mockedGetAgentProvider.mockReturnValue(null);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await spawnSimpleAgentTool.execute({
        task: "Write tests",
        role: "coder",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("unavailable");
      expect(parsed.success).toBe(false);
      expect(parsed.task).toBe("Write tests");
      expect(parsed.message).toContain("Agent provider not initialized");
      expect(result.exitCode).toBe(1);
      expect(result.duration).toBe(0);
    });

    it("should return unavailable when only provider is null", async () => {
      mockedGetAgentProvider.mockReturnValue(null);
      mockedGetAgentToolRegistry.mockReturnValue({} as any);

      const result = await spawnSimpleAgentTool.execute({
        task: "Analyze code",
        role: "reviewer",
        maxTurns: 5,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("unavailable");
      expect(parsed.success).toBe(false);
    });

    it("should return unavailable when only toolRegistry is null", async () => {
      mockedGetAgentProvider.mockReturnValue({} as any);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await spawnSimpleAgentTool.execute({
        task: "Fix bug",
        role: "coder",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("unavailable");
      expect(parsed.success).toBe(false);
    });

    it("should return error for unknown agent role", async () => {
      const mockProvider = { id: "test-provider" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const result = await spawnSimpleAgentTool.execute({
        task: "Do something",
        role: "unknown_role" as any,
        maxTurns: 5,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("error");
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain("Unknown agent role");
      expect(result.exitCode).toBe(1);
    });

    it("should execute agent successfully when provider is available", async () => {
      const mockProvider = { id: "test-provider" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const mockExecuteResult = {
        output: "Tests written successfully",
        success: true,
        turns: 3,
        toolsUsed: ["read_file", "write_file"],
        tokensUsed: 1500,
        duration: 5000,
      };

      const mockExecute = vi.fn().mockResolvedValue(mockExecuteResult);
      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: mockExecute,
          }) as any,
      );

      const result = await spawnSimpleAgentTool.execute({
        task: "Write unit tests",
        role: "tester",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("completed");
      expect(parsed.success).toBe(true);
      expect(parsed.output).toBe("Tests written successfully");
      expect(parsed.turns).toBe(3);
      expect(parsed.toolsUsed).toEqual(["read_file", "write_file"]);
      expect(parsed.tokensUsed).toBe(1500);
      expect(result.exitCode).toBe(0);
    });

    it("should return failed status when agent execution fails", async () => {
      const mockProvider = { id: "test-provider" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const mockExecuteResult = {
        output: "Agent reached maximum turns",
        success: false,
        turns: 10,
        toolsUsed: ["read_file"],
        tokensUsed: 3000,
        duration: 10000,
      };

      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: vi.fn().mockResolvedValue(mockExecuteResult),
          }) as any,
      );

      const result = await spawnSimpleAgentTool.execute({
        task: "Complex task",
        role: "coder",
        maxTurns: 10,
      });

      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("failed");
      expect(parsed.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should pass context to the agent executor when provided", async () => {
      const mockProvider = { id: "test-provider" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const mockExecute = vi.fn().mockResolvedValue({
        output: "Done",
        success: true,
        turns: 1,
        toolsUsed: [],
        tokensUsed: 100,
        duration: 500,
      });

      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: mockExecute,
          }) as any,
      );

      await spawnSimpleAgentTool.execute({
        task: "Write auth module",
        context: "Use JWT for authentication",
        role: "coder",
        maxTurns: 5,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ maxTurns: 5 }),
        expect.objectContaining({
          description: "Write auth module",
          context: { userContext: "Use JWT for authentication" },
        }),
      );
    });

    it("should pass undefined context when not provided", async () => {
      const mockProvider = { id: "test-provider" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const mockExecute = vi.fn().mockResolvedValue({
        output: "Done",
        success: true,
        turns: 1,
        toolsUsed: [],
        tokensUsed: 100,
        duration: 500,
      });

      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: mockExecute,
          }) as any,
      );

      await spawnSimpleAgentTool.execute({
        task: "Simple task",
        role: "coder",
        maxTurns: 10,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          context: undefined,
        }),
      );
    });

    it("should use maxTurns from input", async () => {
      const mockProvider = { id: "test-provider" } as any;
      const mockToolRegistry = {} as any;
      mockedGetAgentProvider.mockReturnValue(mockProvider);
      mockedGetAgentToolRegistry.mockReturnValue(mockToolRegistry);

      const mockExecute = vi.fn().mockResolvedValue({
        output: "Done",
        success: true,
        turns: 1,
        toolsUsed: [],
        duration: 100,
      });

      vi.mocked(AgentExecutor).mockImplementation(
        () =>
          ({
            execute: mockExecute,
          }) as any,
      );

      await spawnSimpleAgentTool.execute({
        task: "Quick task",
        role: "researcher",
        maxTurns: 3,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ maxTurns: 3 }),
        expect.anything(),
      );
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
      expect(parsed.features.parallelSpawn).toContain("requires provider");
      expect(parsed.features.multiTurnToolUse).toContain("requires provider");
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
      expect(parsed.features.parallelSpawn).toBe("ready");
      expect(parsed.features.multiTurnToolUse).toBe("ready");
      expect(parsed.availableRoles).toEqual(
        expect.arrayContaining(["coder", "tester", "reviewer"]),
      );
      expect(result.exitCode).toBe(0);
    });

    it("should report not ready when only provider is configured", async () => {
      mockedGetAgentProvider.mockReturnValue({ id: "test" } as any);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await checkAgentCapabilityTool.execute({});

      const parsed = JSON.parse(result.stdout);
      expect(parsed.ready).toBe(false);
      expect(parsed.providerConfigured).toBe(true);
      expect(parsed.toolRegistryConfigured).toBe(false);
    });

    it("should list all available roles from AGENT_ROLES", async () => {
      mockedGetAgentProvider.mockReturnValue(null);
      mockedGetAgentToolRegistry.mockReturnValue(null);

      const result = await checkAgentCapabilityTool.execute({});

      const parsed = JSON.parse(result.stdout);
      expect(parsed.availableRoles).toEqual(Object.keys(AGENT_ROLES));
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
