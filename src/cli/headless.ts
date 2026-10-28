import { getInternalProviderId } from "../config/env.js";
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
import {
  createAgentRuntime,
  createToolCallingRuntimeTurnRunner,
  createFileRuntimeSessionStore,
} from "../runtime/index.js";
import { createFullToolRegistry } from "../tools/index.js";
import { loadAllowedPaths } from "../tools/allowed-paths.js";
import { readHeadlessStdin } from "./headless-stdin.js";
import { getTrustPattern } from "./repl/bash-patterns.js";
import type { ReplConfig } from "./repl/types.js";
import type { ProviderType } from "../providers/index.js";
import type { ToolCall } from "../providers/types.js";
import path from "node:path";
import { realpathSync } from "node:fs";

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
  /** Open a project-local runtime session. Requires an explicit safe identifier. */
  sessionId?: string;
  /** Select the most recently updated runtime session in this project. */
  continueSession?: boolean;
  /** Optional host cancellation; CLI signals are handled for this invocation only. */
  signal?: AbortSignal;
}

/**
 * Result of headless execution
 */
export interface HeadlessResult {
  sessionId?: string;
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
  const originalDirectory = process.cwd();
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
  let durableSessionId: string | undefined;
  try {
    if (options.sessionId && options.continueSession)
      throw new Error("--session and --continue cannot be combined");
    if (options.sessionId && !/^[A-Za-z0-9_-]{1,120}$/.test(options.sessionId))
      throw new Error("Invalid runtime session identifier");
    const useRuntimeRunner =
      options.useRuntimeRunner || !!options.sessionId || options.continueSession;
    if (options.outputFormat !== "text" && options.outputFormat !== "json")
      throw new Error("Invalid output format; expected text or json");
    const stdinContent = await readHeadlessStdin(process.stdin, { signal: controller.signal });
    let task = options.task?.trim() ?? "";
    if (task && stdinContent) task += `\n\n<piped-input>\n${stdinContent}\n</piped-input>`;
    else if (stdinContent) task = stdinContent;
    if (!task && !options.sessionId && !options.continueSession)
      throw new Error("No task provided. Pass a task as argument or pipe via stdin.");
    controller.signal.throwIfAborted();
    const canonicalProject = realpathSync(options.projectPath);
    options = { ...options, projectPath: canonicalProject };
    process.chdir(canonicalProject);
    const session = await createSession(options.projectPath, options.config);
    await initializeSessionTrust(session);
    const providerType = getInternalProviderId(
      session.config.provider.type as ProviderType,
      session.config.provider.authMethod,
    );
    const provider = await createProvider(providerType, {
      model: session.config.provider.model || undefined,
    });
    controller.signal.throwIfAborted();
    runtime = await createAgentRuntime({
      providerType,
      model: session.config.provider.model || undefined,
      provider,
      toolRegistry: createFullToolRegistry(),
      ...(useRuntimeRunner
        ? {
            runtimeSessionStore: createFileRuntimeSessionStore(
              path.join(options.projectPath, ".coco", "runtime-sessions.json"),
            ),
          }
        : {}),
      eventLogPath: path.join(options.projectPath, ".coco", "events", `${session.id}.jsonl`),
      turnRunner: useRuntimeRunner ? createToolCallingRuntimeTurnRunner() : undefined,
      publishToGlobalBridge: true,
      legacyAgentBridge: { setAgentProvider, setAgentToolRegistry },
    });
    session.runtime = runtime;
    await loadAllowedPaths(options.projectPath);
    await initializeContextManager(session, provider);
    controller.signal.throwIfAborted();
    if (useRuntimeRunner) {
      const projectPath = realpathSync(options.projectPath);
      const existing = options.sessionId
        ? runtime.getSession(options.sessionId)
        : options.continueSession
          ? runtime
              .listSessions()
              .filter((entry) => entry.metadata.projectPath === projectPath)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
          : undefined;
      if ((options.sessionId || options.continueSession) && !existing)
        throw new Error("Runtime session not found in this project");
      if (existing && existing.metadata.projectPath !== projectPath)
        throw new Error("Runtime session belongs to another project");
      const runtimeSession =
        existing ??
        runtime.createSession({
          mode: "build",
          instructions: session.config.agent.systemPrompt || undefined,
          metadata: {
            surface: "cli",
            product: "coco-code",
            execution: "headless-runtime-runner",
            projectPath,
          },
        });
      durableSessionId = runtimeSession.id;
      const recovery = runtime.inspectSessionRecovery(runtimeSession.id);
      const turnInput = {
        sessionId: runtimeSession.id,
        options: { signal: controller.signal, maxTokens: session.config.provider.maxTokens },
        metadata: { surface: "cli", product: "coco-code" },
        confirmToolCall: (call: Readonly<ToolCall>) =>
          session.trustedTools.has(getTrustPattern(call.name, call.input)),
      };
      const interrupted = recovery.turn && recovery.turn.status !== "completed";
      if (recovery.uncertainCalls.length > 0)
        throw new Error(
          "Uncertain tool effects require host inspection and resolution before resuming this session",
        );
      if (interrupted && task)
        throw new Error(
          "An interrupted turn exists; omit the new task to explicitly resume its recorded input",
        );
      if (!task && !interrupted)
        throw new Error("The session has no interrupted turn; provide a new task");
      const turn = interrupted
        ? await runtime.resumeTurn(turnInput)
        : await runtime.runTurn({ ...turnInput, content: task });
      result = {
        success: true,
        output: turn.content,
        toolsExecuted: runtime.eventLog.list().filter((event) => event.type === "tool.completed")
          .length,
        usage: turn.usage,
        sessionId: runtimeSession.id,
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
        success: !turn.aborted && !turn.error,
        output: turn.content,
        toolsExecuted: turn.toolCalls.length,
        usage: turn.usage,
        ...(turn.aborted
          ? { error: "Headless execution cancelled" }
          : turn.error
            ? { error: turn.error }
            : {}),
      };
      if (options.outputFormat === "text" && result.success)
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
    try {
      process.chdir(originalDirectory);
    } catch {
      result = headlessFailure("Could not restore the headless working directory");
    }
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    options.signal?.removeEventListener("abort", cancel);
    process.stdout.write = originalWrite;
    ownsOutput = false;
  }
  if (durableSessionId) result.sessionId = durableSessionId;
  writeHeadlessResult(result, options.outputFormat, writeOutput);
  return result;
}
