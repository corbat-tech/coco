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
import { setAgentProvider, setAgentToolRegistry } from "../agents/provider-bridge.js";
import { createAgentRuntime, createToolCallingRuntimeTurnRunner } from "../runtime/index.js";
import { createFullToolRegistry } from "../tools/index.js";
import { loadAllowedPaths } from "../tools/allowed-paths.js";
import { readHeadlessStdin } from "./headless-stdin.js";
import type { ReplConfig } from "./repl/types.js";
import type { ProviderType } from "../providers/index.js";
import path from "node:path";

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
  /**
   * Experimental: run the direct task through the reusable runtime tool-calling
   * runner instead of the legacy REPL loop.
   */
  useRuntimeRunner?: boolean;
  /** Optional host cancellation; CLI signals are handled for this invocation only. */
  signal?: AbortSignal;
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

/** Existing JSON result shape, shared by execution and CLI preflight errors. */
export function headlessFailure(message: string): HeadlessResult {
  return {
    success: false,
    output: "",
    toolsExecuted: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    error: message,
  };
}

export function writeHeadlessResult(
  result: HeadlessResult,
  format: "text" | "json",
  write = process.stdout.write.bind(process.stdout),
): void {
  if (format === "json") write(JSON.stringify(result, null, 2) + "\n");
  else if (!result.success)
    process.stderr.write(`Error: ${result.error ?? "Headless execution failed"}\n`);
}

let ownsOutput = false;
/** Run one CLI-owned invocation; diagnostics are routed away from the result stream. */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  if (ownsOutput)
    throw new Error("Concurrent headless output is unsupported; use separate processes");
  ownsOutput = true;
  const originalWrite = process.stdout.write;
  const writeOutput = originalWrite.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Headless execution cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let runtime: Awaited<ReturnType<typeof createAgentRuntime>> | undefined;
  let result: HeadlessResult = headlessFailure("Headless execution did not complete");
  try {
    if (options.outputFormat !== "text" && options.outputFormat !== "json")
      throw new Error("Invalid output format; expected text or json");
    const stdinContent = await readHeadlessStdin(process.stdin, { signal: controller.signal });
    let task = options.task?.trim() ?? "";
    if (task && stdinContent) task += `\n\n<piped-input>\n${stdinContent}\n</piped-input>`;
    else if (stdinContent) task = stdinContent;
    if (!task) throw new Error("No task provided. Pass a task as argument or pipe via stdin.");
    controller.signal.throwIfAborted();
    const session = await createSession(options.projectPath, options.config);
    await initializeSessionTrust(session);
    const providerType = session.config.provider.type as ProviderType;
    const provider = await createProvider(providerType, {
      model: session.config.provider.model || undefined,
    });
    controller.signal.throwIfAborted();
    runtime = await createAgentRuntime({
      providerType,
      model: session.config.provider.model || undefined,
      provider,
      toolRegistry: createFullToolRegistry(),
      eventLogPath: path.join(options.projectPath, ".coco", "events", `${session.id}.jsonl`),
      turnRunner: options.useRuntimeRunner ? createToolCallingRuntimeTurnRunner() : undefined,
      publishToGlobalBridge: true,
      legacyAgentBridge: { setAgentProvider, setAgentToolRegistry },
    });
    session.runtime = runtime;
    await loadAllowedPaths(options.projectPath);
    await initializeContextManager(session, provider);
    controller.signal.throwIfAborted();
    if (options.useRuntimeRunner) {
      const runtimeSession = runtime.createSession({
        id: session.id,
        mode: "build",
        instructions: session.config.agent.systemPrompt || undefined,
        metadata: { surface: "cli", product: "coco-code", execution: "headless-runtime-runner" },
      });
      const turn = await runtime.runTurn({
        sessionId: runtimeSession.id,
        content: task,
        options: { signal: controller.signal },
        metadata: { surface: "cli", product: "coco-code" },
      });
      result = {
        success: true,
        output: turn.content,
        toolsExecuted: runtime.eventLog.list().filter((event) => event.type === "tool.completed")
          .length,
        usage: turn.usage,
      };
      if (options.outputFormat === "text") writeOutput(turn.content + "\n");
    } else {
      let streamed = false;
      const turn = await executeAgentTurn(session, task, provider, runtime.toolRegistry, {
        skipConfirmation: true,
        signal: controller.signal,
        onStream: (chunk) => {
          if (options.outputFormat === "text" && chunk.type === "text" && chunk.text) {
            streamed = true;
            writeOutput(chunk.text);
          }
        },
      });
      result = {
        success: !turn.aborted,
        output: turn.content,
        toolsExecuted: turn.toolCalls.length,
        usage: turn.usage,
        ...(turn.aborted ? { error: "Headless execution cancelled" } : {}),
      };
      if (options.outputFormat === "text" && !turn.aborted)
        writeOutput((streamed ? "" : turn.content) + "\n");
    }
    controller.signal.throwIfAborted();
  } catch (error) {
    result = headlessFailure(
      controller.signal.aborted
        ? "Headless execution cancelled"
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    try {
      await runtime?.close();
    } catch {
      result = headlessFailure("Headless runtime cleanup failed");
    }
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    options.signal?.removeEventListener("abort", cancel);
    process.stdout.write = originalWrite;
    ownsOutput = false;
  }
  writeHeadlessResult(result, options.outputFormat, writeOutput);
  return result;
}
