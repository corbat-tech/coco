import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Message, ToolResultContent } from "../providers/types.js";
import type {
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeTurnState,
  RuntimeTurnTranscript,
  RuntimeTurnToolCall,
  RuntimeMode,
} from "./types.js";

const StateSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  input: z.string(),
  startedAt: z.string(),
  error: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().nonnegative().finite(),
      outputTokens: z.number().nonnegative().finite(),
    })
    .optional(),
  calls: z.array(
    z.object({
      id: z.string().min(1),
      callId: z.string().min(1),
      name: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
      status: z.enum(["planned", "running", "completed"]),
      assistantMessageIndex: z.number().int().nonnegative(),
    }),
  ),
});

/** Fail closed on malformed recovery state instead of silently losing effect history. */
export function getRuntimeTurn(session: RuntimeSession): RuntimeTurnState | undefined {
  const state = session.metadata.runtimeTurn;
  if (state === undefined) return undefined;
  const parsed = StateSchema.safeParse(state);
  if (!parsed.success) throw new Error(`Corrupt runtime turn state in session ${session.id}`);
  return parsed.data;
}

/** Load the latest snapshot for every patch; unrelated ledger metadata is never replaced. */
export function patchRuntimeSession(
  store: RuntimeSessionStore,
  sessionId: string,
  patch: (session: RuntimeSession) => RuntimeSession,
): RuntimeSession {
  const latest = store.get(sessionId);
  if (!latest) throw new Error(`Runtime session not found: ${sessionId}`);
  return store.update(patch(latest));
}

/** A snapshot journal, not an exactly-once transaction over external tools. */
export class SessionTurnTranscript implements RuntimeTurnTranscript {
  constructor(
    private readonly store: RuntimeSessionStore,
    readonly sessionId: string,
    readonly turnId: string,
  ) {}

  static begin(
    store: RuntimeSessionStore,
    session: RuntimeSession,
    input: string,
  ): SessionTurnTranscript {
    const id = randomUUID();
    patchRuntimeSession(store, session.id, (latest) => ({
      ...latest,
      mode: session.mode,
      messages: [...latest.messages, { role: "user", content: input }],
      metadata: {
        ...latest.metadata,
        runtimeTurn: {
          version: 1,
          id,
          status: "running",
          input,
          startedAt: new Date().toISOString(),
          calls: [],
        } satisfies RuntimeTurnState,
      },
    }));
    return new SessionTurnTranscript(store, session.id, id);
  }

  messages(): Message[] {
    const session = this.store.get(this.sessionId);
    if (!session) throw new Error(`Runtime session not found: ${this.sessionId}`);
    return session.messages;
  }

  recordUsage(
    inputTokens: number,
    outputTokens: number,
  ): { inputTokens: number; outputTokens: number } {
    if (![inputTokens, outputTokens].every((value) => Number.isFinite(value) && value >= 0))
      throw new Error("Invalid provider token usage");
    let usage = { inputTokens: 0, outputTokens: 0 };
    this.update((_session, state) => {
      usage = {
        inputTokens: (state.usage?.inputTokens ?? 0) + inputTokens,
        outputTokens: (state.usage?.outputTokens ?? 0) + outputTokens,
      };
      state.usage = usage;
    });
    return usage;
  }

  private update(change: (session: RuntimeSession, state: RuntimeTurnState) => void): void {
    patchRuntimeSession(this.store, this.sessionId, (session) => {
      const state = getRuntimeTurn(session);
      if (!state || state.id !== this.turnId) throw new Error("Runtime turn ownership changed");
      change(session, state);
      session.metadata = { ...session.metadata, runtimeTurn: state };
      return session;
    });
  }

  appendToolBatch(message: Message): void {
    this.update((session, state) => {
      if (state.calls.some((call) => call.status !== "completed"))
        throw new Error("Previous tool batch is incomplete");
      if (message.role !== "assistant" || !Array.isArray(message.content))
        throw new Error("Invalid tool batch");
      const calls = message.content.filter((block) => block.type === "tool_use");
      const ids = calls.map((call) => call.id);
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
        throw new Error("Tool call IDs must be nonempty and unique within a batch");
      for (const call of calls) {
        state.calls.push({
          id: randomUUID(),
          callId: call.id,
          name: call.name,
          input: structuredClone(call.input),
          status: "planned",
          assistantMessageIndex: session.messages.length,
        });
      }
      session.messages.push(structuredClone(message));
    });
  }

  startTool(callId: string): void {
    this.update((_session, state) => {
      const call = state.calls.find(
        (entry) => entry.callId === callId && entry.status === "planned",
      );
      if (!call) throw new Error(`No planned tool call: ${callId}`);
      call.status = "running";
    });
  }

  finishTool(callId: string, content: string, isError: boolean): void {
    this.update((session, state) => {
      const call = state.calls.find(
        (entry) => entry.callId === callId && entry.status !== "completed",
      );
      if (!call) throw new Error(`No pending tool call: ${callId}`);
      appendCallResult(session, call, content, isError);
      call.status = "completed";
    });
  }

  terminal(status: RuntimeTurnState["status"], error?: string, content?: string): void {
    this.update((session, state) => {
      if (status === "completed" && state.calls.some((call) => call.status !== "completed"))
        throw new Error("Cannot complete a turn with pending tool calls");
      if (content !== undefined) session.messages.push({ role: "assistant", content });
      state.status = status;
      state.error = error;
    });
  }

  /** Explicit host continuation closes unstarted calls; it never executes them. */
  resume(mode?: RuntimeMode): void {
    this.update((session, state) => {
      if (state.status === "completed") throw new Error("Runtime turn is already completed");
      if (state.calls.some((call) => call.status === "running"))
        throw new Error("Uncertain tool effects require host resolution before resuming");
      for (const call of state.calls.filter((entry) => entry.status === "planned")) {
        appendCallResult(
          session,
          call,
          "Tool was not executed before the turn was interrupted.",
          true,
        );
        call.status = "completed";
      }
      state.status = "running";
      state.error = undefined;
      session.mode = mode ?? session.mode;
    });
  }
}

function appendCallResult(
  session: RuntimeSession,
  call: RuntimeTurnToolCall,
  content: string,
  isError: boolean,
): void {
  const assistant = session.messages[call.assistantMessageIndex];
  if (
    assistant?.role !== "assistant" ||
    !Array.isArray(assistant.content) ||
    !assistant.content.some((block) => block.type === "tool_use" && block.id === call.callId)
  )
    throw new Error("Corrupt pending tool transcript");
  const result: ToolResultContent = {
    type: "tool_result",
    tool_use_id: call.callId,
    content,
    is_error: isError,
  };
  const existing = session.messages[call.assistantMessageIndex + 1];
  if (!existing) session.messages.push({ role: "user", content: [result] });
  else {
    if (
      existing.role !== "user" ||
      !Array.isArray(existing.content) ||
      existing.content.some((block) => block.type !== "tool_result")
    )
      throw new Error("Corrupt pending tool results");
    if (
      existing.content.some(
        (block) => block.type === "tool_result" && block.tool_use_id === call.callId,
      )
    )
      throw new Error("Tool call already has a persisted result");
    existing.content.push(result);
  }
}
