/**
 * REPL main entry point
 */

import chalk from "chalk";
import { createSession, initializeSessionTrust } from "./session.js";
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

  // Initialize provider
  const provider = await createProvider(session.config.provider.type, {
    model: session.config.provider.model || undefined,
    maxTokens: session.config.provider.maxTokens,
  });

  // Check provider availability
  const available = await provider.isAvailable();
  if (!available) {
    renderError(
      "LLM provider is not available. Check your API key and connection."
    );
    process.exit(1);
  }

  // Initialize tool registry
  const toolRegistry = createFullToolRegistry();

  // Create input handler
  const inputHandler = createInputHandler(session);

  // Print welcome
  printWelcome(session);

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

    // Execute agent turn
    try {
      console.log(); // Blank line before response

      // Create spinner for thinking/working indicator
      let thinkingSpinner: Spinner | null = null;
      let currentToolSpinner: Spinner | null = null;

      // Create abort controller for Ctrl+C cancellation
      const abortController = new AbortController();
      let wasAborted = false;

      const sigintHandler = () => {
        wasAborted = true;
        abortController.abort();
        // Clear spinners if active
        if (thinkingSpinner) {
          process.stdout.write("\r\x1b[K");
          thinkingSpinner = null;
        }
        if (currentToolSpinner) {
          process.stdout.write("\r\x1b[K");
          currentToolSpinner = null;
        }
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
            // Show tool execution spinner with counter
            currentToolSpinner = createSpinner(`Running ${tc.name}...`);
            if (total > 1) {
              currentToolSpinner.setToolCount(index, total);
            }
            currentToolSpinner.start();
          },
          onToolEnd: (result) => {
            // Stop tool spinner and show result
            if (currentToolSpinner) {
              process.stdout.write("\r\x1b[K");
              currentToolSpinner = null;
            }
            renderToolStart(result.name, result.input);
            renderToolEnd(result);
          },
          onToolSkipped: (tc, reason) => {
            if (currentToolSpinner) {
              process.stdout.write("\r\x1b[K");
              currentToolSpinner = null;
            }
            console.log(chalk.yellow(`⊘ Skipped ${tc.name}: ${reason}`));
          },
          onThinkingStart: () => {
            thinkingSpinner = createSpinner("Thinking...");
            thinkingSpinner.start();
          },
          onThinkingEnd: () => {
            if (thinkingSpinner) {
              // Clear spinner line without printing final message
              process.stdout.write("\r\x1b[K");
              thinkingSpinner = null;
            }
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

      console.log(); // Extra spacing
    } catch (error) {
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
 * Print welcome message
 */
function printWelcome(session: { projectPath: string; config: ReplConfig }): void {
  console.log(
    chalk.cyan.bold(`
╔═══════════════════════════════════════╗
║         Corbat-Coco REPL              ║
║   Autonomous Coding Agent v${VERSION.padEnd(10)}║
╚═══════════════════════════════════════╝
`)
  );
  console.log(chalk.dim(`Project: ${session.projectPath}`));
  console.log(chalk.dim(`Provider: ${session.config.provider.type}`));
  console.log(chalk.dim(`Model: ${session.config.provider.model}`));
  console.log(chalk.dim(`Type /help for commands, /exit to quit\n`));
}

export type { ReplConfig, ReplSession, AgentTurnResult } from "./types.js";
