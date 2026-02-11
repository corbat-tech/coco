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
import {
  renderStreamChunk,
  renderToolStart,
  renderToolEnd,
  renderUsageStats,
  renderError,
  renderInfo,
} from "./output/renderer.js";
import { createSpinner, type Spinner } from "./output/spinner.js";
import { executeAgentTurn, formatAbortSummary } from "./agent-loop.js";
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
import { checkForUpdates } from "./version-check.js";
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
import { loadFullAccessPreference } from "./full-access-mode.js";
import {
  hasInterruptions,
  consumeInterruptions,
  handleBackgroundLine,
} from "./interruption-handler.js";
import { classifyInterruptions } from "./interruption-classifier.js";
import { getBackgroundTaskManager } from "./background/index.js";

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

  // Initialize context manager
  initializeContextManager(session, provider);

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
  await loadFullAccessPreference();

  // Initialize tool registry
  const toolRegistry = createFullToolRegistry();
  setAgentProvider(provider);
  setAgentToolRegistry(toolRegistry);

  // Create input handler
  const inputHandler = createInputHandler(session);

  // Initialize intent recognizer
  const intentRecognizer = createIntentRecognizer();

  // Print welcome
  await printWelcome(session);

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
    const input = await inputHandler.prompt();

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
      const shouldExit = await executeSlashCommand(command, args, session);
      if (shouldExit) break;

      // Check if slash command queued a multimodal message (e.g., /image)
      if (hasPendingImage()) {
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
          const shouldExit = await executeSlashCommand(command, args, session);
          if (shouldExit) break;
          continue;
        }
        // If user chose not to execute, fall through to normal chat
      }
    }

    // Use agentMessage if set by /image or Ctrl+V, otherwise use the raw text input
    if (agentMessage === null) {
      agentMessage = input ?? "";
    }

    // Execute agent turn
    // Single spinner for all states - avoids concurrent spinner issues
    let activeSpinner: Spinner | null = null;

    // Helper to safely clear spinner - defined outside try for access in catch
    const clearSpinner = () => {
      if (activeSpinner) {
        activeSpinner.clear();
        activeSpinner = null;
      }
    };

    // Helper to set spinner message (creates if needed)
    const setSpinner = (message: string) => {
      if (activeSpinner) {
        activeSpinner.update(message);
      } else {
        activeSpinner = createSpinner(message);
        activeSpinner.start();
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

      // Enable background capture for interruptions (instead of full pause)
      inputHandler.enableBackgroundCapture(handleBackgroundLine);

      process.once("SIGINT", sigintHandler);

      const result = await executeAgentTurn(session, agentMessage, provider, toolRegistry, {
        onStream: renderStreamChunk,
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
          // Clear spinner and show result
          clearSpinner();
          renderToolStart(result.name, result.input);
          renderToolEnd(result);
          // Show waiting spinner while LLM processes the result
          setSpinner("Processing...");
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
            if (elapsed < 8) setSpinner("Analyzing request...");
            else if (elapsed < 12) setSpinner("Planning approach...");
            else if (elapsed < 16) setSpinner("Preparing tools...");
            else setSpinner(`Still working... (${elapsed}s)`);
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
          // Clear spinner before showing confirmation dialog
          clearSpinner();
        },
        signal: abortController.signal,
      });

      // Remove SIGINT handler and clean up thinking interval after agent turn
      clearThinkingInterval();
      process.off("SIGINT", sigintHandler);

      // Disable background capture and process any interruptions
      inputHandler.disableBackgroundCapture();

      if (hasInterruptions()) {
        const interruptions = consumeInterruptions();

        console.log(chalk.dim(`\n[Received ${interruptions.length} interruption(s) during work]\n`));

        // Get current task from last message
        const currentTaskMsg = session.messages[session.messages.length - 1];
        const currentTask =
          typeof currentTaskMsg?.content === "string" ? currentTaskMsg.content : "Unknown task";

        // Classify interruptions using LLM
        const routing = await classifyInterruptions(interruptions, currentTask, provider);

        console.log(chalk.dim(`Action: ${routing.action} - ${routing.reasoning}\n`));

        if (routing.action === "modify" && routing.synthesizedMessage) {
          // Add synthesized message to session for next turn
          session.messages.push({
            role: "user",
            content: routing.synthesizedMessage,
          });
          console.log(chalk.green(`✓ Context added to current task`));
        } else if (routing.action === "interrupt") {
          // Abort was already handled if user pressed Ctrl+C
          console.log(chalk.yellow(`⚠️  Task cancelled by user request`));
        } else if (routing.action === "queue" && routing.queuedTasks) {
          // Add tasks to background queue
          const bgManager = getBackgroundTaskManager();
          for (const task of routing.queuedTasks) {
            bgManager.createTask(task.title, task.description, async () => {
              // Placeholder: would execute task via COCO
              return `Task "${task.title}" would be executed here`;
            });
          }
          console.log(
            chalk.green(`✓ Queued ${routing.queuedTasks.length} task(s) for later execution`),
          );
        } else if (routing.action === "clarification" && routing.response) {
          console.log(chalk.cyan(`\n${routing.response}\n`));
        }

        console.log(); // Blank line
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
      // Always clear spinner and thinking interval on error, remove SIGINT handler
      clearThinkingInterval();
      clearSpinner();
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
      // Always resume input handler after agent turn
      inputHandler.resume();
    }
  }

  inputHandler.close();
}

/**
 * Print welcome message - retro terminal style, compact
 * Brand color: Magenta/Purple
 */
async function printWelcome(session: { projectPath: string; config: ReplConfig }): Promise<void> {
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

  // Check for updates (non-blocking, with 3s timeout)
  const updateInfo = await checkForUpdates();
  if (updateInfo) {
    console.log(
      chalk.yellow(
        `  \u2B06 ${chalk.dim(updateInfo.currentVersion)} \u2192 ${chalk.green(updateInfo.latestVersion)} ${chalk.dim(`(${updateInfo.updateCommand})`)}`,
      ),
    );
  }

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
  // Show COCO mode status
  const cocoStatus = isCocoMode()
    ? chalk.magenta("  \u{1F504} quality mode: ") +
      chalk.green.bold("on") +
      chalk.dim(" — iterates until quality \u2265 85. /coco to disable")
    : chalk.dim("  \u{1F4A1} /coco on — enable auto-test & quality iteration");
  console.log(cocoStatus);

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

// Re-export submodules
export * from "./agents/index.js";
export * from "./background/index.js";
export * from "./skills/index.js";
export * from "./progress/index.js";

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
