/**
 * REPL main entry point
 */

import chalk from "chalk";
import {
  createSession,
  initializeSessionTrust,
  initializeContextManager,
  checkAndCompactContext,
  getContextUsagePercent,
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
import {
  isSlashCommand,
  parseSlashCommand,
  executeSlashCommand,
  addTokenUsage,
} from "./commands/index.js";
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
    p.log.message(chalk.dim("\n👋 Setup cancelled. See you next time!"));
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
    p.log.error("❌ Provider is not available. Your API key may be invalid.");
    p.log.message(chalk.dim("\nTo reconfigure, run: coco --setup"));
    process.exit(1);
  }

  // Initialize context manager
  initializeContextManager(session, provider);

  // Load persisted allowed paths for this project
  await loadAllowedPaths(projectPath);

  // Initialize tool registry
  const toolRegistry = createFullToolRegistry();

  // Create input handler
  const inputHandler = createInputHandler(session);

  // Initialize intent recognizer
  const intentRecognizer = createIntentRecognizer();

  // Print welcome
  await printWelcome(session);

  // Main loop
  while (true) {
    const input = await inputHandler.prompt();

    // Handle EOF (Ctrl+D)
    if (input === null) {
      console.log(chalk.dim("\nGoodbye!"));
      break;
    }

    // Skip empty input
    if (!input) continue;

    // Handle slash commands
    if (isSlashCommand(input)) {
      const { command, args } = parseSlashCommand(input);
      const shouldExit = await executeSlashCommand(command, args, session);
      if (shouldExit) break;
      continue;
    }

    // Detect intent from natural language
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

    try {
      console.log(); // Blank line before response

      // Pause input to prevent typing interference during agent response
      inputHandler.pause();

      // Create abort controller for Ctrl+C cancellation
      const abortController = new AbortController();
      let wasAborted = false;

      const sigintHandler = () => {
        wasAborted = true;
        abortController.abort();
        clearSpinner();
        renderInfo("\nOperation cancelled");
      };

      process.once("SIGINT", sigintHandler);

      const result = await executeAgentTurn(session, input, provider, toolRegistry, {
        onStream: renderStreamChunk,
        onToolStart: (tc, index, total) => {
          // Update spinner to show running tool
          const msg =
            total > 1 ? `Running ${tc.name}... [${index}/${total}]` : `Running ${tc.name}...`;
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
          console.log(chalk.yellow(`⊘ Skipped ${tc.name}: ${reason}`));
        },
        onThinkingStart: () => {
          setSpinner("Thinking...");
        },
        onThinkingEnd: () => {
          clearSpinner();
        },
        onToolPreparing: (toolName) => {
          setSpinner(`Preparing ${toolName}...`);
        },
        onBeforeConfirmation: () => {
          // Clear spinner before showing confirmation dialog
          clearSpinner();
        },
        signal: abortController.signal,
      });

      // Remove SIGINT handler after agent turn completes
      process.off("SIGINT", sigintHandler);

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

      console.log(); // Blank line after response

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
      // Always clear spinner on error
      clearSpinner();
      // Don't show error for abort
      if (error instanceof Error && error.name === "AbortError") {
        continue;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for LM Studio context length error
      if (errorMsg.includes("context length") || errorMsg.includes("tokens to keep")) {
        renderError(errorMsg);
        console.log();
        console.log(chalk.yellow("   💡 This is a context length error."));
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
 * Brand color: Magenta/Purple 🟣
 */
async function printWelcome(session: { projectPath: string; config: ReplConfig }): Promise<void> {
  const trustStore = createTrustStore();
  await trustStore.init();
  const trustLevel = trustStore.getLevel(session.projectPath);

  // Box dimensions - fixed width for consistency
  const boxWidth = 41;
  const innerWidth = boxWidth - 4; // Account for "│ " and " │"

  // Build content lines with proper padding
  // Note: Emoji 🥥 takes 2 visual chars, so we subtract 1 from padding calculation
  const titleText = "CORBAT-COCO";
  const versionText = `v${VERSION}`;
  const titlePadding = innerWidth - titleText.length - versionText.length - 2; // -2 for emoji visual width adjustment
  const subtitleText = "open source • corbat.tech";
  const subtitlePadding = innerWidth - subtitleText.length;

  console.log();
  console.log(chalk.magenta("  ╭" + "─".repeat(boxWidth - 2) + "╮"));
  console.log(
    chalk.magenta("  │ ") +
      "🥥 " +
      chalk.bold.white(titleText) +
      " ".repeat(titlePadding) +
      chalk.dim(versionText) +
      chalk.magenta(" │"),
  );
  console.log(
    chalk.magenta("  │ ") +
      chalk.dim(subtitleText) +
      " ".repeat(subtitlePadding) +
      chalk.magenta(" │"),
  );
  console.log(chalk.magenta("  ╰" + "─".repeat(boxWidth - 2) + "╯"));

  // Check for updates (non-blocking, with 3s timeout)
  const updateInfo = await checkForUpdates();
  if (updateInfo) {
    console.log(
      chalk.yellow(
        `  ⬆ ${chalk.dim(updateInfo.currentVersion)} → ${chalk.green(updateInfo.latestVersion)} ${chalk.dim(`(${updateInfo.updateCommand})`)}`,
      ),
    );
  }

  // Project info - single compact block
  const maxPathLen = 50;
  let displayPath = session.projectPath;
  if (displayPath.length > maxPathLen) {
    displayPath = "..." + displayPath.slice(-maxPathLen + 3);
  }

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
  console.log(chalk.dim(`  📁 ${displayPath}`));
  console.log(
    chalk.dim(`  🤖 ${providerName}/`) +
      chalk.magenta(modelName) +
      (trustText ? chalk.dim(` • 🔐 ${trustText}`) : ""),
  );
  console.log();
  console.log(
    chalk.dim("  Type your request or ") + chalk.magenta("/help") + chalk.dim(" for commands"),
  );
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
  console.log(chalk.cyan.bold("  🥥 Corbat-Coco") + chalk.dim(` v${VERSION}`));
  console.log(chalk.dim(`  📁 ${projectPath}`));
  console.log();
  console.log(chalk.yellow("  ⚠ First time accessing this directory"));
  console.log(chalk.dim("  This agent can: read/write files, run commands, git ops"));
  console.log();

  // Ask for approval
  const approved = await p.select({
    message: "Grant access?",
    options: [
      { value: "write", label: "✓ Write access (recommended)" },
      { value: "read", label: "◐ Read-only" },
      { value: "no", label: "✗ Deny & exit" },
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

  console.log(chalk.green("  ✓ Access granted") + chalk.dim(" • /trust to manage"));
  return true;
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
      `🔍 Detected intent: /${intent.type} (confidence: ${(intent.confidence * 100).toFixed(0)}%)`,
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
      { value: "yes", label: "✓ Yes, execute command" },
      { value: "no", label: "✗ No, continue as chat" },
      { value: "always", label: "⚡ Always execute this intent" },
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
