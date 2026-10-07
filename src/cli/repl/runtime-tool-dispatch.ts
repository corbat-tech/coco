import { isDeepStrictEqual } from "node:util";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { RuntimeMode } from "../../runtime/types.js";
import type { ToolCall } from "../../providers/types.js";
import type { ToolResult } from "../../tools/registry.js";

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
