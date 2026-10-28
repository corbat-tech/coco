import { normalizeAgentRunResult, type AgentRunResult } from "../runtime/multi-agent.js";

/** A worker's text or success boolean cannot override cancellation or simulated execution. */
export function adaptDelegatedResult(input: AgentRunResult) {
  const valid = input.success && input.status === "completed" && input.metadata?.simulated !== true;
  const result = valid
    ? input
    : normalizeAgentRunResult({
        ...input,
        success: false,
        status: input.status === "completed" ? "failed" : input.status,
        error: input.error ?? "Worker did not complete a real terminal execution.",
      });
  return { ...result, agent: { id: result.id }, structuredResult: result };
}
