/**
 * Tests for REPL main entry point
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...actual,
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
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: "",
    })),
    password: vi.fn().mockResolvedValue("test-api-key"),
    text: vi.fn().mockResolvedValue("test-text"),
  };
});

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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(true);
      vi.mocked(parseSlashCommand).mockReturnValue({
        command: "help",
        args: [],
      });
      vi.mocked(executeSlashCommand).mockResolvedValue(false);

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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
      };
      vi.mocked(createInputHandler).mockReturnValue(mockInputHandler);
      vi.mocked(isSlashCommand).mockReturnValue(true);
      vi.mocked(parseSlashCommand).mockReturnValue({
        command: "exit",
        args: [],
      });
      vi.mocked(executeSlashCommand).mockResolvedValue(true);

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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
        setSuffixText: vi.fn(),
        clearSuffixText: vi.fn(),
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

      expect(createSpinner).toHaveBeenCalledWith("Thinking...");
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
          trustedTools: [],
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
        enableBackgroundCapture: vi.fn(),
        disableBackgroundCapture: vi.fn(),
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
        setSuffixText: vi.fn(),
        clearSuffixText: vi.fn(),
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
});
