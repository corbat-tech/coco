import { getRuntimeTurn, SessionTurnTranscript } from "./turn-transcript.js";
import type {
  RuntimeSessionRecovery,
  RuntimeSessionStore,
  RuntimeToolCallResolution,
} from "./types.js";

/** Read-only inspection; a started call without a result is always uncertain. */
export function inspectSessionRecovery(
  store: RuntimeSessionStore,
  sessionId: string,
): RuntimeSessionRecovery {
  const session = store.get(sessionId);
  if (!session) throw new Error(`Runtime session not found: ${sessionId}`);
  const turn = getRuntimeTurn(session);
  const uncertainCalls = turn?.calls.filter((call) => call.status === "running") ?? [];
  return {
    sessionId,
    turn,
    uncertainCalls,
    canResume: !!turn && turn.status !== "completed" && uncertainCalls.length === 0,
  };
}

/** The host supplies observed evidence; this records a result, never replays a tool. */
export function resolveSessionToolCall(
  store: RuntimeSessionStore,
  sessionId: string,
  resolution: RuntimeToolCallResolution,
): void {
  if (!resolution.reason.trim()) throw new Error("Host resolution requires an evidence reason");
  const inspection = inspectSessionRecovery(store, sessionId);
  if (inspection.turn?.id !== resolution.turnId) throw new Error("Stale runtime turn resolution");
  const call = inspection.uncertainCalls.find((entry) => entry.id === resolution.callId);
  if (!call) throw new Error("Resolution must identify an uncertain host call ID");
  new SessionTurnTranscript(store, sessionId, resolution.turnId).finishTool(
    call.callId,
    `${resolution.content}\n[Host resolution: ${resolution.reason}]`,
    resolution.isError,
  );
}

/** Prevent a new input from silently superseding an interrupted or uncertain batch. */
export function assertSessionReady(store: RuntimeSessionStore, sessionId: string): void {
  const inspection = inspectSessionRecovery(store, sessionId);
  if (
    inspection.turn?.status === "running" ||
    inspection.turn?.calls.some((call) => call.status !== "completed")
  )
    throw new Error(
      "Runtime session requires recovery; inspect effects and explicitly resume the interrupted turn",
    );
}
