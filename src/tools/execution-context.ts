import type { BackgroundJobOwner } from "./utils/background-jobs.js";
import type { RuntimeMode, RuntimeToolExecutionResult } from "../runtime/types.js";
import type { WorkLedgerHandle } from "../runtime/work-ledger.js";

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
  /** Host-scoped plan/evidence access; model arguments cannot choose another session. */
  readonly workLedger?: WorkLedgerHandle;
  readonly signal?: AbortSignal;
  readonly backgroundJobs?: BackgroundJobOwner;
  readonly executeDelegatedTool?: (call: DelegatedToolCall) => Promise<RuntimeToolExecutionResult>;
}
