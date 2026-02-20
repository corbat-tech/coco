/**
 * REPL main entry point
 */

import chalk from "chalk";
import stringWidth from "string-width";
import {
  createSession,
  initializeSessionTrust,
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
import { createProvider } from "../../providers/index.js";
import { createFullToolRegistry } from "../../tools/index.js";
import { setAgentProvider, setAgentToolRegistry } from "../../agents/provider-bridge.js";
import {
  isSlashCommand,
  parseSlashCommand,
  executeSlashCommand,
  addTokenUsage,
  hasPendingImage,
  consumePendingImage,
} from "./commands/index.js";
import type { MessageContent, ImageContent, TextContent } from "../../providers/types.js";
import type { ReplConfig } from "./types.js";
import { VERSION } from "../../version.js";
import { createTrustStore, type TrustLevel } from "./trust-store.js";
import * as p from "@clack/prompts";
import { createIntentRecognizer, type Intent } from "./intent/index.js";
// State manager available for future use
// import { getStateManager, formatStateStatus, getStateSummary } from "./state/index.js";
import { ensureConfiguredV2 } from "./onboarding-v2.js";
import { getInternalProviderId } from "../../config/env.js";
import { loadAllowedPaths } from "../../tools/allowed-paths.js";
import {
  shouldShowPermissionSuggestion,
  showPermissionSuggestion,
} from "./recommended-permissions.js";
import {
  isCocoMode,
  loadCocoModePreference,
  looksLikeFeatureRequest,
  wasHintShown,
  markHintShown,
  formatCocoHint,
  formatQualityResult,
  getCocoModeSystemPrompt,
  type CocoQualityResult,
} from "./coco-mode.js";
import { getGitContext, formatGitLine, type GitContext } from "./git-context.js";
import { renderStatusBar } from "./status-bar.js";

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

  // Create session
  const session = createSession(projectPath, options.config);

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
  let provider;
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
  const llmClassifier = createLLMClassifier(provider);

  // Detect and enrich project stack context
  const { detectProjectStack } = await import("./context/stack-detector.js");
  session.projectContext = await detectProjectStack(projectPath);

  // Load persisted allowed paths for this project
  await loadAllowedPaths(projectPath);

  // Show recommended permissions suggestion for first-time users
  if (await shouldShowPermissionSuggestion()) {
    await showPermissionSuggestion();
    // Reload trust into session after potential changes
    const updatedTrust = await loadTrustedTools(projectPath);
    for (const tool of updatedTrust) {
      session.trustedTools.add(tool);
    }
  }

  // Load COCO mode preference
  await loadCocoModePreference();

  // Load full-access mode preference
  const { loadFullAccessPreference } = await import("./full-access-mode.js");
  await loadFullAccessPreference();

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
  await printWelcome(session, gitContext);

  // Ensure terminal state is restored on exit (bracketed paste, raw mode, etc.)
  const cleanupTerminal = () => {
    process.stdout.write("\x1b[?2004l"); // Disable bracketed paste
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
  };
  process.on("exit", cleanupTerminal);
  process.on("SIGTERM", () => {
    cleanupTerminal();
    process.exit(0);
  });

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
          chalk.yellow(`\n\u26A1 Re-enviando con modificación: `) + chalk.dim(modPreview),
        );
        console.log();
      } else {
        const preview = autoInput.length > 70 ? autoInput.slice(0, 67) + "\u2026" : autoInput;
        console.log(chalk.cyan(`\n\uD83D\uDCCB Auto-enviando mensaje encolado:`));
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

    // Handle slash commands
    let agentMessage: string | MessageContent | null = null;

    if (input && isSlashCommand(input)) {
      const { command, args } = parseSlashCommand(input);
      const commandResult = await executeSlashCommand(command, args, session);
      if (commandResult.shouldExit) break;

      // If the skill returned a forkPrompt, inject it as the next agent message
      if (commandResult.forkPrompt) {
        agentMessage = commandResult.forkPrompt;
        // Don't skip the agent turn — let it process the forked skill instructions
      } else if (hasPendingImage()) {
        // Check if slash command queued a multimodal message (e.g., /image)
        const pending = consumePendingImage()!;
        agentMessage = [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: pending.media_type,
              data: pending.data,
            },
          } as ImageContent,
          {
            type: "text",
            text: pending.prompt,
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
      const pending = consumePendingImage()!;
      agentMessage = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: pending.media_type,
            data: pending.data,
          },
        } as ImageContent,
        {
          type: "text",
          text: pending.prompt,
        } as TextContent,
      ];
    }

    // Detect intent from natural language (skip for image-only messages)
    if (agentMessage === null && input) {
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

    try {
      // Show contextual hint for first feature-like prompt when COCO mode is off
      if (
        typeof agentMessage === "string" &&
        !isCocoMode() &&
        !wasHintShown() &&
        looksLikeFeatureRequest(agentMessage)
      ) {
        markHintShown();
        console.log(formatCocoHint());
      }

      console.log(); // Blank line before response

      // If COCO mode is active, temporarily augment the system prompt
      let originalSystemPrompt: string | undefined;
      if (isCocoMode()) {
        originalSystemPrompt = session.config.agent.systemPrompt;
        session.config.agent.systemPrompt = originalSystemPrompt + "\n" + getCocoModeSystemPrompt();
      }

      // Pause normal input handler and start concurrent capture
      // This allows the user to type messages during agent execution
      inputHandler.pause();

      // Track actioned interruptions and queued messages for this turn
      const turnActionedInterruptions: ActionedInterruption[] = [];
      const turnQueuedMessages: string[] = [];
      // Track pending LLM classification promises so we can await them after agent completes
      const pendingClassifications: Promise<void>[] = [];

      concurrentCapture.reset();
      inputEcho.reset();
      concurrentCapture.start(
        (msg) => {
          // Step 1: Clear echo line (user pressed Enter, buffer is now empty)
          inputEcho.clear();

          const preview = msg.text.length > 60 ? msg.text.slice(0, 57) + "\u2026" : msg.text;
          console.log(chalk.dim(`  \u2026 Clasificando: ${preview}`));

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
                console.log(chalk.red(`  \u23F9 Abortando\u2026`) + sourceHint);
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
                console.log(
                  chalk.yellow(`  \u26A1 Modificando: `) + chalk.dim(preview) + sourceHint,
                );
                break;

              case InterruptionAction.Queue:
                turnQueuedMessages.push(msg.text);
                console.log(
                  chalk.cyan(`  \uD83D\uDCCB Encolado: `) + chalk.dim(preview) + sourceHint,
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

      const result = await executeAgentTurn(session, agentMessage, provider, toolRegistry, {
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
          // For long-running tools (>30s), show a "Done" checkmark so the user
          // gets clear feedback that the operation completed successfully.
          // For short tools, just clear the spinner silently.
          const elapsed =
            activeSpinner && typeof activeSpinner.getElapsed === "function"
              ? activeSpinner.getElapsed()
              : 0;
          if (elapsed >= 30) {
            // Show completion with elapsed time — critical for long builds/tests
            activeSpinner?.stop();
            activeSpinner = null;
            turnActiveSpinner = null;
          } else {
            clearSpinner();
          }
          renderToolStart(result.name, result.input);
          renderToolEnd(result);
          // Show waiting spinner while LLM processes the result
          // In COCO mode, add hint that quality checks may follow
          if (isCocoMode()) {
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
          setSpinner("Thinking...");
          thinkingStartTime = Date.now();
          thinkingInterval = setInterval(() => {
            if (!thinkingStartTime) return;
            const elapsed = Math.floor((Date.now() - thinkingStartTime) / 1000);
            if (elapsed < 4) return;

            // Show COCO mode feedback if active
            if (isCocoMode()) {
              if (elapsed < 8) setSpinner("Analyzing request...");
              else if (elapsed < 15) setSpinner("Running quality checks...");
              else if (elapsed < 25) setSpinner("Iterating for quality...");
              else if (elapsed < 40) setSpinner("Verifying implementation...");
              else setSpinner(`Quality iteration in progress... (${elapsed}s)`);
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
          clearSpinner();
        },
        onToolPreparing: (toolName) => {
          setSpinner(`Preparing: ${toolName}\u2026`);
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
          `Apply the user's modification to the original task: "${originalUserMessage || ""}"`,
        ].join("\n");
        pendingInterruptionContext = ctx;
        pendingModificationPreview = modParts;

        // Re-send the original task so the agent retries with the modification applied.
        if (originalUserMessage) {
          pendingQueuedMessages = [originalUserMessage, ...turnQueuedMessages];
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

        console.log();
        continue;
      }

      // Restore original system prompt if COCO mode augmented it
      if (originalSystemPrompt !== undefined) {
        session.config.agent.systemPrompt = originalSystemPrompt;
      }

      console.log(); // Blank line after response

      // Parse and display quality report if COCO mode produced one
      if (isCocoMode() && result.content) {
        const qualityResult = parseCocoQualityReport(result.content);
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

      // Render status bar with current git context
      renderStatusBar(session.projectPath, session.config, gitContext);

      // Check and perform context compaction if needed
      try {
        const usageBefore = getContextUsagePercent(session);
        const compactionResult = await checkAndCompactContext(session, provider);
        if (compactionResult?.wasCompacted) {
          const usageAfter = getContextUsagePercent(session);
          console.log(
            chalk.dim(
              `Context compacted (${usageBefore.toFixed(0)}% -> ${usageAfter.toFixed(0)}%)`,
            ),
          );
        }
      } catch {
        // Silently ignore compaction errors - not critical
      }

      console.log(); // Extra spacing
    } catch (error) {
      // Always clear spinner, thinking interval, capture, echo on error
      clearThinkingInterval();
      inputEcho.clear();
      clearSpinner();
      concurrentCapture.stop();
      feedbackSystem.reset();
      process.off("SIGINT", sigintHandler);
      // Don't show error for abort
      if (error instanceof Error && error.name === "AbortError") {
        continue;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for LM Studio context length error
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

      // Check for timeout errors
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

      renderError(errorMsg);
    } finally {
      // Always clean up spinner and resume input handler after agent turn
      clearSpinner();
      inputHandler.resume();
    }
  }

  inputHandler.close();
  feedbackSystem.dispose();
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
  // Show COCO mode status
  const cocoStatus = isCocoMode()
    ? chalk.magenta("  \u{1F504} quality mode: ") +
      chalk.green.bold("on") +
      chalk.dim(" — iterates until quality \u2265 85. /coco to disable")
    : chalk.dim("  \u{1F4A1} /coco on — enable auto-test & quality iteration");
  console.log(cocoStatus);

  // Show discovered skills count
  if (session.skillRegistry && session.skillRegistry.size > 0) {
    const allMeta = session.skillRegistry.getAllMetadata();
    const mdCount = allMeta.filter((s) => s.kind === "markdown").length;
    const nativeCount = session.skillRegistry.size - mdCount;
    const parts: string[] = [];
    if (mdCount > 0) parts.push(`${mdCount} markdown`);
    if (nativeCount > 0) parts.push(`${nativeCount} native`);
    console.log(chalk.dim(`  ${session.skillRegistry.size} skills (${parts.join(" + ")})`));
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
 * Parse COCO quality report from agent response content
 */
function parseCocoQualityReport(content: string): CocoQualityResult | null {
  const marker = "COCO_QUALITY_REPORT";
  const idx = content.indexOf(marker);
  if (idx === -1) return null;

  const block = content.slice(idx);

  const getField = (name: string): string | undefined => {
    const match = block.match(new RegExp(`${name}:\\s*(.+)`));
    return match?.[1]?.trim();
  };

  const scoreHistoryRaw = getField("score_history");
  if (!scoreHistoryRaw) return null;

  // Parse [72, 84, 87, 88]
  const scores = scoreHistoryRaw
    .replace(/[[\]]/g, "")
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));

  if (scores.length === 0) return null;

  const testsPassed = parseInt(getField("tests_passed") ?? "", 10);
  const testsTotal = parseInt(getField("tests_total") ?? "", 10);
  const coverage = parseInt(getField("coverage") ?? "", 10);
  const security = parseInt(getField("security") ?? "", 10);
  const iterations = parseInt(getField("iterations") ?? "", 10) || scores.length;
  const converged = getField("converged") === "true";

  return {
    converged,
    scoreHistory: scores,
    finalScore: scores[scores.length - 1] ?? 0,
    iterations,
    testsPassed: isNaN(testsPassed) ? undefined : testsPassed,
    testsTotal: isNaN(testsTotal) ? undefined : testsTotal,
    coverage: isNaN(coverage) ? undefined : coverage,
    securityScore: isNaN(security) ? undefined : security,
  };
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
    case "bash_exec":
      return "Running command\u2026";
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
