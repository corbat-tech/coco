/**
 * Headless/CI mode for Coco
 *
 * Non-interactive execution that reads a task from args or stdin,
 * runs the agent, and writes output to stdout.
 *
 * Supports Unix composability patterns:
 *   coco -P "review this code"                    # Task from args
 *   echo "fix the bug" | coco -P                  # Task from stdin
 *   git diff | coco -P "review these changes"     # Piped content + task
 *   cat error.log | coco -P "explain these errors" # Piped file content + task
 *   coco -P --output json "analyze security"      # JSON output
 */

import { createSession, initializeSessionTrust, initializeContextManager } from "./repl/session.js";
import { executeAgentTurn } from "./repl/agent-loop.js";
import { createProvider } from "../providers/index.js";
import { createFullToolRegistry } from "../tools/index.js";
import { setAgentProvider, setAgentToolRegistry } from "../agents/provider-bridge.js";
import { loadAllowedPaths } from "../tools/allowed-paths.js";
import { registerGlobalCleanup } from "../utils/subprocess-registry.js";
import type { ReplConfig } from "./repl/types.js";
import type { ProviderType } from "../providers/index.js";

/**
 * Options for headless execution
 */
export interface HeadlessOptions {
  /** Task to execute (from args) */
  task?: string;
  /** Project path */
  projectPath: string;
  /** Output format */
  outputFormat: "text" | "json";
  /** Provider configuration */
  config?: Partial<ReplConfig>;
}

/**
 * Result of headless execution
 */
export interface HeadlessResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Agent output text */
  output: string;
  /** Number of tools executed */
  toolsExecuted: number;
  /** Token usage */
  usage: { inputTokens: number; outputTokens: number };
  /** Error message if failed */
  error?: string;
}

/**
 * Read task from stdin (for piped input)
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    // 5 seconds to allow slow pipe producers (e.g., large git diff) to start writing
    const timeout = setTimeout(() => {
      resolve("");
    }, 5000);

    process.stdin.on("data", (chunk) => {
      clearTimeout(timeout);
      chunks.push(Buffer.from(chunk));
    });

    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8").trim());
    });

    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // If stdin is a TTY (not piped), resolve immediately
    if (process.stdin.isTTY) {
      clearTimeout(timeout);
      resolve("");
    }
  });
}

/**
 * Run Coco in headless mode
 *
 * @param options - Headless execution options
 * @returns Execution result
 */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  registerGlobalCleanup();

  // Unix composability: combine piped stdin content with task argument
  // Patterns:
  //   coco -P "task"                  → task = "task"
  //   echo "task" | coco -P           → task = "task" (from stdin)
  //   git diff | coco -P "review"     → task = "review\n\n<stdin content>"
  const stdinContent = await readStdin();
  let task = options.task ?? "";

  if (task && stdinContent) {
    // Both task and piped content: combine them
    task = `${task}\n\n<piped-input>\n${stdinContent}\n</piped-input>`;
  } else if (!task && stdinContent) {
    // Only piped content: use as task
    task = stdinContent;
  }

  if (!task) {
    return {
      success: false,
      output: "",
      toolsExecuted: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: "No task provided. Pass a task as argument or pipe via stdin.",
    };
  }

  try {
    // Create session
    const session = createSession(options.projectPath, options.config);
    await initializeSessionTrust(session);

    // Create provider
    const providerType = session.config.provider.type as ProviderType;
    const provider = await createProvider(providerType, {
      model: session.config.provider.model || undefined,
    });

    // Create tool registry
    const toolRegistry = createFullToolRegistry();
    setAgentProvider(provider);
    setAgentToolRegistry(toolRegistry);

    // Load allowed paths
    await loadAllowedPaths(options.projectPath);

    // Initialize context manager
    await initializeContextManager(session, provider);

    // Execute agent turn
    const result = await executeAgentTurn(
      session,
      task,
      provider,
      toolRegistry,
      {
        skipConfirmation: true, // No interactive confirmations in headless mode
        onStream: (chunk) => {
          // In text mode, stream output to stdout in real-time
          if (options.outputFormat === "text" && chunk.type === "text" && chunk.text) {
            process.stdout.write(chunk.text);
          }
        },
      },
    );

    const headlessResult: HeadlessResult = {
      success: !result.aborted,
      output: result.content,
      toolsExecuted: result.toolCalls.length,
      usage: result.usage,
    };

    // Output based on format
    if (options.outputFormat === "json") {
      process.stdout.write(JSON.stringify(headlessResult, null, 2) + "\n");
    } else if (options.outputFormat === "text") {
      // Text was already streamed, just add a newline
      process.stdout.write("\n");
    }

    return headlessResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const headlessResult: HeadlessResult = {
      success: false,
      output: "",
      toolsExecuted: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: errorMsg,
    };

    if (options.outputFormat === "json") {
      process.stdout.write(JSON.stringify(headlessResult, null, 2) + "\n");
    } else {
      process.stderr.write(`Error: ${errorMsg}\n`);
    }

    return headlessResult;
  }
}
