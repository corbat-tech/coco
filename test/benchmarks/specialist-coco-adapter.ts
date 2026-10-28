import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { z } from "zod";
import { executeAgentTurn } from "../../src/cli/repl/agent-loop.js";
import { SessionStore } from "../../src/cli/repl/sessions/storage.js";
import type { ReplSession } from "../../src/cli/repl/types.js";
import type {
  LLMProvider,
  ChatOptions,
  ChatWithToolsOptions,
  Message,
  StreamChunk,
} from "../../src/providers/types.js";
import type { ThinkingMode } from "../../src/providers/thinking.js";
import { PROVIDER_IDS, type ProviderType } from "../../src/providers/provider-types.js";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import { createFileRuntimeSessionStore } from "../../src/runtime/runtime-session-store.js";
import { createPermissionPolicy } from "../../src/runtime/permission-policy.js";
import { redactSecrets } from "../../src/runtime/guardrails.js";
import type { PermissionPolicy } from "../../src/runtime/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { resolvePathSecurely } from "../../src/tools/file-path-policy.js";
import { spawnSimpleAgentTool } from "../../src/tools/simple-agent.js";
import { delegateTaskTool } from "../../src/tools/agent-coordinator.js";
import type {
  EvaluationAdapterResult,
  SpecialistEvaluationOptions,
} from "./specialist-evaluation.js";

/** Acceptance implementations must exclude this host-owned evidence directory. */
export const COCO_EVALUATION_ARTIFACT_DIRECTORY = ".coco-evaluation";
export interface CocoEvaluationAdapterOptions {
  /** Already constructed by the caller. This factory never initializes a provider or loads auth. */
  provider: LLMProvider;
  /** Optional runtime label for custom injected adapters whose id is not a standard provider ID. */
  providerType?: ProviderType;
  model: string;
  thinking?: ThinkingMode;
  maxTurns: number;
  maxTokens: number;
  /** Exact project-relative solution files from the frozen case manifest; default is source files under src/. */
  writablePaths?: readonly string[];
  executePublicTests(
    workspace: string,
    signal: AbortSignal,
  ): Promise<{ success: boolean; output: string }>;
}

const MAX_FILE_BYTES = 128 * 1024;
const SYSTEM =
  "Complete the bounded user task in the supplied workspace. Use only offered tools. Keep simple work direct. If delegation is enabled, use delegateTask assignments only for a bounded independent decomposition. Acceptance is checked externally; never infer it from your own score. Run the offered run_tests tool for observed verification. No shell or network is available.";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function scopedRegistry(
  workspace: string,
  signal: AbortSignal,
  executePublicTests: CocoEvaluationAdapterOptions["executePublicTests"],
  writablePaths?: readonly string[],
): ToolRegistry {
  const registry = new ToolRegistry();
  const activeSignal = (local?: AbortSignal) => (local ? AbortSignal.any([signal, local]) : signal);
  const resolve = async (input: string, operation: "read" | "write", local?: AbortSignal) => {
    signal.throwIfAborted();
    local?.throwIfAborted();
    const result = await resolvePathSecurely(input, operation, {
      projectRoot: workspace,
      allowedPaths: [],
      allowHomeConfigReads: false,
    });
    activeSignal(local).throwIfAborted();
    if (
      path.relative(workspace, result).split(path.sep).includes(COCO_EVALUATION_ARTIFACT_DIRECTORY)
    )
      throw new Error("Evaluation evidence is host-owned and unavailable to agent tools.");
    if (operation === "write") {
      const relative = path.relative(workspace, result).split(path.sep).join("/");
      if (
        /(?:^|\/)(?:tests?|__tests__|__fixtures__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(
          relative,
        )
      )
        throw new Error("Evaluation tests and package manifests are immutable.");
      if (writablePaths) {
        const allowed = await Promise.all(
          writablePaths.map((file) =>
            resolvePathSecurely(file, "write", {
              projectRoot: workspace,
              allowedPaths: [],
              allowHomeConfigReads: false,
            }),
          ),
        );
        if (!allowed.includes(result))
          throw new Error("File is outside the host-declared solution files.");
      } else if (!relative.startsWith("src/"))
        throw new Error("Only source files under src/ are writable by default.");
    }
    return result;
  };
  const content = z.string().max(MAX_FILE_BYTES);
  registry.register({
    name: "read_file",
    description: "Read a UTF-8 workspace file (128 KiB maximum).",
    category: "file",
    parameters: z.object({ path: z.string() }),
    execute: async ({ path: file }: { path: string }, context) => {
      const bytes = await readFile(await resolve(file, "read", context?.signal), {
        signal: activeSignal(context?.signal),
      });
      if (bytes.length > MAX_FILE_BYTES) throw new Error("File exceeds evaluation read limit.");
      return { content: bytes.toString("utf8") };
    },
  });
  registry.register({
    name: "write_file",
    description: "Write a UTF-8 workspace file.",
    category: "file",
    parameters: z.object({
      path: z.string(),
      content,
      expectedContentHash: z.string().nullable().optional(),
      createDirs: z.boolean().optional(),
    }),
    execute: async (
      input: {
        path: string;
        content: string;
        expectedContentHash?: string | null;
        createDirs?: boolean;
      },
      context,
    ) => {
      const target = await resolve(input.path, "write", context?.signal);
      let before: string | undefined;
      try {
        before = await readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (
        input.expectedContentHash !== undefined &&
        (before === undefined ? null : hash(before)) !== input.expectedContentHash
      )
        throw new Error("File content precondition failed.");
      activeSignal(context?.signal).throwIfAborted();
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, {
        encoding: "utf8",
        signal: activeSignal(context?.signal),
      });
      return { path: input.path, size: Buffer.byteLength(input.content) };
    },
  });
  registry.register({
    name: "edit_file",
    description: "Replace one exact, unambiguous text occurrence in a workspace file.",
    category: "file",
    parameters: z.object({ path: z.string(), oldText: content.min(1), newText: content }),
    execute: async (input: { path: string; oldText: string; newText: string }, context) => {
      const target = await resolve(input.path, "write", context?.signal);
      const before = await readFile(target, "utf8");
      if (Buffer.byteLength(before) > MAX_FILE_BYTES || before.split(input.oldText).length !== 2)
        throw new Error("Edit requires a bounded file and one exact match.");
      activeSignal(context?.signal).throwIfAborted();
      await writeFile(target, before.replace(input.oldText, input.newText), {
        encoding: "utf8",
        signal: activeSignal(context?.signal),
      });
      return { path: input.path, replacements: 1 };
    },
  });
  registry.register({
    name: "list_dir",
    description: "List a workspace directory.",
    category: "file",
    parameters: z.object({ path: z.string().default(".") }),
    execute: async (input: { path: string }, context) => ({
      entries: (await readdir(await resolve(input.path, "read", context?.signal)))
        .filter((name) => name !== COCO_EVALUATION_ARTIFACT_DIRECTORY)
        .slice(0, 200),
    }),
  });
  registry.register({
    name: "glob",
    description: "Find workspace files using a relative glob, without traversal.",
    category: "search",
    parameters: z.object({ pattern: z.string().max(500) }),
    execute: async (input: { pattern: string }, context) => {
      activeSignal(context?.signal).throwIfAborted();
      if (
        path.isAbsolute(input.pattern) ||
        /[\\\0]/.test(input.pattern) ||
        input.pattern.split("/").includes("..")
      )
        throw new Error("Glob must be project-relative without traversal.");
      const files: string[] = [];
      let visited = 0;
      const visit = async (relative: string): Promise<void> => {
        const folder = await resolve(relative || ".", "read", context?.signal);
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          if (++visited > 4096)
            throw new Error("Workspace exceeds evaluation glob traversal limit.");
          if (entry.isSymbolicLink() || entry.name === COCO_EVALUATION_ARTIFACT_DIRECTORY) continue;
          const file = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) await visit(file);
          else if (entry.isFile() && minimatch(file, input.pattern)) {
            await resolve(file, "read", context?.signal);
            if (files.length < 200) files.push(file);
          }
        }
      };
      await visit("");
      return { files: files.sort() };
    },
  });
  registry.register({
    name: "run_tests",
    description:
      "Execute the fixed host-provided public tests. No model-authored command is accepted.",
    category: "test",
    parameters: z.object({}).strict(),
    execute: async (_input, context) => {
      const activeSignal = context?.signal ? AbortSignal.any([signal, context.signal]) : signal;
      activeSignal.throwIfAborted();
      const result = await executePublicTests(workspace, activeSignal);
      activeSignal.throwIfAborted();
      const output =
        result.output.length > 8000
          ? `${result.output.slice(0, 7950)}\n[public test output truncated]`
          : result.output;
      if (!result.success) throw new Error(`Public tests failed: ${output}`);
      return { ...result, output };
    },
  });
  registry.register(spawnSimpleAgentTool);
  registry.register(delegateTaskTool);
  return registry;
}

/** Explicit evaluation-host authority. Underlying read-only mode decisions still apply. */
function hostPolicy(registry: ToolRegistry): PermissionPolicy {
  const base = createPermissionPolicy();
  return {
    canExecuteTool(mode, tool) {
      return {
        ...base.canExecuteTool(mode, tool),
        requiresConfirmation: false,
        ...(registry.has(tool.name)
          ? {}
          : { allowed: false, reason: "Tool not offered by evaluation host." }),
      };
    },
    canExecuteToolInput(mode, tool, input) {
      return {
        ...base.canExecuteToolInput!(mode, tool, input),
        requiresConfirmation: false,
        ...(registry.has(tool.name)
          ? {}
          : { allowed: false, reason: "Tool not offered by evaluation host." }),
      };
    },
  };
}

/** Returns an executable harness adapter; constructing it performs no model requests. */
export function createCocoEvaluationAdapter(
  options: CocoEvaluationAdapterOptions,
): SpecialistEvaluationOptions["runCase"] {
  if (
    !options.model.trim() ||
    [options.maxTurns, options.maxTokens].some((value) => !Number.isSafeInteger(value) || value < 1)
  )
    throw new Error("A model and positive request/output limits are required.");
  if (
    options.writablePaths?.some(
      (file) =>
        !file ||
        path.isAbsolute(file) ||
        /[\\\0*?]/.test(file) ||
        file.split("/").some((part) => !part || part === "." || part === ".."),
    )
  )
    throw new Error(
      "Writable solution files must be exact project-relative paths without traversal.",
    );
  return async (context) => {
    context.signal.throwIfAborted();
    const workspace = await realpath(path.resolve(context.workspace));
    const artifacts = path.join(workspace, COCO_EVALUATION_ARTIFACT_DIRECTORY);
    await mkdir(artifacts, { mode: 0o700 });
    const trace: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let known = true;
    let calls = 0;
    const provider = options.provider;
    const request = (method: string, requestOptions: ChatOptions) => {
      context.signal.throwIfAborted();
      if (++calls > options.maxTurns) throw new Error("Evaluation host request ceiling exhausted.");
      trace.push(
        JSON.stringify({
          event: "provider.request",
          method,
          requestedModel: requestOptions.model ?? options.model,
          requestedThinking: requestOptions.thinking ?? options.thinking,
          requestedMaxTokens: requestOptions.maxTokens,
        }),
      );
      return {
        ...requestOptions,
        signal: requestOptions.signal
          ? AbortSignal.any([context.signal, requestOptions.signal])
          : context.signal,
      };
    };
    const observe = (value?: { inputTokens: number; outputTokens: number }) => {
      const valid = Boolean(
        value &&
        [value.inputTokens, value.outputTokens].every(
          (token) => Number.isSafeInteger(token) && token >= 0,
        ),
      );
      if (!valid) known = false;
      else if (value) {
        usage.inputTokens += value.inputTokens;
        usage.outputTokens += value.outputTokens;
      }
      trace.push(
        JSON.stringify({ event: "provider.usage", known: valid, usage: valid ? value : undefined }),
      );
    };
    const chat = async (
      method: "chat" | "chatWithTools",
      messages: Message[],
      requestOptions: ChatWithToolsOptions,
    ) => {
      const bounded = request(method, requestOptions);
      try {
        const response =
          method === "chat"
            ? await provider.chat(messages, bounded)
            : await provider.chatWithTools(messages, { ...bounded, tools: requestOptions.tools });
        observe(response.usage);
        trace.push(
          JSON.stringify({
            event: "provider.response",
            reportedModel: response.model,
            stopReason: response.stopReason,
          }),
        );
        return response;
      } catch (error) {
        observe();
        throw error;
      }
    };
    const wrapped = new Proxy(provider, {
      get(target, property) {
        if (property === "chat")
          return (messages: Message[], requestOptions: ChatOptions = {}) =>
            chat("chat", messages, { ...requestOptions, tools: [] });
        if (property === "chatWithTools")
          return (messages: Message[], requestOptions: ChatWithToolsOptions) =>
            chat("chatWithTools", messages, requestOptions);
        if (property === "stream" || property === "streamWithTools")
          return async function* (
            messages: Message[],
            requestOptions: ChatWithToolsOptions,
          ): AsyncIterable<StreamChunk> {
            const bounded = request(String(property), requestOptions);
            // The public stream contract exposes no usage receipt; never relabel estimates as observed usage.
            observe();
            const stream =
              property === "stream"
                ? provider.stream(messages, bounded)
                : provider.streamWithTools(messages, { ...bounded, tools: requestOptions.tools });
            for await (const chunk of stream) {
              context.signal.throwIfAborted();
              yield chunk;
            }
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const providerType =
      options.providerType ??
      (PROVIDER_IDS.includes(provider.id as ProviderType)
        ? (provider.id as ProviderType)
        : "openai");
    trace.push(
      JSON.stringify({
        event: "evaluation.adapter",
        injectedProviderId: provider.id,
        runtimeProviderType: providerType,
        outputTokenLimit: "requested; provider-side enforcement must be verified separately",
        streamUsage: "unknown",
      }),
    );
    const registry = scopedRegistry(
      workspace,
      context.signal,
      options.executePublicTests,
      options.writablePaths,
    );
    const runtime = new AgentRuntime({
      providerType,
      provider: wrapped,
      model: options.model,
      toolRegistry: registry,
      permissionPolicy: hostPolicy(registry),
      runtimeSessionStore: createFileRuntimeSessionStore(path.join(artifacts, "runtime.json")),
    });
    const session: ReplSession = {
      id: `eval-${randomUUID()}`,
      startedAt: new Date(),
      messages: [],
      projectPath: workspace,
      trustedTools: new Set(),
      runtime,
      config: {
        provider: {
          type: providerType,
          model: options.model,
          thinking: options.thinking,
          maxTokens: options.maxTokens,
        },
        ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "never" },
        agent: {
          systemPrompt: `${SYSTEM}\nWritable solution files: ${JSON.stringify(options.writablePaths ?? "Source files under src/; tests and manifests are immutable")}`,
          maxToolIterations: options.maxTurns,
          confirmDestructive: true,
          delegation: {
            mode:
              context.configuration === "direct"
                ? "off"
                : context.configuration === "manual"
                  ? "manual"
                  : "auto",
          },
        },
      },
    };
    if (context.configuration === "manual")
      session.pendingDelegation = { type: "refactor", task: context.task };
    const store = new SessionStore({ storageDir: path.join(artifacts, "sessions") });
    let outcome: EvaluationAdapterResult;
    let answer = "";
    try {
      const result = await executeAgentTurn(session, context.task, wrapped, registry, {
        signal: context.signal,
        skipConfirmation: true,
        onCheckpoint: () => store.save(session),
      });
      answer = result.content;
      outcome = {
        status: result.aborted || result.error ? "failed" : "completed",
        error: result.error,
        usage: known ? usage : undefined,
      };
    } catch (error) {
      answer = `Execution failed: ${error instanceof Error ? error.message : String(error)}`;
      outcome = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        usage: known ? usage : undefined,
      };
    } finally {
      await runtime.close();
    }
    await writeFile(path.join(artifacts, "answer.txt"), redactSecrets(answer).content, {
      mode: 0o600,
    });
    trace.push(
      ...runtime.eventLog
        .list()
        .map((event) => JSON.stringify({ event: event.type, ...event.data })),
    );
    const sanitized = trace.map((item) => redactSecrets(item).content);
    await writeFile(path.join(artifacts, "trace.json"), JSON.stringify(sanitized, null, 2), {
      mode: 0o600,
    });
    return { ...outcome, trace: sanitized };
  };
}
