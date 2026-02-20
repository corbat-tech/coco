/**
 * Tests for REPL main entry point
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import type { LLMProvider } from "../../providers/types.js";

// Mock providers
vi.mock("../../providers/index.js", () => ({
  createProvider: vi.fn(),
}));

vi.mock("./session.js", () => ({
  createSession: vi.fn(),
  initializeSessionTrust: vi.fn().mockResolvedValue(undefined),
  initializeContextManager: vi.fn(),
  checkAndCompactContext: vi.fn().mockResolvedValue(null),
  getContextUsagePercent: vi.fn(() => 50),
  loadTrustedTools: vi.fn().mockResolvedValue(new Set()),
  saveTrustedTool: vi.fn().mockResolvedValue(undefined),
  removeTrustedTool: vi.fn().mockResolvedValue(undefined),
  saveDeniedTool: vi.fn().mockResolvedValue(undefined),
  removeDeniedTool: vi.fn().mockResolvedValue(undefined),
  getDeniedTools: vi.fn().mockResolvedValue([]),
  getAllTrustedTools: vi.fn().mockResolvedValue({ global: [], project: [], denied: [] }),
}));

// Mock recommended-permissions to skip suggestion in tests
vi.mock("./recommended-permissions.js", () => ({
  shouldShowPermissionSuggestion: vi.fn().mockResolvedValue(false),
  showPermissionSuggestion: vi.fn().mockResolvedValue(undefined),
}));

// Mock trust-store to always return trusted (prevents interactive prompts)
vi.mock("./trust-store.js", () => ({
  createTrustStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    isTrusted: vi.fn().mockReturnValue(true), // Always trusted
    getLevel: vi.fn().mockReturnValue("full"),
    touch: vi.fn().mockResolvedValue(undefined),
    addTrust: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock onboarding to skip interactive setup
vi.mock("./onboarding-v2.js", () => ({
  ensureConfiguredV2: vi.fn((config) => Promise.resolve(config)),
}));

// Mock clack prompts to prevent interactive prompts hanging
// Note: pure mock without importOriginal to avoid loading the real module in a forked process
// (clack's stdin initialization can cause OOM when stdin is a pipe)
vi.mock("@clack/prompts", () => ({
  log: {
    message: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  select: vi.fn().mockResolvedValue("write"),
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: vi.fn().mockReturnValue(false),
  outro: vi.fn(),
  intro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  password: vi.fn().mockResolvedValue("test-api-key"),
  text: vi.fn().mockResolvedValue("test-text"),
  multiselect: vi.fn().mockResolvedValue([]),
  groupMultiselect: vi.fn().mockResolvedValue({}),
  note: vi.fn(),
  cancel: vi.fn(),
}));

// Mock state manager
vi.mock("./state/index.js", () => ({
  getStateManager: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({}),
    getSuggestion: vi.fn().mockResolvedValue("Start by typing a message"),
  })),
  formatStateStatus: vi.fn(() => "Ready"),
  getStateSummary: vi.fn(() => ({ spec: false, architecture: false, implementation: false })),
}));

// Mock intent recognizer
vi.mock("./intent/index.js", () => ({
  createIntentRecognizer: vi.fn(() => ({
    recognize: vi.fn().mockResolvedValue({ type: "chat", confidence: 0.0, entities: {} }),
    intentToCommand: vi.fn(),
    shouldAutoExecute: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock("../../tools/allowed-paths.js", () => ({
  loadAllowedPaths: vi.fn().mockResolvedValue(undefined),
}));

// Mock coco-mode to prevent systemPrompt access on unmocked session.config.agent
vi.mock("./coco-mode.js", () => ({
  isCocoMode: vi.fn().mockReturnValue(false),
  loadCocoModePreference: vi.fn().mockResolvedValue(undefined),
  looksLikeFeatureRequest: vi.fn().mockReturnValue(false),
  wasHintShown: vi.fn().mockReturnValue(true),
  markHintShown: vi.fn(),
  formatCocoHint: vi.fn().mockReturnValue(""),
  formatQualityResult: vi.fn().mockReturnValue(""),
  getCocoModeSystemPrompt: vi.fn().mockReturnValue(""),
}));

// Mock version-check to prevent network calls
vi.mock("./version-check.js", () => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./input/handler.js", () => ({
  createInputHandler: vi.fn(),
}));

vi.mock("./output/renderer.js", () => ({
  renderStreamChunk: vi.fn(),
  renderToolStart: vi.fn(),
  renderToolEnd: vi.fn(),
  renderUsageStats: vi.fn(),
  renderError: vi.fn(),
  renderInfo: vi.fn(),
}));

vi.mock("./output/spinner.js", () => ({
  createSpinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    update: vi.fn(),
    fail: vi.fn(),
    setToolCount: vi.fn(),
    getElapsed: vi.fn().mockReturnValue(0),
  })),
}));

vi.mock("./agent-loop.js", () => ({
  executeAgentTurn: vi.fn(),
  formatAbortSummary: vi.fn(),
}));

vi.mock("../../tools/index.js", () => ({
  createFullToolRegistry: vi.fn(() => ({
    getAll: vi.fn(() => []),
    get: vi.fn(),
  })),
}));

vi.mock("../../agents/provider-bridge.js", () => ({
  setAgentProvider: vi.fn(),
  setAgentToolRegistry: vi.fn(),
}));

// Mock unified skill registry to prevent filesystem scanning (discoverAllSkills)
vi.mock("../../skills/index.js", () => ({
  createUnifiedSkillRegistry: vi.fn(() => ({
    setConfig: vi.fn(),
    discoverAndRegister: vi.fn().mockResolvedValue(undefined),
    config: { autoActivate: false },
    findRelevantSkills: vi.fn().mockReturnValue([]),
    deactivateSkill: vi.fn(),
    activateSkill: vi.fn().mockResolvedValue(true),
    size: 0,
    getAllMetadata: vi.fn().mockReturnValue([]),
  })),
  discoverAllSkills: vi.fn().mockResolvedValue([]),
  scanSkillsDirectory: vi.fn().mockResolvedValue([]),
  matchSkills: vi.fn().mockReturnValue([]),
}));

// Mock REPL builtin skills to prevent loading ship/review/diff implementations
vi.mock("./skills/index.js", () => ({
  createDefaultRegistry: vi.fn(() => ({
    register: vi.fn(),
    execute: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  })),
  getBuiltinSkillsForDiscovery: vi.fn().mockReturnValue([]),
  createSkillRegistry: vi.fn(() => ({
    register: vi.fn(),
    execute: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  })),
  createHelpSkill: vi.fn().mockReturnValue({ name: "help", execute: vi.fn() }),
  clearSkill: { name: "clear", execute: vi.fn() },
  statusSkill: { name: "status", execute: vi.fn() },
  compactSkill: { name: "compact", execute: vi.fn() },
  reviewSkill: { name: "review", execute: vi.fn() },
  diffSkill: { name: "diff", execute: vi.fn() },
  shipSkill: { name: "ship", execute: vi.fn() },
  openSkill: { name: "open", execute: vi.fn() },
}));

// Mock stack detector to prevent filesystem operations
vi.mock("./context/stack-detector.js", () => ({
  detectProjectStack: vi
    .fn()
    .mockResolvedValue({ type: "node", language: "typescript", frameworks: [] }),
}));

// Mock config loader used in skill registry setup
vi.mock("../../config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({ skills: undefined }),
}));

// Mock MCP lifecycle manager
vi.mock("../../mcp/lifecycle.js", () => ({
  createMCPServerManager: vi.fn(() => ({
    startAll: vi.fn().mockResolvedValue(new Map()),
    stopAll: vi.fn().mockResolvedValue(undefined),
    getConnectedServers: vi.fn().mockReturnValue([]),
  })),
  getMCPServerManager: vi.fn(),
}));

// Mock MCP registry
vi.mock("../../mcp/registry.js", () => ({
  MCPRegistryImpl: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    listEnabledServers: vi.fn().mockReturnValue([]),
    listServers: vi.fn().mockReturnValue([]),
    addServer: vi.fn().mockResolvedValue(undefined),
    removeServer: vi.fn().mockResolvedValue(true),
    getServer: vi.fn().mockReturnValue(undefined),
    hasServer: vi.fn().mockReturnValue(false),
  })),
  createMCPRegistry: vi.fn(),
}));

// Mock MCP tools registration
vi.mock("../../mcp/tools.js", () => ({
  registerMCPTools: vi.fn().mockResolvedValue([]),
  wrapMCPTool: vi.fn(),
  wrapMCPTools: vi.fn(),
  createToolsFromMCPServer: vi.fn(),
  jsonSchemaToZod: vi.fn(),
}));

// Mock modules that are now lazy-loaded inside startRepl()
vi.mock("./interruptions/llm-classifier.js", () => ({
  createLLMClassifier: vi.fn(() => ({
    classify: vi.fn().mockResolvedValue({ action: "continue", source: "keywords" }),
  })),
}));

vi.mock("./full-access-mode.js", () => ({
  loadFullAccessPreference: vi.fn().mockResolvedValue(undefined),
  isFullAccessEnabled: vi.fn().mockReturnValue(false),
  isCommandSafeForFullAccess: vi.fn().mockReturnValue(false),
}));

vi.mock("./input/concurrent-capture-v2.js", () => ({
  createConcurrentCapture: vi.fn(() => ({
    start: vi.fn().mockReturnValue([]),
    stop: vi.fn().mockReturnValue([]),
    reset: vi.fn(),
    suspend: vi.fn(),
    resumeCapture: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    onMessage: vi.fn(),
  })),
}));

vi.mock("./feedback/feedback-system.js", () => ({
  createFeedbackSystem: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    updateSpinnerMessage: vi.fn(),
    onFeedback: vi.fn(),
  })),
}));

vi.mock("./input/input-echo.js", () => ({
  createInputEcho: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn().mockReturnValue(false),
    clear: vi.fn(),
    reset: vi.fn(),
    refreshWith: vi.fn(),
    render: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
  })),
}));

vi.mock("./commands/index.js", () => ({
  isSlashCommand: vi.fn(),
  parseSlashCommand: vi.fn(),
  executeSlashCommand: vi.fn(),
  addTokenUsage: vi.fn(),
  hasPendingImage: vi.fn().mockReturnValue(false),
  consumePendingImage: vi.fn().mockReturnValue(null),
  setPendingImage: vi.fn(),
}));

describe("REPL index", () => {
  const originalExit = process.exit;
  const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
    // Remove all process listeners added by startRepl() to prevent leaks between tests
    process.removeAllListeners("exit");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    // NOTE: vi.resetModules() was removed — it caused OOM by creating a fresh module graph
    // per test (~15 graphs × module sizes = 3-4 GB heap). vi.clearAllMocks() in beforeEach
    // is sufficient to reset mock state between tests without duplicating module instances.
  });

  afterAll(() => {
    mockConsoleLog.mockRestore();
  });

  describe("startRepl", () => {
    it("should exit if provider is not available", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const p = await import("@clack/prompts");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(false),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      // Mock process.exit to throw so we can verify it was called
      const exitError = new Error("process.exit called");
      (process.exit as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw exitError;
      });

      // Still need to mock input handler in case exit doesn't stop
      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);

      const { startRepl } = await import("./index.js");

      await expect(startRepl({ projectPath: "/test" })).rejects.toThrow("process.exit called");

      // Now uses p.log.error instead of renderError
      expect(p.log.error).toHaveBeenCalledWith(
        "❌ Provider is not available. Your API key may be invalid.",
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("should print welcome message and start input loop", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { createFullToolRegistry } = await import("../../tools/index.js");
      const { setAgentProvider, setAgentToolRegistry } =
        await import("../../agents/provider-bridge.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce(null), // EOF on first call
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      const mockRegistry = { getAll: vi.fn(() => []), get: vi.fn() };
      vi.mocked(createFullToolRegistry).mockReturnValue(mockRegistry as any);

      const { startRepl } = await import("./index.js");
      await startRepl();

      // Should print welcome
      expect(mockConsoleLog).toHaveBeenCalled();
      // Should call close on exit
      expect(mockInputHandler.close).toHaveBeenCalled();
      expect(setAgentProvider).toHaveBeenCalledWith(mockProvider);
      expect(setAgentToolRegistry).toHaveBeenCalledWith(mockRegistry);
    });

    it("should skip empty input", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { executeAgentTurn } = await import("./agent-loop.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi
          .fn()
          .mockResolvedValueOnce("") // Empty input
          .mockResolvedValueOnce(null), // Then EOF
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);

      const { startRepl } = await import("./index.js");
      await startRepl();

      // Should not call agent turn for empty input
      expect(executeAgentTurn).not.toHaveBeenCalled();
    });

    it("should handle slash commands", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand, parseSlashCommand, executeSlashCommand } =
        await import("./commands/index.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("/help").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(true);
      vi.mocked(parseSlashCommand).mockReturnValue({
        command: "help",
        args: [],
      });
      vi.mocked(executeSlashCommand).mockResolvedValue({ shouldExit: false });

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(executeSlashCommand).toHaveBeenCalledWith("help", [], expect.any(Object));
    });

    it("should exit on slash command that returns true", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand, parseSlashCommand, executeSlashCommand } =
        await import("./commands/index.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("/exit"),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(true);
      vi.mocked(parseSlashCommand).mockReturnValue({
        command: "exit",
        args: [],
      });
      vi.mocked(executeSlashCommand).mockResolvedValue({ shouldExit: true });

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(mockInputHandler.close).toHaveBeenCalled();
    });

    it("should execute agent turn for regular input", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { addTokenUsage } = await import("./commands/index.js");
      const { renderUsageStats } = await import("./output/renderer.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("Hello").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);
      vi.mocked(executeAgentTurn).mockResolvedValue({
        content: "Hello!",
        usage: { inputTokens: 10, outputTokens: 20 },
        toolCalls: [],
        aborted: false,
        iterations: 1,
      });

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(executeAgentTurn).toHaveBeenCalled();
      expect(addTokenUsage).toHaveBeenCalledWith(10, 20);
      expect(renderUsageStats).toHaveBeenCalledWith(10, 20, 0);
    });

    it("should handle aborted agent turn", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn, formatAbortSummary } = await import("./agent-loop.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("Do something").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);
      vi.mocked(executeAgentTurn).mockResolvedValue({
        content: "",
        usage: { inputTokens: 5, outputTokens: 0 },
        toolCalls: [{ name: "file_read", input: {}, output: "..." }],
        aborted: true,
        iterations: 1,
      });
      vi.mocked(formatAbortSummary).mockReturnValue("Aborted: 1 tool ran");

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(formatAbortSummary).toHaveBeenCalled();
    });

    it("should handle agent turn errors", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { renderError } = await import("./output/renderer.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("trigger error").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);
      vi.mocked(executeAgentTurn).mockRejectedValue(new Error("Network error"));

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(renderError).toHaveBeenCalledWith("Network error");
    });

    it("should handle AbortError silently", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { renderError } = await import("./output/renderer.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("abort").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);

      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      vi.mocked(executeAgentTurn).mockRejectedValue(abortError);

      const { startRepl } = await import("./index.js");
      await startRepl();

      // AbortError should not render an error
      expect(renderError).not.toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { renderError } = await import("./output/renderer.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("throw string").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);
      vi.mocked(executeAgentTurn).mockRejectedValue("string error");

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(renderError).toHaveBeenCalledWith("string error");
    });

    it("should pass config options to session", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/custom",
        config: {
          provider: { type: "openai", model: "gpt-4", maxTokens: 8192 },
          autoConfirm: true,
          trustedTools: ["file_read"],
          maxIterations: 5,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);

      const { startRepl } = await import("./index.js");
      await startRepl({
        projectPath: "/custom",
        config: { autoConfirm: true },
      });

      expect(createSession).toHaveBeenCalledWith("/custom", { autoConfirm: true });
    });

    it("should call onThinkingStart and onThinkingEnd callbacks", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { createSpinner } = await import("./output/spinner.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("test input").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);

      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
        clear: vi.fn(),
        update: vi.fn(),
        fail: vi.fn(),
        setToolCount: vi.fn(),
      };
      vi.mocked(createSpinner).mockReturnValue(mockSpinner);

      // Capture callbacks and call them
      vi.mocked(executeAgentTurn).mockImplementation(
        async (_session, _input, _provider, _registry, options) => {
          // Call thinking callbacks
          options?.onThinkingStart?.();
          options?.onThinkingEnd?.();
          return {
            content: "Response",
            usage: { inputTokens: 10, outputTokens: 20 },
            toolCalls: [],
            aborted: false,
            iterations: 1,
          };
        },
      );

      const { startRepl } = await import("./index.js");
      await startRepl();

      // First thinking call includes the input hint; subsequent calls use plain "Thinking..."
      expect(createSpinner).toHaveBeenCalledWith(expect.stringContaining("Thinking..."));
      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it("should call onToolStart, onToolEnd, and onToolSkipped callbacks", async () => {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");
      const { isSlashCommand } = await import("./commands/index.js");
      const { executeAgentTurn } = await import("./agent-loop.js");
      const { createSpinner } = await import("./output/spinner.js");
      const { renderToolStart, renderToolEnd } = await import("./output/renderer.js");

      const mockProvider: Partial<LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };

      vi.mocked(createProvider).mockResolvedValue(mockProvider as LLMProvider);
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const mockInputHandler = {
        prompt: vi.fn().mockResolvedValueOnce("run tools").mockResolvedValueOnce(null),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(false);

      const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
        clear: vi.fn(),
        update: vi.fn(),
        fail: vi.fn(),
        setToolCount: vi.fn(),
        getElapsed: vi.fn().mockReturnValue(0),
      };
      vi.mocked(createSpinner).mockReturnValue(mockSpinner);

      // Capture callbacks and call them
      vi.mocked(executeAgentTurn).mockImplementation(
        async (_session, _input, _provider, _registry, options) => {
          // Call tool callbacks
          const toolCall = { name: "file_read", input: { path: "/test" } };
          options?.onToolStart?.(toolCall);
          const toolResult = {
            name: "file_read",
            input: { path: "/test" },
            output: "content",
          };
          options?.onToolEnd?.(toolResult);
          options?.onToolSkipped?.(toolCall, "denied by user");
          return {
            content: "Response",
            usage: { inputTokens: 10, outputTokens: 20 },
            toolCalls: [toolResult],
            aborted: false,
            iterations: 1,
          };
        },
      );

      const { startRepl } = await import("./index.js");
      await startRepl();

      expect(createSpinner).toHaveBeenCalledWith("Running file_read…");
      expect(renderToolStart).toHaveBeenCalledWith("file_read", {
        path: "/test",
      });
      expect(renderToolEnd).toHaveBeenCalled();
    });
  });

  describe("MCP initialization", () => {
    /** Helper: build a minimal working session + provider + input handler mock setup */
    async function setupMinimalRepl(overrides?: {
      inputPromptValues?: (string | null)[];
    }) {
      const { createProvider } = await import("../../providers/index.js");
      const { createSession } = await import("./session.js");
      const { createInputHandler } = await import("./input/handler.js");

      const mockProvider: Partial<import("../../providers/types.js").LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };
      vi.mocked(createProvider).mockResolvedValue(
        mockProvider as import("../../providers/types.js").LLMProvider,
      );
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });

      const promptValues = overrides?.inputPromptValues ?? [null];
      const mockInputHandler = {
        prompt: vi.fn(),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      for (const val of promptValues) {
        mockInputHandler.prompt.mockResolvedValueOnce(val);
      }
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);

      return { mockInputHandler };
    }

    it("skips MCP init when registry has no enabled servers", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");
      const { createMCPServerManager } = await import("../../mcp/lifecycle.js");

      // Registry returns empty list of enabled servers
      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockResolvedValue(undefined),
            listEnabledServers: vi.fn().mockReturnValue([]),
          }) as any,
      );

      await setupMinimalRepl();

      const { startRepl } = await import("./index.js");
      await startRepl({ projectPath: "/test" });

      // createMCPServerManager should NOT be called when there are no enabled servers
      expect(createMCPServerManager).not.toHaveBeenCalled();
    });

    it("starts MCP servers and registers tools when servers are configured", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");
      const { createMCPServerManager } = await import("../../mcp/lifecycle.js");
      const { registerMCPTools } = await import("../../mcp/tools.js");
      const { createFullToolRegistry } = await import("../../tools/index.js");

      const fakeClient = { isConnected: vi.fn().mockReturnValue(true), listTools: vi.fn() };
      const fakeConnection = { name: "test-server", client: fakeClient };
      const connectionsMap = new Map([["test-server", fakeConnection]]);

      const mockManager = {
        startAll: vi.fn().mockResolvedValue(connectionsMap),
        stopAll: vi.fn().mockResolvedValue(undefined),
        getConnectedServers: vi.fn().mockReturnValue(["test-server"]),
      };
      vi.mocked(createMCPServerManager).mockReturnValue(mockManager as any);

      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockResolvedValue(undefined),
            listEnabledServers: vi.fn().mockReturnValue([
              {
                name: "test-server",
                transport: "stdio",
                enabled: true,
                stdio: { command: "node", args: ["server.js"] },
              },
            ]),
          }) as any,
      );

      const mockRegistry = {
        getAll: vi.fn(() => []),
        get: vi.fn(),
        register: vi.fn(),
      };
      vi.mocked(createFullToolRegistry).mockReturnValue(mockRegistry as any);
      vi.mocked(registerMCPTools).mockResolvedValue([]);

      await setupMinimalRepl();

      const { startRepl } = await import("./index.js");
      await startRepl({ projectPath: "/test" });

      // MCP server manager should have been created and startAll called
      expect(createMCPServerManager).toHaveBeenCalled();
      expect(mockManager.startAll).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: "test-server" })]),
      );
      // registerMCPTools should have been called for the connected server
      expect(registerMCPTools).toHaveBeenCalledWith(expect.anything(), "test-server", fakeClient);
    });

    it("continues REPL startup if MCP initialization fails", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");

      // Make registry.load() throw to simulate MCP init failure
      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockRejectedValue(new Error("Registry file corrupted")),
            listEnabledServers: vi.fn().mockReturnValue([]),
          }) as any,
      );

      await setupMinimalRepl();

      const { startRepl } = await import("./index.js");

      // REPL should start normally despite MCP failure — no process.exit from MCP error
      await expect(startRepl({ projectPath: "/test" })).resolves.toBeUndefined();
      // process.exit should not have been called due to MCP failure
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("calls mcpManager.stopAll() when SIGTERM is received", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");
      const { createMCPServerManager } = await import("../../mcp/lifecycle.js");

      const mockMcpManager = {
        startAll: vi.fn().mockResolvedValue(new Map()),
        stopAll: vi.fn().mockResolvedValue(undefined),
        getConnectedServers: vi.fn().mockReturnValue([]),
      };
      vi.mocked(createMCPServerManager).mockReturnValue(mockMcpManager as any);

      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockResolvedValue(undefined),
            listEnabledServers: vi.fn().mockReturnValue([
              {
                name: "sigterm-server",
                transport: "stdio",
                enabled: true,
                stdio: { command: "node", args: ["server.js"] },
              },
            ]),
          }) as any,
      );

      // Prompt will block until we resolve it; we control it via a deferred promise
      let resolvePrompt!: (value: null) => void;
      const promptBarrier = new Promise<null>((resolve) => {
        resolvePrompt = resolve;
      });
      const { createInputHandler } = await import("./input/handler.js");
      const { createSession } = await import("./session.js");
      const { createProvider } = await import("../../providers/index.js");

      const mockProvider: Partial<import("../../providers/types.js").LLMProvider> = {
        isAvailable: vi.fn().mockResolvedValue(true),
        chat: vi.fn(),
        chatWithTools: vi.fn(),
      };
      vi.mocked(createProvider).mockResolvedValue(
        mockProvider as import("../../providers/types.js").LLMProvider,
      );
      vi.mocked(createSession).mockReturnValue({
        projectPath: "/test",
        config: {
          provider: { type: "anthropic", model: "claude-3", maxTokens: 4096 },
          autoConfirm: false,
          trustedTools: new Set<string>(),
          maxIterations: 10,
        },
        messages: [],
        startTime: new Date(),
        tokenUsage: { input: 0, output: 0 },
      });
      const mockInputHandler = {
        prompt: vi.fn().mockReturnValue(promptBarrier),
        close: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);

      const { startRepl } = await import("./index.js");

      // Start REPL without awaiting — it will block at prompt()
      const replPromise = startRepl({ projectPath: "/test" });

      // Allow the event loop to run so startRepl registers the SIGTERM handler
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Emit SIGTERM — triggers cleanup: stopAll() then process.exit(0)
      process.emit("SIGTERM");

      // Wait for the stopAll + finally chain to settle
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(mockMcpManager.stopAll).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);

      // Unblock prompt so replPromise can settle (process.exit is mocked — REPL keeps running)
      resolvePrompt(null);
      await replPromise;
    });

    it("warns and continues when registerMCPTools throws for a specific server", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");
      const { createMCPServerManager } = await import("../../mcp/lifecycle.js");
      const { registerMCPTools } = await import("../../mcp/tools.js");

      const fakeClient = { isConnected: vi.fn().mockReturnValue(true), listTools: vi.fn() };
      const fakeConnection = { name: "failing-server", client: fakeClient };
      const connectionsMap = new Map([["failing-server", fakeConnection]]);

      const mockMcpManager = {
        startAll: vi.fn().mockResolvedValue(connectionsMap),
        stopAll: vi.fn().mockResolvedValue(undefined),
        getConnectedServers: vi.fn().mockReturnValue(["failing-server"]),
      };
      vi.mocked(createMCPServerManager).mockReturnValue(mockMcpManager as any);

      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockResolvedValue(undefined),
            listEnabledServers: vi.fn().mockReturnValue([
              {
                name: "failing-server",
                transport: "stdio",
                enabled: true,
                stdio: { command: "node", args: ["server.js"] },
              },
            ]),
          }) as any,
      );

      // registerMCPTools throws for this server
      vi.mocked(registerMCPTools).mockRejectedValue(new Error("Tool registration failed"));

      await setupMinimalRepl();

      const { startRepl } = await import("./index.js");

      // REPL should start normally despite registerMCPTools throwing
      await expect(startRepl({ projectPath: "/test" })).resolves.toBeUndefined();
      // process.exit should not have been called due to the tool registration error
      expect(process.exit).not.toHaveBeenCalled();
    });

    it("handles startAll throwing without leaking the manager", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");
      const { createMCPServerManager } = await import("../../mcp/lifecycle.js");

      const mockMcpManager = {
        startAll: vi.fn().mockRejectedValue(new Error("Failed to start servers")),
        stopAll: vi.fn().mockResolvedValue(undefined),
        getConnectedServers: vi.fn().mockReturnValue([]),
      };
      vi.mocked(createMCPServerManager).mockReturnValue(mockMcpManager as any);

      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockResolvedValue(undefined),
            listEnabledServers: vi.fn().mockReturnValue([
              {
                name: "broken-server",
                transport: "stdio",
                enabled: true,
                stdio: { command: "node", args: ["server.js"] },
              },
            ]),
          }) as any,
      );

      await setupMinimalRepl();

      const { startRepl } = await import("./index.js");

      // REPL should start normally despite startAll throwing
      await expect(startRepl({ projectPath: "/test" })).resolves.toBeUndefined();
      // stopAll should have been called as part of partial-start cleanup
      expect(mockMcpManager.stopAll).toHaveBeenCalled();
    });

    it("calls mcpManager.stopAll() on normal REPL exit (EOF)", async () => {
      const { MCPRegistryImpl } = await import("../../mcp/registry.js");
      const { createMCPServerManager } = await import("../../mcp/lifecycle.js");
      const { registerMCPTools } = await import("../../mcp/tools.js");

      const fakeClient = { isConnected: vi.fn().mockReturnValue(true), listTools: vi.fn() };
      const fakeConnection = { name: "eof-server", client: fakeClient };
      const connectionsMap = new Map([["eof-server", fakeConnection]]);

      const mockMcpManager = {
        startAll: vi.fn().mockResolvedValue(connectionsMap),
        stopAll: vi.fn().mockResolvedValue(undefined),
        getConnectedServers: vi.fn().mockReturnValue(["eof-server"]),
      };
      vi.mocked(createMCPServerManager).mockReturnValue(mockMcpManager as any);

      vi.mocked(MCPRegistryImpl).mockImplementation(
        () =>
          ({
            load: vi.fn().mockResolvedValue(undefined),
            listEnabledServers: vi.fn().mockReturnValue([
              {
                name: "eof-server",
                transport: "stdio",
                enabled: true,
                stdio: { command: "node", args: ["server.js"] },
              },
            ]),
          }) as any,
      );

      vi.mocked(registerMCPTools).mockResolvedValue([]);

      // Simulate normal exit: prompt returns null (EOF) on first call
      await setupMinimalRepl({ inputPromptValues: [null] });

      const { startRepl } = await import("./index.js");

      await expect(startRepl({ projectPath: "/test" })).resolves.toBeUndefined();

      // mcpManager.stopAll() should be called on normal REPL exit
      expect(mockMcpManager.stopAll).toHaveBeenCalled();
    });
  });
});
