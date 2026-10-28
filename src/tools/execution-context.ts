import type { BackgroundJobOwner } from "./utils/background-jobs.js";
import type { RuntimeMode, RuntimeToolExecutionResult } from "../runtime/types.js";
import type { WorkLedgerHandle } from "../runtime/work-ledger.js";
import type { AgentType } from "../runtime/agent-type.js";
import type { AgentRunResult } from "../runtime/multi-agent.js";

/** Host-bound worker dispatch. Never accepted from model-authored tool arguments. */
export type RunAgent = ((
  request: { type: AgentType; task: string; maxTurns: number; validatedPlan?: true },
  context: ToolExecutionContext,
) => Promise<AgentRunResult>) & {
  readonly projectRoot?: string;
  readonly delegation?: {
    message: string;
    mode: import("../runtime/delegation-policy.js").DelegationMode;
  };
};

/** A child can narrow its tools/mode; it cannot supply parental consent. */
export interface DelegatedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  mode: RuntimeMode;
  allowedTools: readonly string[];
  toolCallId?: string;
  signal?: AbortSignal;
}

/** Host-provided authority, separate from model-authored tool arguments. */
export interface ToolExecutionContext {
  readonly sessionId?: string;
  readonly runAgent?: RunAgent;
  /** Host-scoped plan/evidence access; model arguments cannot choose another session. */
  readonly workLedger?: WorkLedgerHandle;
  readonly signal?: AbortSignal;
  readonly backgroundJobs?: BackgroundJobOwner;
  readonly executeDelegatedTool?: (call: DelegatedToolCall) => Promise<RuntimeToolExecutionResult>;
}
