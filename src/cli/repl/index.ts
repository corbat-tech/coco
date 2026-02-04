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
import { getStateManager, formatStateStatus, getStateSummary } from "./state/index.js";
import { ensureConfiguredV2 } from "./onboarding-v2.js";

/**
 * Start the REPL
 */
export async function startRepl(
  options: {
    projectPath?: string;
    config?: Partial<ReplConfig>;
  } = {}
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
  let provider;
  try {
    provider = await createProvider(session.config.provider.type, {
      model: session.config.provider.model || undefined,
      maxTokens: session.config.provider.maxTokens,
    });
  } catch (error) {
    p.log.error(`Failed to initialize provider: ${error instanceof Error ? error.message : String(error)}`);
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
    if (intent.type !== 'chat' && intent.confidence >= 0.6) {
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

      const result = await executeAgentTurn(
        session,
        input,
        provider,
        toolRegistry,
        {
          onStream: renderStreamChunk,
          onToolStart: (tc, index, total) => {
            // Update spinner to show running tool
            const msg = total > 1
              ? `Running ${tc.name}... [${index}/${total}]`
              : `Running ${tc.name}...`;
            setSpinner(msg);
          },
          onToolEnd: (result) => {
            // Clear spinner and show result
            clearSpinner();
            renderToolStart(result.name, result.input);
            renderToolEnd(result);
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
          signal: abortController.signal,
        }
      );

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
            result.toolCalls.length
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
        result.toolCalls.length
      );

      // Check and perform context compaction if needed
      try {
        const usageBefore = getContextUsagePercent(session);
        const compactionResult = await checkAndCompactContext(session, provider);
        if (compactionResult?.wasCompacted) {
          const usageAfter = getContextUsagePercent(session);
          console.log(
            chalk.dim(`Context compacted (${usageBefore.toFixed(0)}% -> ${usageAfter.toFixed(0)}%)`)
          );
        }
      } catch (compactError) {
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
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  inputHandler.close();
}

/**
 * Print welcome message with project state
 */
async function printWelcome(session: { projectPath: string; config: ReplConfig }): Promise<void> {
  // Load project state
  const stateManager = getStateManager();
  const state = await stateManager.load(session.projectPath);
  const summary = getStateSummary(state);
  const trustStore = createTrustStore();
  await trustStore.init();
  const trustLevel = trustStore.getLevel(session.projectPath);
  
  console.log(
    chalk.cyan.bold(`
╔══════════════════════════════════════════════════╗
║         🥥 Corbat-Coco REPL                      ║
║   Autonomous Coding Agent v${VERSION.padEnd(31)}║
╚══════════════════════════════════════════════════╝
`)
  );
  
  // Project info
  console.log(chalk.dim(`📁 ${session.projectPath}`));
  
  // Trust status
  if (trustLevel) {
    const emoji = trustLevel === 'full' ? '🔓' : trustLevel === 'write' ? '✏️' : '👁️';
    console.log(chalk.dim(`${emoji} ${trustLevel} access`));
  }
  
  // State status
  console.log(`📊 ${formatStateStatus(state)}`);
  
  // Progress indicators
  console.log(
    chalk.dim(`   ${summary.spec ? '✅' : '⬜'} Spec  ${summary.architecture ? '✅' : '⬜'} Architecture  ${summary.implementation ? '✅' : '⬜'} Implementation`)
  );
  
  console.log();
  console.log(chalk.dim(`🤖 ${session.config.provider.type} / ${session.config.provider.model}`));
  
  // Contextual suggestion
  const suggestion = await stateManager.getSuggestion(session.projectPath);
  console.log();
  console.log(chalk.yellow(`💡 ${suggestion}`));
  
  console.log();
  console.log(chalk.dim('Type /help for commands, /exit to quit\n'));
}

export type { ReplConfig, ReplSession, AgentTurnResult } from "./types.js";

// Re-export submodules
export * from "./agents/index.js";
export * from "./background/index.js";
export * from "./skills/index.js";
export * from "./progress/index.js";

/**
 * Check and request project trust
 */
async function checkProjectTrust(projectPath: string): Promise<boolean> {
  const trustStore = createTrustStore();
  await trustStore.init();

  // Check if already trusted
  if (trustStore.isTrusted(projectPath)) {
    // Update last accessed
    await trustStore.touch(projectPath);
    return true;
  }

  // Show first-time access warning
  p.log.message("");
  p.log.message("🚀 Corbat-Coco REPL v" + VERSION);
  p.log.message("");
  p.log.message(`📁 Project: ${projectPath}`);
  p.log.warning("⚠️  First time accessing this directory");
  p.log.message("");
  p.log.message("This agent will:");
  p.log.message("  • Read files and directories");
  p.log.message("  • Write and modify files");
  p.log.message("  • Execute bash commands");
  p.log.message("  • Run tests and linters");
  p.log.message("  • Use Git operations");
  p.log.message("");

  // Ask for approval
  const approved = await p.select({
    message: "Allow access to this directory?",
    options: [
      { value: "write", label: "Yes, allow write access" },
      { value: "read", label: "Read-only (no file modifications)" },
      { value: "no", label: "No, exit" },
    ],
  });

  if (p.isCancel(approved) || approved === "no") {
    p.outro("Access denied. Exiting...");
    return false;
  }

  // Ask if remember decision
  const remember = await p.confirm({
    message: "Remember this decision for future sessions?",
    initialValue: true,
  });

  if (p.isCancel(remember)) {
    p.outro("Cancelled. Exiting...");
    return false;
  }

  if (remember) {
    await trustStore.addTrust(projectPath, approved as TrustLevel);
  }

  p.log.success("✓ Access granted. Type /trust to manage permissions.");
  p.log.message("");

  return true;
}

/**
 * Handle intent confirmation dialog
 * Returns true if the intent should be executed as a command
 */
async function handleIntentConfirmation(
  intent: Intent,
  recognizer: ReturnType<typeof createIntentRecognizer>
): Promise<boolean> {
  // Check if auto-execute is enabled
  if (recognizer.shouldAutoExecute(intent)) {
    return true;
  }

  // Show detected intent
  console.log();
  console.log(chalk.cyan(`🔍 Detected intent: /${intent.type} (confidence: ${(intent.confidence * 100).toFixed(0)}%)`));
  
  // Show extracted entities if any
  if (Object.keys(intent.entities).length > 0) {
    const entityStr = Object.entries(intent.entities)
      .filter(([, v]) => v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
      .join(', ');
    if (entityStr) {
      console.log(chalk.dim(`   Entities: ${entityStr}`));
    }
  }
  console.log();

  // Ask for confirmation
  const action = await p.select({
    message: `Execute /${intent.type} command?`,
    options: [
      { value: 'yes', label: '✓ Yes, execute command' },
      { value: 'no', label: '✗ No, continue as chat' },
      { value: 'always', label: '⚡ Always execute this intent' },
    ],
  });

  if (p.isCancel(action) || action === 'no') {
    return false;
  }

  if (action === 'always') {
    recognizer.setAutoExecutePreference(intent.type, true);
    console.log(chalk.dim(`   Auto-execute enabled for /${intent.type}`));
    return true;
  }

  return action === 'yes';
}
