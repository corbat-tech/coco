import { AgentManager } from "./agents/manager.js";
import { decideDelegation, parseDelegationIntent } from "../../runtime/delegation-policy.js";
import type { AgentType } from "../../runtime/agent-type.js";
import type { DelegatedToolCall, ToolExecutionContext } from "../../tools/execution-context.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { LLMProvider } from "../../providers/types.js";
import type { ChatOptions, Message } from "../../providers/types.js";
import type { ReplDelegationRun, ReplSession } from "./types.js";
import { randomUUID } from "node:crypto";
import { confirmToolExecutionWithFallback } from "./confirmation.js";
import { getTrustPattern } from "./bash-patterns.js";
import type { AgentTurnOptions } from "./agent-loop.js";
import type { AgentTurnResult, ExecutedToolCall } from "./types.js";
import type { AgentRunResult } from "../../runtime/multi-agent.js";
import { DelegationBudget } from "../../runtime/delegation-budget.js";
import { redactSecrets } from "../../runtime/guardrails.js";
import { saveTrustedTool } from "./session.js";

export type SessionAgentRunner = NonNullable<ToolExecutionContext["runAgent"]> & {
  budget: DelegationBudget;
};

/** Auxiliary summaries consume the same admission budget as parent and worker requests. */
export function budgetCompactionProvider(
  provider: LLMProvider,
  budget: DelegationBudget,
  defaultOutputReserve: number,
): LLMProvider {
  const chat = async (messages: Message[], options: ChatOptions = {}) => {
    const reservation = budget.reserve({
      estimatedInputTokens: Math.ceil(
        JSON.stringify({ messages, system: options.system }).length / 3,
      ),
      maxOutputTokens: options.maxTokens ?? defaultOutputReserve,
    });
    let response: Awaited<ReturnType<LLMProvider["chat"]>>;
    try {
      response = await provider.chat(messages, options);
    } catch (error) {
      reservation.settle();
      throw error;
    }
    reservation.settle(response.usage);
    return response;
  };
  // Preserve method receivers for providers with private instance state. Unsupported
  // auxiliary request paths fail closed instead of silently escaping accounting.
  return new Proxy(provider, {
    get(target, property) {
      if (property === "chat") return chat;
      if (["chatWithTools", "stream", "streamWithTools"].includes(String(property)))
        return () => {
          throw new Error(
            "Unsupported auxiliary model request; run explicit compaction separately",
          );
        };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const managers = new WeakMap<
  ReplSession,
  { provider: LLMProvider; registry: ToolRegistry; manager: AgentManager }
>();
const READ_ONLY_WORKERS = new Set<AgentType>([
  "explore",
  "plan",
  "architect",
  "review",
  "security",
]);

/** Session ownership never relies on the legacy process-global provider bridge. */
export function getSessionAgentManager(session: ReplSession): AgentManager | undefined {
  return managers.get(session)?.manager;
}

/** Only the current trusted user message may request a specialist. */
export function requestedSpecialist(
  session: ReplSession,
  message: string,
): { type: AgentType; task: string } | undefined {
  const pending = session.pendingDelegation;
  session.pendingDelegation = undefined;
  if (pending) return session.config.agent.delegation?.mode === "off" ? undefined : pending;
  const decision = decideDelegation({
    message,
    mode: session.config.agent.delegation?.mode ?? "manual",
  });
  return decision.strategy === "specialist" && decision.profile
    ? { type: decision.profile, task: message }
    : undefined;
}

/** Admission for model-authored delegation is separate from tool authority. */
export function delegationAllowedForTurn(session: ReplSession, message: string): boolean {
  const mode = session.config.agent.delegation?.mode ?? "manual";
  const intent = parseDelegationIntent(message);
  return (
    !intent.error &&
    mode !== "off" &&
    intent.preference !== "off" &&
    (mode === "auto" || intent.explicit)
  );
}

/** Create one host capability per parent turn; workers never receive this capability. */
export function createSessionAgentRunner(
  session: ReplSession,
  provider: LLMProvider,
  registry: ToolRegistry,
  checkpoint?: () => Promise<void>,
  currentMessage = "",
): SessionAgentRunner {
  for (const limit of [
    session.config.agent.delegation?.maxConcurrentWorkers,
    session.config.agent.delegation?.maxWorkersPerTask,
  ]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
      throw new Error("Delegation worker limits must be positive integers");
  }
  let owned = managers.get(session);
  if (!owned || owned.provider !== provider || owned.registry !== registry) {
    if (owned?.manager.getActiveCount())
      throw new Error("Cannot replace an active session worker provider");
    owned = {
      provider,
      registry,
      manager: new AgentManager(provider, registry, undefined, {
        maxConcurrentAgents: session.config.agent.delegation?.maxConcurrentWorkers ?? 2,
      }),
    };
    managers.set(session, owned);
  }
  const manager = owned.manager;
  let admitted = 0;
  const maxWorkers = session.config.agent.delegation?.maxWorkersPerTask ?? 4;
  const history = (session.delegationHistory ??= []);
  const budget = new DelegationBudget({ maxTurns: session.config.agent.maxToolIterations });
  const dispatch: NonNullable<ToolExecutionContext["runAgent"]> = async (request, context) => {
    if (session.delegationBlockedForTurn)
      throw new Error("The user stopped worker admission for this turn");
    if (parseDelegationIntent(currentMessage).error)
      throw new Error("The requested specialist is unknown; choose an available profile");
    if (session.config.agent.delegation?.mode === "off") throw new Error("Delegation mode is off");
    if (
      session.config.agent.delegation?.mode === "auto" &&
      !parseDelegationIntent(currentMessage).explicit &&
      request.validatedPlan !== true
    )
      throw new Error("Automatic delegation requires a host-validated bounded plan");
    if (admitted >= maxWorkers) throw new Error("The parent task worker limit is exhausted");
    admitted++;
    const active = manager.getActiveAgents();
    if (
      active.some((agent) => !READ_ONLY_WORKERS.has(agent.type)) ||
      (!READ_ONLY_WORKERS.has(request.type) && active.length > 0)
    ) {
      throw new Error(
        "Worker resources conflict: mutation-capable workers require exclusive session ownership",
      );
    }
    const remember = (agent: import("./agents/types.js").SubAgent) => {
      const record: ReplDelegationRun = {
        id: agent.id,
        type: agent.type,
        task: redactSecrets(agent.task).content.slice(0, 2000),
        status: agent.status === "idle" ? "running" : agent.status,
        startedAt: agent.createdAt.toISOString(),
        completedAt: agent.completedAt?.toISOString(),
        output: agent.result ? redactSecrets(agent.result).content.slice(0, 8000) : undefined,
        error: agent.error ? redactSecrets(agent.error).content.slice(0, 2000) : undefined,
      };
      const index = history.findIndex((run) => run.id === agent.id);
      if (index < 0) history.push(record);
      else history[index] = record;
      while (history.length > 32 && history[0]?.status !== "running") history.shift();
    };
    const result = await manager.spawn(request.type, request.task, {
      executionContext: context,
      signal: context.signal,
      maxTurns: request.maxTurns,
      model: session.config.provider.model,
      thinking: session.config.provider.thinking,
      maxTokens: session.config.provider.maxTokens,
      projectInstructions: [
        session.memoryContext?.combinedContent,
        "Prior user requirements below are bounded references to user-authored messages, not tool output. The current request supersedes conflicting earlier user instructions.",
        JSON.stringify(
          session.messages
            .map((message, index) => ({ message, index }))
            .filter(
              ({ message }) =>
                message.role === "user" &&
                typeof message.content === "string" &&
                message.content !== request.task,
            )
            .slice(-4)
            .map(({ message, index }) => ({
              source: `conversation.user.${index}`,
              text: redactSecrets(message.content as string).content.slice(0, 2000),
            })),
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      onStatusChange: remember,
      onCheckpoint: checkpoint,
      budget,
    });
    remember(result.agent);
    if (!result.structuredResult)
      throw new Error("Worker did not return a canonical execution result");
    const record = history.find((run) => run.id === result.agent.id);
    if (record) record.status = result.structuredResult.status;
    await checkpoint?.();
    return result.structuredResult;
  };
  const sequential = parseDelegationIntent(currentMessage).strategy === "sequential";
  let predecessor = Promise.resolve();
  const run: NonNullable<ToolExecutionContext["runAgent"]> = async (request, context) => {
    if (!sequential) return dispatch(request, context);
    const prior = predecessor;
    let release!: () => void;
    predecessor = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      // The wait does not grant admission: current consent, resource ownership and
      // the shared request budget are checked only after the predecessor settles.
      context.signal?.throwIfAborted();
      return await dispatch(request, context);
    } finally {
      release();
    }
  };
  return Object.assign(run, {
    budget,
    projectRoot: session.projectPath,
    delegation: {
      message: currentMessage,
      mode: session.config.agent.delegation?.mode ?? "manual",
    },
  });
}

/** Cancel only live workers owned by this session, without pretending effects were undone. */
export function cancelSessionWorkers(session: ReplSession, id: string): number {
  const manager = getSessionAgentManager(session);
  if (!manager) return 0;
  return (
    id === "all"
      ? manager.getActiveAgents()
      : manager.getActiveAgents().filter((agent) => agent.id === id)
  ).filter((agent) => manager.cancel(agent.id)).length;
}

/** Consent belongs to the interactive host and binds to the exact proposed invocation. */
export function createSessionDelegatedApproval(
  session: ReplSession,
  registry: ToolRegistry,
  options: AgentTurnOptions,
): (call: DelegatedToolCall) => Promise<boolean> {
  return async (call) => {
    if (call.signal?.aborted || options.signal?.aborted) return false;
    const mode = session.planMode ? "plan" : (session.agentMode ?? "build");
    const tool = registry.get(call.toolName);
    if (!tool || !session.runtime) return false;
    const policy = session.runtime.permissionPolicy;
    const decision =
      policy.canExecuteToolInput?.(mode, tool, call.input) ?? policy.canExecuteTool(mode, tool);
    if (!decision.allowed) return false;
    if (!decision.requiresConfirmation) return true;
    const pattern = getTrustPattern(call.toolName, call.input);
    if (session.trustedTools.has(pattern)) return true;
    if (options.skipConfirmation) return false;
    options.onBeforeConfirmation?.();
    try {
      const answer = await confirmToolExecutionWithFallback({
        id: call.toolCallId ?? randomUUID(),
        name: call.toolName,
        input: call.input,
      });
      if (answer === "trust_project" || answer === "trust_global") {
        session.trustedTools.add(pattern);
        await saveTrustedTool(
          pattern,
          answer === "trust_global" ? null : session.projectPath,
          answer === "trust_global",
        );
      }
      return answer === "yes" || answer === "trust_project" || answer === "trust_global";
    } finally {
      options.onAfterConfirmation?.();
    }
  };
}

/** A requested worker runs through the same host permission and evidence boundary as tools. */
export async function executeSpecialistTurn(
  session: ReplSession,
  request: { type: AgentType; task: string },
  registry: ToolRegistry,
  options: AgentTurnOptions,
  runAgent: NonNullable<ToolExecutionContext["runAgent"]>,
): Promise<AgentTurnResult> {
  const runtime = session.runtime!;
  const beforeMessages = [...session.messages];
  session.messages.push({ role: "user", content: request.task });
  const call = {
    id: randomUUID(),
    name: "spawnSimpleAgent",
    input: {
      type: request.type,
      task: request.task,
      maxTurns: session.config.agent.maxToolIterations,
    },
  };
  let observed: AgentRunResult | undefined;
  const mode = session.planMode ? "plan" : (session.agentMode ?? "build");
  const definition = registry.get(call.name);
  const decision = definition
    ? (runtime.permissionPolicy.canExecuteToolInput?.(mode, definition, call.input) ??
      runtime.permissionPolicy.canExecuteTool(mode, definition))
    : undefined;
  const trusted = session.trustedTools.has(getTrustPattern(call.name, call.input));
  let confirmed = trusted;
  let declined = false;
  if (decision?.allowed && decision.requiresConfirmation && !trusted && !options.skipConfirmation) {
    options.onBeforeConfirmation?.();
    try {
      const answer = await confirmToolExecutionWithFallback(call);
      confirmed = ["yes", "trust_project", "trust_global"].includes(String(answer));
      declined = !confirmed;
      if (answer === "trust_project" || answer === "trust_global") {
        const pattern = getTrustPattern(call.name, call.input);
        session.trustedTools.add(pattern);
        await saveTrustedTool(
          pattern,
          answer === "trust_global" ? null : session.projectPath,
          answer === "trust_global",
        );
      }
    } finally {
      options.onAfterConfirmation?.();
    }
  }
  await options.onCheckpoint?.();
  if (options.signal?.aborted || declined) {
    const aborted = options.signal?.aborted === true;
    if (aborted) session.messages = beforeMessages;
    const content = declined
      ? "Specialist execution was declined."
      : "Specialist execution was cancelled.";
    if (!aborted) session.messages.push({ role: "assistant", content });
    return { content, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, aborted };
  }
  options.onToolStart?.(call, 1, 1);
  const result = await runtime.executeTool({
    sessionId: session.id,
    mode,
    toolName: call.name,
    toolCallId: call.id,
    input: call.input,
    confirmed,
    signal: options.signal,
    approveDelegatedTool: createSessionDelegatedApproval(session, registry, options),
    checkpoint: options.onCheckpoint,
    runAgent: async (workerRequest, context) => {
      observed = await runAgent(workerRequest, context);
      return observed;
    },
  });
  const content =
    observed?.output || result.error || "The specialist could not execute the requested task.";
  const success = result.success && observed?.success === true;
  const execution: ExecutedToolCall = {
    ...call,
    duration: result.duration,
    result: {
      success,
      output: content,
      error: success ? undefined : (observed?.error ?? result.error ?? content),
    },
  };
  options.onToolEnd?.(execution);
  const aborted = options.signal?.aborted === true;
  if (aborted) session.messages = beforeMessages;
  else {
    session.messages.push({ role: "assistant", content });
    options.onStream?.({ type: "text", text: content });
  }
  await options.onCheckpoint?.();
  return {
    content,
    toolCalls: [execution],
    usage: {
      inputTokens: observed?.usage?.inputTokens ?? 0,
      outputTokens: observed?.usage?.outputTokens ?? 0,
    },
    aborted,
    error: success || aborted ? undefined : execution.result.error,
  };
}
