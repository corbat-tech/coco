import { isDeepStrictEqual } from "node:util";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { RuntimeMode } from "../../runtime/types.js";
import type { ToolCall } from "../../providers/types.js";
import type { ToolResult } from "../../tools/registry.js";
import { requiresConfirmation } from "./confirmation.js";

/** Bind consent to the exact approved call, before hooks can change its input. */
export function createRuntimeToolDispatch(
  runtime: AgentRuntime,
  sessionId: string,
  mode: RuntimeMode,
  approvedCalls: ToolCall[],
): (call: ToolCall, signal?: AbortSignal) => Promise<ToolResult> {
  const approvals = structuredClone(approvedCalls);
  return async (call, signal) => {
    const confirmed = approvals.some(
      (approved) =>
        approved.id === call.id &&
        approved.name === call.name &&
        isDeepStrictEqual(approved.input, call.input),
    );
    // REPL confirmations include sensitive operations beyond the runtime's
    // destructive category. Suppressing prompts never grants this authority.
    if (!confirmed && requiresConfirmation(call.name, call.input)) {
      const error =
        "Tool requires approval for these exact arguments; no matching approval is available.";
      runtime.eventLog.record("tool.blocked", {
        sessionId,
        toolCallId: call.id,
        tool: call.name,
        mode,
        reason: error,
      });
      return { success: false, error, duration: 0 };
    }
    const result = await runtime.executeTool({
      sessionId,
      mode,
      toolName: call.name,
      toolCallId: call.id,
      input: call.input,
      confirmed,
      signal,
    });
    return {
      success: result.success,
      data: result.output,
      error: result.error,
      duration: result.duration,
    };
  };
}
