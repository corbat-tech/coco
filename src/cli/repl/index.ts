/**
 * REPL main entry point
 */

import chalk from "chalk";
import stringWidth from "string-width";
import {
  createSession,
  initializeSessionTrust,
  initializeSessionMemory,
  initializeContextManager,
  checkAndCompactContext,
  getContextUsagePercent,
  loadTrustedTools,
} from "./session.js";
import { createInputHandler } from "./input/handler.js";
import { InterruptionAction, InterruptionType } from "./interruptions/types.js";
import type { ActionedInterruption } from "./interruptions/types.js";
import {
  renderStreamChunk,
  renderToolStart,
  renderToolEnd,
  renderUsageStats,
  renderError,
  renderInfo,
} from "./output/renderer.js";
import { createSpinner, type Spinner } from "./output/spinner.js";
import { executeAgentTurn, formatAbortSummary, summarizeToolResults } from "./agent-loop.js";
import {
  isAbortError,
  humanizeProviderError,
  installProcessSafetyNet,
  MAX_CONSECUTIVE_ERRORS,
  isNonRetryableProviderError,
  getUserFacingProviderError,
} from "./error-resilience.js";
import { createProvider, type ProviderType } from "../../providers/index.js";
import { createFullToolRegistry } from "../../tools/index.js";
import { setAgentProvider, setAgentToolRegistry } from "../../agents/provider-bridge.js";
import {
  isSlashCommand,
  parseSlashCommand,
  executeSlashCommand,
  addTokenUsage,
  hasPendingImage,
  consumePendingImages,
  isIntentRecognitionEnabled,
} from "./commands/index.js";
import type {
  MessageContent,
  ImageContent,
  TextContent,
  LLMProvider,
} from "../../providers/types.js";
import type { ReplConfig } from "./types.js";
import type { MCPServerManager, ServerConnection } from "../../mcp/lifecycle.js";
import { VERSION } from "../../version.js";
import { createTrustStore, type TrustLevel } from "./trust-store.js";
import * as p from "@clack/prompts";
import { createIntentRecognizer, type Intent } from "./intent/index.js";
import { ensureConfiguredV2 } from "./onboarding-v2.js";
import { getDefaultModel, getInternalProviderId } from "../../config/env.js";
import { loadAllowedPaths } from "../../tools/allowed-paths.js";
import {
  shouldShowPermissionSuggestion,
  showPermissionSuggestion,
} from "./recommended-permissions.js";
import {
  isQualityLoop,
  loadQualityLoopPreference,
  looksLikeFeatureRequest,
  wasHintShown,
  markHintShown,
  formatQualityLoopHint,
  formatQualityResult,
  getQualityLoopSystemPrompt,
  parseQualityLoopReport,
} from "./quality-loop.js";
import { getGitContext, formatGitLine, type GitContext } from "./git-context.js";
import { renderStatusBar } from "./status-bar.js";
import {
  registerGlobalCleanup,
  killOrphanedTestProcesses,
} from "../../utils/subprocess-registry.js";
import { looksLikeTechnicalJargon, humanizeWithLLM } from "../../utils/error-humanizer.js";
import type { HookRegistryInterface, HookExecutor } from "./hooks/index.js";

// stringWidth (from 'string-width') is the industry-standard way to measure
// visual terminal width of strings.  It correctly handles ANSI codes, emoji
// (including ZWJ sequences), CJK, and grapheme clusters via Intl.Segmenter.

/**
 * Start the REPL
 */
export async function startRepl(
  options: {
    projectPath?: string;
    config?: Partial<ReplConfig>;
  } = {},
): Promise<void> {
  const projectPath = options.projectPath ?? process.cwd();

  // Register global subprocess cleanup handlers (idempotent — safe to call multiple times)
  registerGlobalCleanup();

  // Best-effort: kill any vitest/jest workers left over from a previous crash
  killOrphanedTestProcesses().catch(() => {});

  // Create session
  const session = await createSession(projectPath, options.config);

  // Load persisted trust settings
  await initializeSessionTrust(session);

  // Check project trust
  const trustApproved = await checkProjectTrust(projectPath);
  if (!trustApproved) {
    process.exit(1);
  }

  // Ensure provider is configured (onboarding if needed)
  const configured = await ensureConfiguredV2(session.config);
  if (!configured) {
    p.log.message(chalk.dim("\n\u{1F44B} Setup cancelled. See you next time!"));
    process.exit(0);
  }

  // Update session with configured provider
  session.config = configured;

  // Initialize provider
  // Use internal provider ID (e.g., "codex" for "openai" with OAuth)
  const internalProviderId = getInternalProviderId(session.config.provider.type);
  let provider: LLMProvider;
  try {
    provider = await createProvider(internalProviderId, {
      model: session.config.provider.model || undefined,
      maxTokens: session.config.provider.maxTokens,
    });
  } catch (error) {
    p.log.error(
      `Failed to initialize provider: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  // Check provider availability
  const available = await provider.isAvailable();
  if (!available) {
    p.log.error("\u274C Provider is not available. Your API key may be invalid.");
    p.log.message(chalk.dim("\nTo reconfigure, run: coco --setup"));
    process.exit(1);
  }

  // Initialize context manager and LLM classifier for concurrent input
  initializeContextManager(session, provider);
  const { createLLMClassifier } = await import("./interruptions/llm-classifier.js");
  let llmClassifier = createLLMClassifier(provider);

  // Detect project stack and load allowed paths in parallel — both depend only
  // on projectPath and have no shared writes between them or with the steps above.
  const { detectProjectStack } = await import("./context/stack-detector.js");
  const [projectContext] = await Promise.all([
    detectProjectStack(projectPath),
    loadAllowedPaths(projectPath),
  ]);
  session.projectContext = projectContext;

  // Initialize memory (AGENTS.md, COCO.md, CLAUDE.md)
  await initializeSessionMemory(session);

  // Show recommended permissions suggestion for first-time users
  if (await shouldShowPermissionSuggestion()) {
    await showPermissionSuggestion();
    // Reload trust into session after potential changes
    const updatedTrust = await loadTrustedTools(projectPath);
    for (const tool of updatedTrust) {
      session.trustedTools.add(tool);
    }
  }

  // Load quality loop, full-access mode, and full-power-risk mode preferences in
  // parallel — all read different keys from the same config file and write to
  // separate module-level variables with no shared state between them.
  const { loadFullAccessPreference } = await import("./full-access-mode.js");
  const { loadFullPowerRiskPreference } = await import("./full-power-risk-mode.js");
  await Promise.all([
    loadQualityLoopPreference(),
    loadFullAccessPreference(),
    loadFullPowerRiskPreference(),
  ]);

  // Initialize tool registry
  const toolRegistry = createFullToolRegistry();
  setAgentProvider(provider);
  setAgentToolRegistry(toolRegistry);

  // Initialize unified skill registry (discover skills across all scopes)
  try {
    const { createUnifiedSkillRegistry } = await import("../../skills/index.js");
    const { getBuiltinSkillsForDiscovery } = await import("./skills/index.js");
    const { loadConfig: loadCocoConfig } = await import("../../config/loader.js");
    session.skillRegistry = createUnifiedSkillRegistry();
    // Wire skills config from CocoConfig if available
    try {
      const cocoConfig = await loadCocoConfig();
      if (cocoConfig.skills) {
        session.skillRegistry.setConfig(cocoConfig.skills);
      }
    } catch {
      // Config not available — use defaults (all enabled, no overrides)
    }
    await session.skillRegistry.discoverAndRegister(projectPath, getBuiltinSkillsForDiscovery());
  } catch (skillError) {
    // Skills initialization failed (e.g. corrupt SKILL.md) — continue without skills
    const logger = (await import("../../utils/logger.js")).getLogger();
    logger.warn(
      `[Skills] Failed to initialize skills: ${skillError instanceof Error ? skillError.message : String(skillError)}`,
    );
  }

  // Initialize MCP servers (non-fatal — REPL starts even if MCP fails)
  let mcpManager: MCPServerManager | null = null;
  const logger = (await import("../../utils/logger.js")).getLogger();
  try {
    const { getMCPServerManager } = await import("../../mcp/lifecycle.js");
    const { MCPRegistryImpl } = await import("../../mcp/registry.js");
    const { registerMCPTools } = await import("../../mcp/tools.js");

    const mcpRegistry = new MCPRegistryImpl();
    await mcpRegistry.load();
    const registryServers = mcpRegistry.listEnabledServers();

    // Also load project-level .mcp.json (standard cross-agent format — Claude Code, Cursor, Windsurf)
    const { loadProjectMCPFile, mergeMCPConfigs } = await import("../../mcp/config-loader.js");
    const projectServers = await loadProjectMCPFile(process.cwd());
    const enabledServers = mergeMCPConfigs(
      registryServers,
      projectServers.filter((s) => s.enabled !== false),
    );

    if (enabledServers.length > 0) {
      mcpManager = getMCPServerManager();
      let connections: Map<string, ServerConnection>;
      try {
        connections = await mcpManager.startAll(enabledServers);
      } catch (startError) {
        logger.warn(
          `[MCP] Failed to start servers: ${startError instanceof Error ? startError.message : String(startError)}`,
        );
        try {
          await mcpManager.stopAll();
        } catch {
          // Ignore errors during partial-start cleanup
        }
        mcpManager = null;
        connections = new Map();
      }

      // Register tools from each successfully connected server
      for (const connection of connections.values()) {
        try {
          await registerMCPTools(toolRegistry, connection.name, connection.client);
        } catch (toolError) {
          logger.warn(
            `[MCP] Failed to register tools for server '${connection.name}': ${toolError instanceof Error ? toolError.message : String(toolError)}`,
          );
        }
      }

      const activeCount = connections.size;
      if (activeCount > 0) {
        logger.info(`[MCP] ${activeCount} MCP server(s) active`);
      }

      const failedServers = enabledServers
        .map((s) => s.name)
        .filter((name) => !connections.has(name));
      if (failedServers.length > 0) {
        p.log.warn(
          `MCP startup check: ${failedServers.length} server(s) failed to connect: ${failedServers.join(", ")}`,
        );
        p.log.message(chalk.dim("Run /mcp health <name> to inspect details."));
      }
    }
  } catch (mcpError) {
    logger.warn(
      `[MCP] Initialization failed: ${mcpError instanceof Error ? mcpError.message : String(mcpError)}`,
    );
  }

  // Load lifecycle hooks from .coco/hooks.json (non-fatal — REPL starts even if hooks fail)
  let hookRegistry: HookRegistryInterface | undefined;
  let hookExecutor: HookExecutor | undefined;
  try {
    const hooksConfigPath = `${projectPath}/.coco/hooks.json`;
    const { createHookRegistry, createHookExecutor } = await import("./hooks/index.js");
    const registry = createHookRegistry();
    await registry.loadFromFile(hooksConfigPath);
    if (registry.size > 0) {
      hookRegistry = registry;
      hookExecutor = createHookExecutor();
      logger.info(`[Hooks] Loaded ${registry.size} hook(s) from ${hooksConfigPath}`);
    }
  } catch (hookError) {
    // File not found is expected (no hooks configured) — only warn on unexpected errors
    const msg = hookError instanceof Error ? hookError.message : String(hookError);
    if (!msg.includes("ENOENT")) {
      logger.warn(`[Hooks] Failed to load hooks: ${msg}`);
    }
  }

  // Create input handler
  const inputHandler = createInputHandler(session);

  // Initialize concurrent input capture, feedback system, and input echo
  const { createConcurrentCapture } = await import("./input/concurrent-capture-v2.js");
  const { createFeedbackSystem } = await import("./feedback/feedback-system.js");
  const { createInputEcho } = await import("./input/input-echo.js");
  const concurrentCapture = createConcurrentCapture();
  let currentSpinnerMessage = "";
  // activeSpinner is declared per-turn; feedbackSystem needs a getter
  let turnActiveSpinner: Spinner | null = null;
  const feedbackSystem = createFeedbackSystem(() => turnActiveSpinner);
  const inputEcho = createInputEcho(
    () => turnActiveSpinner,
    () => currentSpinnerMessage,
  );

  // Pending interruption context from previous turn (injected into next message)
  let pendingInterruptionContext = "";
  // Human-readable summary of the modification (for display only, not sent to LLM)
  let pendingModificationPreview = "";
  // Messages queued during concurrent capture for auto-submission as next turn
  let pendingQueuedMessages: string[] = [];

  // Track auto-activated skill IDs so we only deactivate those (not manual ones)
  const autoActivatedIds = new Set<string>();

  // Initialize intent recognizer
  const intentRecognizer = createIntentRecognizer();

  // Fetch git context (concurrent — no added latency since provider init already awaited)
  let gitContext: GitContext | null = await getGitContext(projectPath);

  // Print welcome
  await printWelcome(session, gitContext, mcpManager);

  // Ensure terminal state is restored on exit (bracketed paste, raw mode, etc.)
  const cleanupTerminal = () => {
    process.stdout.write("\x1b[?2004l"); // Disable bracketed paste
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
  };
  process.once("exit", cleanupTerminal);
  const sigtermHandler = () => {
    // Don't call cleanupTerminal() here — the "exit" listener handles it
    const cleanup = mcpManager ? mcpManager.stopAll() : Promise.resolve();
    cleanup.catch(() => {}).finally(() => process.exit(0));
  };
  process.once("SIGTERM", sigtermHandler);

  // Install process-level safety net: prevents uncaught exceptions / unhandled
  // rejections from crashing the Coco process. The REPL loop continues after logging.
  installProcessSafetyNet();

  // Track whether the 75%/90% context warnings have been shown (reset after compaction)
  let warned75 = false;
  let warned90 = false;

  // Consecutive error recovery counter.
  // Incremented on each catch-block recovery attempt; reset to 0 on any
  // successful agent turn. After MAX_CONSECUTIVE_ERRORS the REPL gives up
  // and shows the error to the user instead of re-queuing.
  let consecutiveErrors = 0;
  const AUTO_SWITCH_THRESHOLD = 2;
  const autoSwitchHistory = new Set<string>();
  const enableAutoSwitchProvider = session.config.agent.enableAutoSwitchProvider === true;

  const buildReplayMessage = (message: string | MessageContent): string | null => {
    if (typeof message === "string") {
      const trimmed = message.trim();
      return trimmed.length > 0 ? message : null;
    }

    const textParts: string[] = [];
    let imageCount = 0;
    for (const block of message) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) {
        textParts.push(block.text.trim());
      } else if (block.type === "image") {
        imageCount++;
      }
    }

    const text = textParts.join("\n\n").trim();
    if (text.length > 0) {
      if (imageCount > 0) {
        return (
          `${text}\n\n` +
          `[System: The original request included ${imageCount} image(s). ` +
          `Use the image context already provided in this conversation.]`
        );
      }
      return text;
    }

    if (imageCount > 0) {
      return (
        `[System: Retry the previous image-based user request (${imageCount} image(s)). ` +
        `Use the existing image context in the conversation and do not repeat the same failed action.]`
      );
    }

    return null;
  };

  const showRecoveryAlternatives = (): void => {
    console.log(chalk.yellow("   Choose how to continue:"));
    console.log(chalk.dim("   1. /provider  → switch provider"));
    console.log(chalk.dim("   2. /model     → switch model"));
    console.log(chalk.dim("   3. Retry with a narrower scope/task"));
    console.log(chalk.dim("   4. If needed, share constraints so Coco can adapt strategy"));
    if (!enableAutoSwitchProvider) {
      console.log(chalk.dim("   5. (Optional) enable `agent.enableAutoSwitchProvider` in config"));
    }
  };

  const getAutoSwitchCandidates = (current: ProviderType): ProviderType[] => {
    const ordered: ProviderType[] = [];
    const push = (p: ProviderType): void => {
      if (p !== current && !ordered.includes(p)) ordered.push(p);
    };

    // First, try closely-related providers.
    if (current === "openai") {
      push("codex");
      push("kimi");
      push("openrouter");
    } else if (current === "codex") {
      push("openai");
      push("openrouter");
      push("anthropic");
    } else if (current === "anthropic") {
      push("openai");
      push("codex");
      push("gemini");
    } else if (current === "gemini") {
      push("openai");
      push("codex");
      push("anthropic");
    } else if (current === "kimi") {
      push("openai");
      push("codex");
      push("openrouter");
    }

    // Then, generic fallback order.
    const genericOrder: ProviderType[] = [
      "codex",
      "openai",
      "anthropic",
      "gemini",
      "kimi",
      "openrouter",
      "deepseek",
      "groq",
      "mistral",
      "together",
      "qwen",
      "lmstudio",
      "ollama",
    ];
    for (const p of genericOrder) push(p);
    return ordered;
  };

  const attemptAutoProviderSwitch = async (
    reason: string,
    originalMessage: string | null,
  ): Promise<boolean> => {
    if (!originalMessage) return false;

    const currentType = session.config.provider.type;
    const candidates = getAutoSwitchCandidates(currentType);

    for (const candidate of candidates) {
      const edge = `${currentType}->${candidate}`;
      if (autoSwitchHistory.has(edge)) continue;

      try {
        const nextInternalId = getInternalProviderId(candidate);
        const nextProvider = await createProvider(nextInternalId, {
          maxTokens: session.config.provider.maxTokens,
        });
        const ok = await nextProvider.isAvailable();
        if (!ok) {
          autoSwitchHistory.add(edge);
          continue;
        }

        provider = nextProvider;
        session.config.provider.type = candidate;
        session.config.provider.model = getDefaultModel(candidate);
        setAgentProvider(provider);
        initializeContextManager(session, provider);
        llmClassifier = createLLMClassifier(provider);
        autoSwitchHistory.add(edge);

        console.log(
          chalk.cyan(
            `   ↺ Auto-switched provider: ${currentType} → ${candidate} (${reason.slice(0, 80)})`,
          ),
        );
        return true;
      } catch {
        autoSwitchHistory.add(edge);
      }
    }

    return false;
  };

  // Main loop
  while (true) {
    // Auto-submit queued messages from concurrent capture (skip prompt)
    let autoInput: string | null = null;
    if (pendingQueuedMessages.length > 0) {
      autoInput = pendingQueuedMessages.join("\n");
      pendingQueuedMessages = [];

      // Show contextual feedback: Modify re-send vs Queue auto-submit
      // NOTE: trailing console.log() is intentional — it acts as a buffer line
      // so the Ora spinner (which clears the line above it) doesn't erase the preview.
      if (pendingInterruptionContext) {
        const modPreview =
          pendingModificationPreview.length > 70
            ? pendingModificationPreview.slice(0, 67) + "\u2026"
            : pendingModificationPreview;
        console.log(
          chalk.yellow(`\n\u26A1 Re-sending with modification: `) + chalk.dim(modPreview),
        );
        console.log();
      } else {
        const preview = autoInput.length > 70 ? autoInput.slice(0, 67) + "\u2026" : autoInput;
        console.log(chalk.cyan(`\n\uD83D\uDCCB Auto-sending queued message:`));
        console.log(chalk.dim(`  ${preview}`));
        console.log();
      }
    }

    const input = autoInput ?? (await inputHandler.prompt());

    // Handle EOF (Ctrl+D) -- but not if Ctrl+V set a pending image
    if (input === null && !hasPendingImage()) {
      console.log(chalk.dim("\nGoodbye!"));
      break;
    }

    // Skip empty input -- but not if Ctrl+V set a pending image
    if (!input && !hasPendingImage()) continue;

    // Handle bare exit keywords (without the leading slash)
    // Users often type "exit" or "quit" instead of "/exit" — treat them the same.
    if (input && ["exit", "quit", "q"].includes(input.trim().toLowerCase())) {
      console.log(chalk.dim("\nGoodbye!"));
      break;
    }

    // Handle slash commands
    let agentMessage: string | MessageContent | null = null;

    if (input && isSlashCommand(input)) {
      const prevProviderType = session.config.provider.type;
      const prevProviderModel = session.config.provider.model;

      const { command, args } = parseSlashCommand(input);
      const commandResult = await executeSlashCommand(command, args, session);
      if (commandResult.shouldExit) break;

      // Re-initialize provider if /provider or /model changed it
      if (
        session.config.provider.type !== prevProviderType ||
        session.config.provider.model !== prevProviderModel
      ) {
        try {
          const newInternalId = getInternalProviderId(session.config.provider.type);
          provider = await createProvider(newInternalId, {
            model: session.config.provider.model || undefined,
            maxTokens: session.config.provider.maxTokens,
          });
          setAgentProvider(provider);
          initializeContextManager(session, provider);
        } catch (err) {
          // Provider re-init failed — revert session config to previous values so
          // session.config stays consistent with the active provider object
          session.config.provider.type = prevProviderType;
          session.config.provider.model = prevProviderModel;
          renderError(
            `Failed to switch provider: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // If the skill returned a forkPrompt, inject it as the next agent message
      if (commandResult.forkPrompt) {
        agentMessage = commandResult.forkPrompt;
        // Don't skip the agent turn — let it process the forked skill instructions
      } else if (hasPendingImage()) {
        // Check if slash command queued a multimodal message (e.g., /image)
        const images = consumePendingImages();
        // Combine user input text with image prompts
        const imagePrompts = images.map((img) => img.prompt).join("\n");
        const userText = input?.trim() || "";
        const combinedText = userText ? `${userText}\n\n${imagePrompts}`.trim() : imagePrompts;
        agentMessage = [
          ...images.map(
            (img) =>
              ({
                type: "image",
                source: { type: "base64", media_type: img.media_type, data: img.data },
              }) as ImageContent,
          ),
          {
            type: "text",
            text: combinedText,
          } as TextContent,
        ];
        // Fall through to agent turn execution below
      } else {
        continue;
      }
    }

    // Check if Ctrl+V set a pending image (outside slash command flow)
    // This must run before intent recognition to avoid passing empty/null input
    if (agentMessage === null && hasPendingImage()) {
      const images = consumePendingImages();
      // Combine user input text with image prompts
      const imagePrompts = images.map((img) => img.prompt).join("\n");
      const userText = input?.trim() || "";
      const combinedText = userText ? `${userText}\n\n${imagePrompts}`.trim() : imagePrompts;
      agentMessage = [
        ...images.map(
          (img) =>
            ({
              type: "image",
              source: { type: "base64", media_type: img.media_type, data: img.data },
            }) as ImageContent,
        ),
        {
          type: "text",
          text: combinedText,
        } as TextContent,
      ];
    }

    // Detect intent from natural language (skip for image-only messages and when disabled)
    if (agentMessage === null && input && isIntentRecognitionEnabled()) {
      const intent = await intentRecognizer.recognize(input);

      // If intent is not chat and has good confidence, offer to execute as command
      if (intent.type !== "chat" && intent.confidence >= 0.6) {
        const shouldExecute = await handleIntentConfirmation(intent, intentRecognizer);
        if (shouldExecute) {
          const { command, args } = intentRecognizer.intentToCommand(intent)!;
          const intentResult = await executeSlashCommand(command, args, session);
          if (intentResult.shouldExit) break;
          if (intentResult.forkPrompt) {
            agentMessage = intentResult.forkPrompt;
            // Fall through to agent turn to process forked skill instructions
          } else {
            continue;
          }
        }
        // If user chose not to execute, fall through to normal chat
      }
    }

    // Use agentMessage if set by /image or Ctrl+V, otherwise use the raw text input
    if (agentMessage === null) {
      agentMessage = input ?? "";
    }

    // Save the original user message before any context injection.
    // Used to re-send the task when user modifies during execution.
    const originalUserMessage = typeof agentMessage === "string" ? agentMessage : null;
    const replayUserMessage = buildReplayMessage(agentMessage);

    // Auto-activate relevant skills based on user message
    if (
      session.skillRegistry &&
      session.skillRegistry.config.autoActivate !== false &&
      typeof agentMessage === "string" &&
      agentMessage.length > 0
    ) {
      const matches = session.skillRegistry.findRelevantSkills(agentMessage, 3, 0.4);
      const mdMatches = matches.filter((m) => m.skill.kind === "markdown");

      if (mdMatches.length > 0) {
        // Only deactivate previously auto-activated skills, preserve manual ones
        for (const id of autoActivatedIds) {
          session.skillRegistry.deactivateSkill(id);
        }
        autoActivatedIds.clear();
        const activated: string[] = [];
        for (const match of mdMatches) {
          const ok = await session.skillRegistry.activateSkill(match.skill.id);
          if (ok) {
            activated.push(match.skill.name);
            autoActivatedIds.add(match.skill.id);
          }
        }
        if (activated.length > 0) {
          renderInfo(`Skills: ${activated.join(", ")}`);
        }
      }
    }

    // Inject any pending interruption context from the previous turn
    if (pendingInterruptionContext && typeof agentMessage === "string") {
      agentMessage = agentMessage + pendingInterruptionContext;
      pendingInterruptionContext = "";
      pendingModificationPreview = "";
    }

    // Execute agent turn
    // Single spinner for all states - avoids concurrent spinner issues
    let activeSpinner: Spinner | null = null;
    turnActiveSpinner = null;

    // Helper to safely clear spinner - defined outside try for access in catch
    // NOTE: Does NOT clear the echo buffer — the echo will re-attach to the
    // next spinner via refresh(). Only explicit inputEcho.clear() resets the buffer
    // (used on Enter, SIGINT, errors).
    const clearSpinner = () => {
      if (activeSpinner) {
        activeSpinner.clear();
        activeSpinner = null;
        turnActiveSpinner = null;
      }
    };

    // Helper to set spinner message (creates if needed)
    // Merges base message + echo into a single spinner.update() to avoid
    // double-render flickering (one update instead of two).
    const setSpinner = (message: string) => {
      currentSpinnerMessage = message;
      feedbackSystem.updateSpinnerMessage(message);
      if (activeSpinner) {
        // Let inputEcho handle the single merged update (base + echo in one call)
        inputEcho.refreshWith(message);
      } else {
        activeSpinner = createSpinner(message);
        activeSpinner.start();
        turnActiveSpinner = activeSpinner;
        inputEcho.refreshWith(message);
      }
    };

    // Thinking progress feedback - evolving messages while LLM processes
    let thinkingInterval: NodeJS.Timeout | null = null;
    let thinkingStartTime: number | null = null;

    const clearThinkingInterval = () => {
      if (thinkingInterval) {
        clearInterval(thinkingInterval);
        thinkingInterval = null;
      }
      thinkingStartTime = null;
    };

    // Create abort controller for Ctrl+C cancellation (outside try for catch access)
    const abortController = new AbortController();
    let wasAborted = false;

    const sigintHandler = () => {
      wasAborted = true;
      abortController.abort();
      inputEcho.clear();
      concurrentCapture.stop();
      feedbackSystem.reset();
      clearThinkingInterval();
      clearSpinner();
      renderInfo("\nOperation cancelled");
    };

    // Declared outside try so finally block can access it for restoration
    let originalSystemPrompt: string | undefined;

    // Snapshot session message length before the turn starts.
    // Used in the catch block to roll back any partial messages written by
    // executeAgentTurn before it threw, keeping session.messages consistent.
    const preCallMessageLength = session.messages.length;

    try {
      // Show contextual hint for first feature-like prompt when quality loop is off
      if (
        typeof agentMessage === "string" &&
        !isQualityLoop() &&
        !wasHintShown() &&
        looksLikeFeatureRequest(agentMessage)
      ) {
        markHintShown();
        console.log(formatQualityLoopHint());
      }

      console.log(); // Blank line before response

      // If quality loop is active, route through the coco-fix-iterate skill (if available)
      // or fall back to text protocol injection
      let cocoForkPrompt: string | undefined;

      if (isQualityLoop()) {
        const skillId = "coco-fix-iterate";
        const skillAvailable = session.skillRegistry?.has(skillId);

        if (skillAvailable && typeof agentMessage === "string") {
          // Integrated mode: route through the real quality-loop skill
          const skillResult = await session.skillRegistry!.execute(skillId, agentMessage, {
            cwd: session.projectPath,
            session,
            config: session.config,
          });
          if (skillResult.shouldFork && skillResult.output) {
            cocoForkPrompt = skillResult.output;
          }
        } else {
          // Fallback: text protocol injection (when skill not discovered)
          originalSystemPrompt = session.config.agent.systemPrompt;
          session.config.agent.systemPrompt =
            originalSystemPrompt + "\n" + getQualityLoopSystemPrompt();
        }
      }

      // Use skill-prepared prompt if available, otherwise use original message
      const effectiveMessage = cocoForkPrompt ?? agentMessage;

      // Pause normal input handler and start concurrent capture
      // This allows the user to type messages during agent execution
      inputHandler.pause();

      // Track actioned interruptions and queued messages for this turn
      const turnActionedInterruptions: ActionedInterruption[] = [];
      const turnQueuedMessages: string[] = [];
      // Track steering messages that are injected mid-turn without aborting
      const turnSteeringMessages: string[] = [];
      // Track pending LLM classification promises so we can await them after agent completes
      const pendingClassifications: Promise<void>[] = [];
      // Track async LLM error-explanation promises (fire-and-forget, printed as hints)
      const pendingExplanations: Array<Promise<string | null>> = [];

      concurrentCapture.reset();
      inputEcho.reset();
      concurrentCapture.start(
        (msg) => {
          // Step 1: Clear echo line (user pressed Enter, buffer is now empty)
          inputEcho.clear();

          const preview = msg.text.length > 60 ? msg.text.slice(0, 57) + "\u2026" : msg.text;
          console.log(chalk.dim(`  \u2026 Classifying: ${preview}`));

          // Step 2: Launch LLM classification (async, tracked for later await)
          const classificationPromise = (async () => {
            const classification = await llmClassifier.classify(msg, originalUserMessage);
            const action = classification.action;
            const sourceHint = classification.source === "keywords" ? chalk.dim(" (fast)") : "";

            // Step 3: Execute the classified action
            switch (action) {
              case InterruptionAction.Abort:
                wasAborted = true;
                abortController.abort();
                console.log(chalk.red(`  \u23F9 Aborting\u2026`) + sourceHint);
                break;

              case InterruptionAction.Modify:
                turnActionedInterruptions.push({
                  text: msg.text,
                  type: InterruptionType.Modify,
                  confidence: classification.source === "llm" ? 0.95 : 0.7,
                  timestamp: msg.timestamp,
                  action: InterruptionAction.Modify,
                });
                // Abort current execution so the task restarts with modification
                wasAborted = true;
                abortController.abort();
                console.log(chalk.yellow(`  \u26A1 Modifying: `) + chalk.dim(preview) + sourceHint);
                break;

              case InterruptionAction.Steer:
                turnSteeringMessages.push(msg.text);
                console.log(
                  chalk.magenta(`  \uD83C\uDFAF Steering: `) + chalk.dim(preview) + sourceHint,
                );
                break;

              case InterruptionAction.Queue:
                turnQueuedMessages.push(msg.text);
                console.log(
                  chalk.cyan(`  \uD83D\uDCCB Queued: `) + chalk.dim(preview) + sourceHint,
                );
                break;
            }
          })();

          pendingClassifications.push(classificationPromise);
        },
        (buffer) => inputEcho.render(buffer),
      );

      process.once("SIGINT", sigintHandler);

      // Track if we've cleared the spinner for this turn's streaming phase
      let streamStarted = false;
      // Track LLM call count and last tool category for contextual spinner messages
      let llmCallCount = 0;
      let lastToolGroup: string | null = null;

      const result = await executeAgentTurn(session, effectiveMessage, provider, toolRegistry, {
        onStream: (chunk) => {
          // Clear any lingering spinner on first text chunk to avoid overlap
          if (!streamStarted) {
            streamStarted = true;
            clearSpinner();
          }
          renderStreamChunk(chunk);
        },
        onToolStart: (tc, index, total) => {
          // Update spinner with descriptive message about what tool is doing
          const desc = getToolRunningDescription(
            tc.name,
            (tc.input ?? {}) as Record<string, unknown>,
          );
          const msg = total > 1 ? `${desc} [${index}/${total}]` : desc;
          setSpinner(msg);
        },
        onToolEnd: (result) => {
          // For tools taking >3s, show a "Done" checkmark so the user
          // gets clear feedback that the operation completed successfully.
          // For very fast tools, just clear the spinner silently.
          const elapsed =
            activeSpinner && typeof activeSpinner.getElapsed === "function"
              ? activeSpinner.getElapsed()
              : 0;
          if (elapsed >= 3) {
            // Show completion with elapsed time — any non-trivial operation.
            // Clear echo first so the placeholder line isn't baked into the permanent log.
            inputEcho.clear();
            activeSpinner?.stop();
            activeSpinner = null;
            turnActiveSpinner = null;
          } else {
            clearSpinner();
          }
          renderToolStart(result.name, result.input);
          renderToolEnd(result);
          // Track tool category for contextual thinking spinner messages
          lastToolGroup = getToolGroup(result.name);
          // Fire async LLM explanation for errors that look technically opaque
          if (
            !result.result.success &&
            result.result.error &&
            looksLikeTechnicalJargon(result.result.error)
          ) {
            pendingExplanations.push(humanizeWithLLM(result.result.error, result.name, provider));
          }
          // Show waiting spinner while LLM processes the result
          // In quality loop mode, add hint that quality checks may follow
          if (isQualityLoop() && llmCallCount > 0) {
            setSpinner(`Processing results (iter. ${llmCallCount})...`);
          } else if (isQualityLoop()) {
            setSpinner("Processing results & checking quality...");
          } else {
            setSpinner("Processing...");
          }
        },
        onToolSkipped: (tc, reason) => {
          clearSpinner();
          console.log(chalk.yellow(`\u2298 Skipped ${tc.name}: ${reason}`));
        },
        onThinkingStart: () => {
          llmCallCount++;
          // Build contextual initial message using iteration count + last tool context
          const iterPrefix = isQualityLoop() && llmCallCount > 1 ? `Iter. ${llmCallCount} · ` : "";
          const afterText = lastToolGroup ? `after ${lastToolGroup} · ` : "";
          setSpinner(`${iterPrefix}${afterText}Thinking...`);
          thinkingStartTime = Date.now();
          thinkingInterval = setInterval(() => {
            if (!thinkingStartTime) return;
            const elapsed = Math.floor((Date.now() - thinkingStartTime) / 1000);
            if (elapsed < 4) return;

            // Show quality loop feedback if active, with iteration context
            const prefix = isQualityLoop() && llmCallCount > 1 ? `Iter. ${llmCallCount} · ` : "";
            if (isQualityLoop()) {
              if (elapsed < 8) setSpinner(`${prefix}Analyzing results...`);
              else if (elapsed < 15) setSpinner(`${prefix}Running quality checks...`);
              else if (elapsed < 25) setSpinner(`${prefix}Iterating for quality...`);
              else if (elapsed < 40) setSpinner(`${prefix}Verifying implementation...`);
              else setSpinner(`${prefix}Still working... (${elapsed}s)`);
            } else {
              if (elapsed < 8) setSpinner("Analyzing request...");
              else if (elapsed < 12) setSpinner("Planning approach...");
              else if (elapsed < 16) setSpinner("Preparing tools...");
              else setSpinner(`Still working... (${elapsed}s)`);
            }
          }, 2000);
        },
        onThinkingEnd: () => {
          clearThinkingInterval();
          // If the LLM took >2s to think, leave a visible ✓ checkmark so the
          // user can see how long each reasoning step took.
          const thinkingElapsed = activeSpinner?.getElapsed() ?? 0;
          if (thinkingElapsed >= 2) {
            // Clear echo first so the placeholder line isn't baked into the permanent log.
            inputEcho.clear();
            activeSpinner?.stop();
            activeSpinner = null;
            turnActiveSpinner = null;
          } else {
            clearSpinner();
          }
        },
        onToolPreparing: (toolName) => {
          setSpinner(getToolPreparingDescription(toolName));
        },
        onBeforeConfirmation: () => {
          // Clear spinner/echo and suspend concurrent capture before confirmation dialog
          inputEcho.suspend();
          clearSpinner();
          concurrentCapture.suspend();
        },
        onAfterConfirmation: () => {
          // Resume concurrent capture and echo after confirmation dialog
          concurrentCapture.resumeCapture();
          inputEcho.resume();
        },
        signal: abortController.signal,
        // Mid-task steering: drain any accumulated steering messages between iterations
        onSteeringCheck: () => {
          const messages = turnSteeringMessages.splice(0, turnSteeringMessages.length);
          return messages;
        },
        // Wire lifecycle hooks (PreToolUse/PostToolUse) if configured in .coco/hooks.json
        hookRegistry,
        hookExecutor,
      });

      // Remove SIGINT handler and clean up thinking interval after agent turn
      clearThinkingInterval();
      clearSpinner();
      inputEcho.clear();
      process.off("SIGINT", sigintHandler);

      // Stop concurrent capture and wait for any pending LLM classifications
      const remainingMessages = concurrentCapture.stop();
      feedbackSystem.reset();

      // Wait for all pending classification promises to settle before processing results.
      // This ensures LLM responses that arrive after the agent finishes are still processed.
      if (pendingClassifications.length > 0) {
        await Promise.allSettled(pendingClassifications);
      }

      // Any messages still in the queue (captured after last selector or never processed)
      // are added to the next turn queue
      for (const msg of remainingMessages) {
        turnQueuedMessages.push(msg.text);
      }

      // Process actioned interruptions (Modify → abort + re-send task with modification context)
      // Session was rolled back by agent-loop on abort — it's clean.
      // We inject completed tool results directly into the context string so the
      // agent can reuse prior work without relying on session message history.
      if (turnActionedInterruptions.length > 0) {
        const modParts = turnActionedInterruptions.map((i) => i.text).join("\n- ");
        const toolSummary = summarizeToolResults(result.toolCalls);
        const ctx = [
          "\n\n## The user interrupted and modified the task:",
          `- ${modParts}`,
          toolSummary,
          `Apply the user's modification to the original task: "${replayUserMessage || ""}"`,
        ].join("\n");
        pendingInterruptionContext = ctx;
        pendingModificationPreview = modParts;

        // Re-send the original task so the agent retries with the modification applied.
        if (replayUserMessage) {
          pendingQueuedMessages = [replayUserMessage, ...turnQueuedMessages];
        } else {
          pendingQueuedMessages = turnQueuedMessages;
        }
      } else if (turnQueuedMessages.length > 0) {
        // No modifications, just queued messages for next turn
        pendingQueuedMessages = turnQueuedMessages;
        console.log(
          chalk.cyan(`  \uD83D\uDCCB ${turnQueuedMessages.length} message(s) queued for next turn`),
        );
      }

      // Show abort summary if cancelled, preserving partial content
      if (wasAborted || result.aborted) {
        // Show partial content if any was captured before abort
        if (result.partialContent) {
          console.log(chalk.dim("\n[Partial response before cancellation]:"));
          console.log(result.partialContent);
        }

        const summary = formatAbortSummary(result.toolCalls);
        if (summary) {
          console.log(summary);
        }

        // Still track partial token usage
        if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
          addTokenUsage(result.usage.inputTokens, result.usage.outputTokens);
          renderUsageStats(
            result.usage.inputTokens,
            result.usage.outputTokens,
            result.toolCalls.length,
          );
        }

        if (result.toolCalls.length > 0) {
          console.log(chalk.dim("   Type your request again to resume where you left off."));
        }
        console.log();
        continue;
      }

      // ── Streaming error returned by agent-loop ────────────────────────────
      // agent-loop catches streaming errors and returns a result with `error`
      // set instead of throwing. We need to handle this explicitly so the LLM
      // recovery path fires (re-queue with error context) rather than treating
      // the error as a successful turn.
      if (result.error) {
        // Roll back any partial messages agent-loop added before the error
        session.messages.length = preCallMessageLength;

        if (
          replayUserMessage !== null &&
          consecutiveErrors < MAX_CONSECUTIVE_ERRORS &&
          !isNonRetryableProviderError(new Error(result.error))
        ) {
          consecutiveErrors++;
          const humanized = humanizeProviderError(new Error(result.error));
          renderError(humanized);
          let switched = false;
          if (enableAutoSwitchProvider && consecutiveErrors >= AUTO_SWITCH_THRESHOLD) {
            switched = await attemptAutoProviderSwitch(humanized, replayUserMessage);
          } else if (!enableAutoSwitchProvider && consecutiveErrors >= AUTO_SWITCH_THRESHOLD) {
            console.log(
              chalk.dim(
                "   Tip: repeated provider errors detected. Use /provider, or enable `agent.enableAutoSwitchProvider`.",
              ),
            );
          }
          console.log(
            chalk.dim(
              `   ↻ Retrying automatically (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})…`,
            ),
          );
          const recoveryPrefix =
            (switched
              ? `[System: Provider auto-switched to "${session.config.provider.type}" after repeated failures. Adapt your strategy to this provider and continue.]\n\n`
              : "") +
            `[System: The previous attempt failed with: "${humanized}". ` +
            `Please try a different approach, tool, or method to complete the task. ` +
            `Do NOT repeat the exact same action that caused the error.]\n\n`;
          pendingQueuedMessages = [recoveryPrefix + replayUserMessage];
        } else {
          renderError(result.error);
          console.log(chalk.dim("   Automatic recovery stopped for this turn."));
          showRecoveryAlternatives();
          consecutiveErrors = 0;
        }
        console.log();
        continue;
      }

      console.log(); // Blank line after response

      // Print any LLM-powered error hints that resolved during the agent turn.
      // We race against a short timeout so we never block output here.
      if (pendingExplanations.length > 0) {
        const settled = await Promise.race([
          Promise.allSettled(pendingExplanations),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        if (settled) {
          for (const r of settled) {
            if (r.status === "fulfilled" && r.value) {
              console.log(chalk.dim(`   \u{1F4A1} ${r.value}`));
            }
          }
        }
      }

      // Parse and display quality report if quality loop produced one
      if (isQualityLoop() && result.content) {
        const qualityResult = parseQualityLoopReport(result.content);
        if (qualityResult) {
          console.log(formatQualityResult(qualityResult));
        }
      }

      // Track token usage for /cost command
      addTokenUsage(result.usage.inputTokens, result.usage.outputTokens);

      // Show usage stats
      renderUsageStats(
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.toolCalls.length,
      );

      // Fire-and-forget: refresh git context without blocking the loop
      getGitContext(session.projectPath)
        .then((ctx) => {
          if (ctx) gitContext = ctx;
        })
        .catch(() => {});

      // Compact context if needed — do this before rendering the status bar so the
      // bar always shows the post-compaction percentage (never a stale pre-compaction value).
      const usageBefore = getContextUsagePercent(session);
      let usageForDisplay = usageBefore;
      try {
        const compactAbort = new AbortController();
        const compactTimeout = setTimeout(() => compactAbort.abort(), 30_000);
        const compactSigint = () => compactAbort.abort();
        process.once("SIGINT", compactSigint);

        const compactSpinner = createSpinner("Compacting context");
        compactSpinner.start();

        try {
          const compactionResult = await checkAndCompactContext(
            session,
            provider,
            compactAbort.signal,
            toolRegistry,
          );
          if (compactionResult?.wasCompacted) {
            usageForDisplay = getContextUsagePercent(session);
            compactSpinner.stop(
              `Context compacted (${usageBefore.toFixed(0)}% → ${usageForDisplay.toFixed(0)}%)`,
            );
            // Persistent compact notice — stays in scroll history
            console.log(
              chalk.dim(
                `  ⟳ Context compacted · ${usageBefore.toFixed(0)}% → ${usageForDisplay.toFixed(0)}%`,
              ),
            );
            warned75 = false;
            warned90 = false;
          } else {
            compactSpinner.clear();
          }
        } catch {
          compactSpinner.stop("⚠ Context compaction failed");
          console.log(
            chalk.yellow(
              "  ⚠ Context compaction failed — context unchanged. Use /clear if needed.",
            ),
          );
        } finally {
          clearTimeout(compactTimeout);
          process.off("SIGINT", compactSigint);
        }
      } catch {
        console.log(
          chalk.yellow("  ⚠ Context compaction failed — context unchanged. Use /clear if needed."),
        );
      }

      // Render status bar with post-compaction context usage
      renderStatusBar(session.projectPath, session.config, gitContext, usageForDisplay);

      // Context usage warnings
      if (usageForDisplay >= 90 && !warned90) {
        warned90 = true;
        console.log(
          chalk.red(
            "  ✗ Context critical (" +
              usageForDisplay.toFixed(0) +
              "%) — use /clear to start fresh",
          ),
        );
      } else if (usageForDisplay >= 75 && !warned75) {
        warned75 = true;
        console.log(
          chalk.yellow(
            "  ⚠  Context at " +
              usageForDisplay.toFixed(0) +
              "% — use /clear to start fresh or /compact to summarize",
          ),
        );
      }

      console.log(); // Extra spacing

      // Successful turn — reset the consecutive error recovery counter
      consecutiveErrors = 0;
    } catch (error) {
      // Always clear spinner, thinking interval, capture, echo on error
      clearThinkingInterval();
      inputEcho.clear();
      clearSpinner();
      concurrentCapture.stop();
      feedbackSystem.reset();
      process.off("SIGINT", sigintHandler);

      // ── Abort: silent continuation ───────────────────────────────────────
      // Covers DOM AbortError, Anthropic/OpenAI APIUserAbortError, message
      // fallback, and any error that occurred after the signal was already set.
      if (isAbortError(error, abortController.signal)) {
        continue;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);

      // ── Context overflow (Anthropic / Copilot) ───────────────────────────
      if (errorMsg.includes("prompt token count") && errorMsg.includes("exceeds the limit")) {
        renderError("Context window full — compacting conversation history...");
        try {
          const compactionResult = await checkAndCompactContext(
            session,
            provider,
            undefined,
            toolRegistry,
          );
          if (compactionResult?.wasCompacted) {
            console.log(chalk.green("   \u2713 Context compacted. Please retry your message."));
          } else {
            console.log(
              chalk.yellow("   \u26A0 Could not compact context. Use /clear to start fresh."),
            );
          }
        } catch {
          console.log(
            chalk.yellow("   \u26A0 Context compaction failed. Use /clear to start fresh."),
          );
        }
        continue;
      }

      // ── LM Studio context length error ───────────────────────────────────
      if (errorMsg.includes("context length") || errorMsg.includes("tokens to keep")) {
        renderError(errorMsg);
        console.log();
        console.log(chalk.yellow("   \u{1F4A1} This is a context length error."));
        console.log(chalk.yellow("   The model's context window is too small for Coco.\n"));
        console.log(chalk.white("   To fix this in LM Studio:"));
        console.log(chalk.dim("   1. Click on the model name in the top bar"));
        console.log(chalk.dim("   2. Find 'Context Length' setting"));
        console.log(chalk.dim("   3. Increase it (recommended: 16384 or higher)"));
        console.log(chalk.dim("   4. Click 'Reload Model'\n"));
        continue;
      }

      // ── Timeout ───────────────────────────────────────────────────────────
      if (
        errorMsg.includes("timeout") ||
        errorMsg.includes("Timeout") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("ECONNRESET")
      ) {
        renderError("Request timed out");
        console.log(
          chalk.dim("   The model took too long to respond. Try again or use a faster model."),
        );
        continue;
      }

      // ── Non-retryable provider errors (quota, auth, billing) ───────────────
      // These errors won't be fixed by retrying - show immediately to user
      const userFacingError = getUserFacingProviderError(error);
      if (userFacingError) {
        consecutiveErrors = 0;
        session.messages.length = preCallMessageLength;
        renderError(userFacingError);
        console.log();
        console.log(chalk.yellow("   📋 Suggestions:"));
        console.log(chalk.dim("   • Check your subscription status and billing"));
        console.log(chalk.dim("   • Try a different provider: /provider"));
        console.log(chalk.dim("   • Switch to a different model: /model"));
        if (!enableAutoSwitchProvider) {
          console.log(
            chalk.dim("   • Optional: enable `agent.enableAutoSwitchProvider` for auto-failover"),
          );
        }
        showRecoveryAlternatives();
        console.log();
        continue;
      }

      // ── LLM recovery path ─────────────────────────────────────────────────
      // If there is an original user message to replay and we still have
      // recovery budget, roll back any partial session state and re-queue the
      // message with error context so the LLM can try a different approach.
      if (
        replayUserMessage !== null &&
        consecutiveErrors < MAX_CONSECUTIVE_ERRORS &&
        !isNonRetryableProviderError(error)
      ) {
        consecutiveErrors++;

        // Roll back any partial messages written before the throw
        session.messages.length = preCallMessageLength;

        const humanized = humanizeProviderError(error);
        renderError(humanized);
        let switched = false;
        if (enableAutoSwitchProvider && consecutiveErrors >= AUTO_SWITCH_THRESHOLD) {
          switched = await attemptAutoProviderSwitch(humanized, replayUserMessage);
        } else if (!enableAutoSwitchProvider && consecutiveErrors >= AUTO_SWITCH_THRESHOLD) {
          console.log(
            chalk.dim(
              "   Tip: repeated provider errors detected. Use /provider, or enable `agent.enableAutoSwitchProvider`.",
            ),
          );
        }
        console.log(
          chalk.dim(
            `   ↻ Retrying automatically (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})…`,
          ),
        );

        // Re-queue the original message with error context prepended so the
        // LLM knows what failed and can attempt a different approach.
        const recoveryPrefix =
          (switched
            ? `[System: Provider auto-switched to "${session.config.provider.type}" after repeated failures. Adapt your strategy to this provider and continue.]\n\n`
            : "") +
          `[System: The previous attempt failed with the following error: "${humanized}". ` +
          `Please try a different approach, tool, or method to complete the task. ` +
          `Do NOT repeat the exact same action that caused the error.]\n\n`;
        pendingQueuedMessages = [recoveryPrefix + replayUserMessage];
        continue;
      }

      // ── Recovery budget exhausted ─────────────────────────────────────────
      // Roll back partial state, show the final error, and return to prompt.
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        consecutiveErrors = 0;
        session.messages.length = preCallMessageLength;
        renderError(errorMsg);
        console.log(chalk.dim("   Recovery exhausted after multiple attempts."));
        showRecoveryAlternatives();
        continue;
      }

      // ── Fallback ──────────────────────────────────────────────────────────
      // Non-retryable error with no user-facing message and budget not yet
      // exhausted (e.g. 400 "unsupported parameter"). Roll back partial state
      // and return to prompt without retrying.
      session.messages.length = preCallMessageLength;
      consecutiveErrors = 0;
      renderError(errorMsg);
      showRecoveryAlternatives();
    } finally {
      // Always clean up spinner and resume input handler after agent turn
      clearSpinner();
      inputHandler.resume();
      // Quality loop: always restore original system prompt after every turn
      if (originalSystemPrompt !== undefined) {
        session.config.agent.systemPrompt = originalSystemPrompt;
      }
    }
  }

  inputHandler.close();
  feedbackSystem.dispose();

  // Graceful MCP shutdown: await here so async cleanup completes before the
  // process exits normally. The fire-and-forget on "exit" stays as a fallback.
  if (mcpManager) {
    await mcpManager.stopAll().catch(() => {
      // Ignore errors during shutdown
    });
  }

  // Clean up SIGTERM listener to prevent listener leak on repeated startRepl calls.
  // process.once removes it automatically if SIGTERM fires; we remove it here on normal exit.
  process.off("SIGTERM", sigtermHandler);
}

/**
 * Print welcome message - retro terminal style, compact
 * Brand color: Magenta/Purple
 */
async function printWelcome(
  session: {
    projectPath: string;
    config: ReplConfig;
    skillRegistry?: import("../../skills/registry.js").UnifiedSkillRegistry;
  },
  gitCtx: GitContext | null,
  mcpManager?: MCPServerManager | null,
): Promise<void> {
  const trustStore = createTrustStore();
  await trustStore.init();
  const trustLevel = trustStore.getLevel(session.projectPath);

  // Box dimensions — fixed width for consistency.
  // Using the same approach as `boxen`: measure content with `stringWidth`,
  // pad with spaces to a uniform inner width, then wrap with border chars.
  // IMPORTANT: Emoji MUST stay outside the box.  Terminal emoji widths are
  // unpredictable (some render 🥥 as 2 cols, others as 3) and no JS lib
  // can query the actual terminal width.  Only ASCII content goes inside
  // so the right │ always aligns perfectly with the corners.
  const boxWidth = 41;
  const innerWidth = boxWidth - 2; // visible columns between the two │ chars

  const versionText = `v${VERSION}`;
  const subtitleText = "open source \u2022 corbat.tech";

  // Helper: build a padded content line inside the box.
  // Measures the visual width of `content` with stringWidth, then pads it
  // with trailing spaces so every line has exactly `innerWidth` visible
  // columns.  The right │ is always placed immediately after the padding.
  const boxLine = (content: string): string => {
    const pad = Math.max(0, innerWidth - stringWidth(content));
    return chalk.magenta("\u2502") + content + " ".repeat(pad) + chalk.magenta("\u2502");
  };

  // Line 1: " COCO                    v1.2.x "
  const titleLeftRaw = " COCO";
  const titleRightRaw = versionText + " ";
  const titleLeftStyled = " " + chalk.bold.white("COCO");
  const titleGap = Math.max(1, innerWidth - stringWidth(titleLeftRaw) - stringWidth(titleRightRaw));
  const titleContent = titleLeftStyled + " ".repeat(titleGap) + chalk.dim(titleRightRaw);

  // Line 2: tagline in brand color
  const taglineText = "code that converges to quality";
  const taglineContent = " " + chalk.magenta(taglineText) + " ";

  // Line 3: attribution (dim)
  const subtitleContent = " " + chalk.dim(subtitleText) + " ";

  // Always show the styled header box.
  // Only ASCII inside the box — emoji widths are unpredictable across terminals.
  console.log();
  console.log(chalk.magenta("  \u256D" + "\u2500".repeat(boxWidth - 2) + "\u256E"));
  console.log("  " + boxLine(titleContent));
  console.log("  " + boxLine(taglineContent));
  console.log("  " + boxLine(subtitleContent));
  console.log(chalk.magenta("  \u2570" + "\u2500".repeat(boxWidth - 2) + "\u256F"));

  // Project info - single compact block
  const maxPathLen = 50;
  let displayPath = session.projectPath;
  if (displayPath.length > maxPathLen) {
    displayPath = "..." + displayPath.slice(-maxPathLen + 3);
  }

  // Split path to highlight project folder name
  const lastSep = displayPath.lastIndexOf("/");
  const parentPath = lastSep > 0 ? displayPath.slice(0, lastSep + 1) : "";
  const projectName = lastSep > 0 ? displayPath.slice(lastSep + 1) : displayPath;

  const providerName = session.config.provider.type;
  const modelName = session.config.provider.model || "default";
  const trustText =
    trustLevel === "full"
      ? "full"
      : trustLevel === "write"
        ? "write"
        : trustLevel === "read"
          ? "read"
          : "";

  console.log();
  console.log(chalk.dim(`  \u{1F4C1} ${parentPath}`) + chalk.magenta.bold(projectName));
  console.log(
    chalk.dim(`  \u{1F916} ${providerName}/`) +
      chalk.magenta(modelName) +
      (trustText ? chalk.dim(` \u2022 \u{1F510} ${trustText}`) : ""),
  );
  // Show git context if available
  if (gitCtx) {
    console.log(`  ${formatGitLine(gitCtx)}`);
  }
  // Show quality loop status
  const cocoStatus = isQualityLoop()
    ? chalk.magenta("  \u{1F504} quality mode: ") +
      chalk.green.bold("on") +
      chalk.dim(" — iterates until quality \u2265 85. /quality to disable")
    : chalk.dim("  \u{1F4A1} /quality on — enable auto-test & quality iteration");
  console.log(cocoStatus);

  // Show skills and MCP status summary (only when something is active)
  const skillTotal = session.skillRegistry?.size ?? 0;
  const mcpServers = mcpManager?.getConnectedServers() ?? [];
  const hasSomething = skillTotal > 0 || mcpServers.length > 0;
  if (hasSomething) {
    if (skillTotal > 0) {
      const allMeta = session.skillRegistry!.getAllMetadata();
      const builtinCount = allMeta.filter((s) => s.scope === "builtin").length;
      const projectCount = skillTotal - builtinCount;
      const parts: string[] = [];
      if (builtinCount > 0) parts.push(`${builtinCount} builtin`);
      if (projectCount > 0) parts.push(`${projectCount} project`);
      const detail = parts.length > 0 ? ` (${parts.join(" \u00B7 ")})` : "";
      console.log(chalk.green("  \u2713") + chalk.dim(` Skills: ${skillTotal} loaded${detail}`));
    } else {
      console.log(chalk.dim("  \u00B7 Skills: none loaded"));
    }
    if (mcpServers.length > 0) {
      const names = mcpServers.join(", ");
      console.log(
        chalk.green("  \u2713") +
          chalk.dim(
            ` MCP: ${names} (${mcpServers.length} server${mcpServers.length === 1 ? "" : "s"} active)`,
          ),
      );
    }
  }

  console.log();
  console.log(
    chalk.dim("  Type your request or ") + chalk.magenta("/help") + chalk.dim(" for commands"),
  );
  const pasteHint =
    process.platform === "darwin"
      ? chalk.dim("  \u{1F4CB} \u2318V paste text \u2022 \u2303V paste image")
      : chalk.dim("  \u{1F4CB} Ctrl+V paste image from clipboard");
  console.log(pasteHint);
  console.log();
}

export type { ReplConfig, ReplSession, AgentTurnResult } from "./types.js";

/**
 * Check and request project trust - compact version
 */
async function checkProjectTrust(projectPath: string): Promise<boolean> {
  const trustStore = createTrustStore();
  await trustStore.init();

  // Check if already trusted
  if (trustStore.isTrusted(projectPath)) {
    await trustStore.touch(projectPath);
    return true;
  }

  // Compact first-time access warning
  console.log();
  console.log(chalk.cyan.bold("  \u{1F965} Coco") + chalk.dim(` v${VERSION}`));
  console.log(chalk.dim(`  \u{1F4C1} ${projectPath}`));
  console.log();
  console.log(chalk.yellow("  \u26A0 First time accessing this directory"));
  console.log(chalk.dim("  This agent can: read/write files, run commands, git ops"));
  console.log();

  // Ask for approval
  const approved = await p.select({
    message: "Grant access?",
    options: [
      { value: "write", label: "\u2713 Write access (recommended)" },
      { value: "read", label: "\u25D0 Read-only" },
      { value: "no", label: "\u2717 Deny & exit" },
    ],
  });

  if (p.isCancel(approved) || approved === "no") {
    p.outro(chalk.dim("Access denied."));
    return false;
  }

  // Ask if remember decision
  const remember = await p.confirm({
    message: "Remember for this project?",
    initialValue: true,
  });

  if (p.isCancel(remember)) {
    p.outro(chalk.dim("Cancelled."));
    return false;
  }

  if (remember) {
    await trustStore.addTrust(projectPath, approved as TrustLevel);
  }

  console.log(chalk.green("  \u2713 Access granted") + chalk.dim(" \u2022 /trust to manage"));
  return true;
}

/**
 * Return a human-readable category label for a tool name.
 * Used in the thinking-phase spinner to give context like "after running tests".
 */
function getToolGroup(toolName: string): string {
  switch (toolName) {
    case "run_tests":
      return "running tests";
    case "bash_exec":
      return "running command";
    case "web_search":
    case "web_fetch":
      return "web search";
    case "read_file":
    case "list_directory":
    case "glob_files":
    case "tree":
      return "reading files";
    case "grep_search":
    case "semantic_search":
    case "codebase_map":
      return "searching code";
    case "write_file":
      return "writing file";
    case "edit_file":
      return "editing file";
    case "git_status":
    case "git_diff":
    case "git_commit":
    case "git_log":
      return "git";
    default:
      return toolName.replace(/_/g, " ");
  }
}

function getToolPreparingDescription(toolName: string): string {
  switch (toolName) {
    case "write_file":
      return "Generating file content\u2026";
    case "edit_file":
      return "Planning edits\u2026";
    case "bash_exec":
      return "Building command\u2026";
    case "web_search":
      return "Building search query\u2026";
    case "web_fetch":
      return "Preparing request\u2026";
    case "run_tests":
      return "Setting up test run\u2026";
    case "git_commit":
      return "Composing commit\u2026";
    case "semantic_search":
    case "grep_search":
      return "Building search\u2026";
    default:
      return `Preparing ${toolName}\u2026`;
  }
}

/**
 * Get a human-readable description of what a tool is doing.
 * Used for spinner messages during tool execution to give the user
 * meaningful feedback instead of generic "Running tool_name..." messages.
 */
function getToolRunningDescription(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "codebase_map":
      return "Analyzing codebase structure\u2026";
    case "web_search": {
      const query = typeof input.query === "string" ? input.query.slice(0, 40) : "";
      return query ? `Searching the web: "${query}"\u2026` : "Searching the web\u2026";
    }
    case "web_fetch": {
      const url = typeof input.url === "string" ? input.url.slice(0, 50) : "";
      return url ? `Fetching ${url}\u2026` : "Fetching web page\u2026";
    }
    case "read_file": {
      const filePath = typeof input.path === "string" ? input.path.split("/").pop() : "";
      return filePath ? `Reading ${filePath}\u2026` : "Reading file\u2026";
    }
    case "write_file": {
      const filePath = typeof input.path === "string" ? input.path.split("/").pop() : "";
      return filePath ? `Writing ${filePath}\u2026` : "Writing file\u2026";
    }
    case "edit_file": {
      const filePath = typeof input.path === "string" ? input.path.split("/").pop() : "";
      return filePath ? `Editing ${filePath}\u2026` : "Editing file\u2026";
    }
    case "list_directory":
      return "Listing directory\u2026";
    case "bash_exec": {
      const cmd = typeof input.command === "string" ? input.command.trim() : "";
      // Show first meaningful segment of the command (strip leading env vars / flags)
      const displayCmd = cmd.replace(/^[\w=]+=\S+\s+/, "").slice(0, 55);
      return displayCmd ? `Running: ${displayCmd}\u2026` : "Running command\u2026";
    }
    case "run_tests":
      return "Running tests\u2026";
    case "git_status":
      return "Checking git status\u2026";
    case "git_diff":
      return "Computing diff\u2026";
    case "git_log":
      return "Reading git history\u2026";
    case "git_commit":
      return "Creating commit\u2026";
    case "semantic_search": {
      const query = typeof input.query === "string" ? input.query.slice(0, 40) : "";
      return query ? `Searching code: "${query}"\u2026` : "Searching code\u2026";
    }
    case "grep_search": {
      const pattern = typeof input.pattern === "string" ? input.pattern.slice(0, 40) : "";
      return pattern ? `Searching for: "${pattern}"\u2026` : "Searching files\u2026";
    }
    case "generate_diagram":
      return "Generating diagram\u2026";
    case "read_pdf":
      return "Reading PDF\u2026";
    case "read_image":
      return "Analyzing image\u2026";
    case "sql_query":
      return "Executing SQL query\u2026";
    case "code_review":
      return "Reviewing code\u2026";
    case "create_memory":
      return "Saving memory\u2026";
    case "recall_memory":
      return "Searching memories\u2026";
    case "create_checkpoint":
      return "Creating checkpoint\u2026";
    case "restore_checkpoint":
      return "Restoring checkpoint\u2026";
    case "glob_files":
      return "Finding files\u2026";
    case "tree":
      return "Building directory tree\u2026";
    default:
      return `Running ${name}\u2026`;
  }
}

/**
 * Handle intent confirmation dialog
 * Returns true if the intent should be executed as a command
 */
async function handleIntentConfirmation(
  intent: Intent,
  recognizer: ReturnType<typeof createIntentRecognizer>,
): Promise<boolean> {
  // Check if auto-execute is enabled
  if (recognizer.shouldAutoExecute(intent)) {
    return true;
  }

  // Show detected intent
  console.log();
  console.log(
    chalk.cyan(
      `\u{1F50D} Detected intent: /${intent.type} (confidence: ${(intent.confidence * 100).toFixed(0)}%)`,
    ),
  );

  // Show extracted entities if any
  if (Object.keys(intent.entities).length > 0) {
    const entityStr = Object.entries(intent.entities)
      .filter(([, v]) => v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`)
      .join(", ");
    if (entityStr) {
      console.log(chalk.dim(`   Entities: ${entityStr}`));
    }
  }
  console.log();

  // Ask for confirmation
  const action = await p.select({
    message: `Execute /${intent.type} command?`,
    options: [
      { value: "yes", label: "\u2713 Yes, execute command" },
      { value: "no", label: "\u2717 No, continue as chat" },
      { value: "always", label: "\u26A1 Always execute this intent" },
    ],
  });

  if (p.isCancel(action) || action === "no") {
    return false;
  }

  if (action === "always") {
    recognizer.setAutoExecutePreference(intent.type, true);
    console.log(chalk.dim(`   Auto-execute enabled for /${intent.type}`));
    return true;
  }

  return action === "yes";
}
