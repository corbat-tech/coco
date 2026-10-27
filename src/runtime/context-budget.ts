import type { Message } from "../providers/types.js";
import { rethrowCancellation } from "../utils/cancellation.js";

/** Provider-neutral estimate of the request, including offered tool schemas and output reserve. */
export interface ContextBudgetInput {
  messages: Message[];
  system?: string;
  tools?: readonly unknown[];
  countTokens: (text: string) => number;
  contextWindow: number;
  reservedOutputTokens: number;
}

export interface ContextBudget {
  conversationTokens: number;
  systemTokens: number;
  toolTokens: number;
  inputTokens: number;
  reservedOutputTokens: number;
  totalTokens: number;
  fixedTokens: number;
  fits: boolean;
  fixedFits: boolean;
}

/** Estimates only the tools supplied by the caller, never a global registry. */
export function measureContextBudget(input: ContextBudgetInput): ContextBudget {
  if (
    !Number.isFinite(input.contextWindow) ||
    input.contextWindow <= 0 ||
    !Number.isFinite(input.reservedOutputTokens) ||
    input.reservedOutputTokens < 0
  ) {
    throw new RangeError("Context window and output reserve must be finite valid token budgets.");
  }
  const count = (text: string): number => {
    const tokens = input.countTokens(text);
    if (!Number.isFinite(tokens) || tokens < 0)
      throw new RangeError("Invalid provider token estimate.");
    return Math.ceil(tokens);
  };
  let conversationTokens = 0;
  let systemTokens = input.system ? count(input.system) : 0;
  for (const message of input.messages) {
    const tokens = count(
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    );
    if (message.role === "system") systemTokens += tokens;
    else conversationTokens += tokens;
  }
  const toolTokens = input.tools?.length ? count(JSON.stringify(input.tools)) : 0;
  const inputTokens = conversationTokens + systemTokens + toolTokens;
  const fixedTokens = systemTokens + toolTokens + input.reservedOutputTokens;
  const totalTokens = inputTokens + input.reservedOutputTokens;
  return {
    conversationTokens,
    systemTokens,
    toolTokens,
    inputTokens,
    reservedOutputTokens: input.reservedOutputTokens,
    totalTokens,
    fixedTokens,
    fits: totalTokens <= input.contextWindow,
    fixedFits: fixedTokens <= input.contextWindow,
  };
}

export type ContextBudgetFailure =
  | "fixed_context_exceeds_window"
  | "compaction_failed"
  | "compaction_not_reduced"
  | "compacted_context_exceeds_window";

export class ContextBudgetError extends Error {
  constructor(
    readonly code: ContextBudgetFailure,
    message: string,
  ) {
    super(message);
    this.name = "ContextBudgetError";
  }
}

export interface CompactContextToFitInput extends ContextBudgetInput {
  signal?: AbortSignal;
  summarize: (
    messages: Message[],
    signal?: AbortSignal,
  ) => Promise<{ messages: Message[]; wasCompacted: boolean }>;
}

/** One bounded recovery attempt. Caller installs the returned history only on success. */
export async function compactContextToFit(
  input: CompactContextToFitInput,
): Promise<{ messages: Message[]; budget: ContextBudget }> {
  input.signal?.throwIfAborted();
  const before = measureContextBudget(input);
  if (!before.fixedFits)
    throw new ContextBudgetError(
      "fixed_context_exceeds_window",
      "System instructions, offered tool schemas and output reserve exceed the context window. Reduce tools/instructions or output budget, or choose a larger model.",
    );
  let compacted: { messages: Message[]; wasCompacted: boolean };
  try {
    // Keep message identities: host summaries carry provenance in the compactor.
    // Summarizers must treat message objects as immutable.
    compacted = await input.summarize([...input.messages], input.signal);
  } catch (error) {
    rethrowCancellation(error, input.signal);
    throw new ContextBudgetError(
      "compaction_failed",
      "Context recovery could not summarize history. Original history retained; reduce context or choose a larger model.",
    );
  }
  input.signal?.throwIfAborted();
  if (
    JSON.stringify(input.messages.filter((m) => m.role === "system")) !==
    JSON.stringify(compacted.messages.filter((m) => m.role === "system"))
  ) {
    throw new ContextBudgetError(
      "compaction_failed",
      "Context recovery changed fixed system instructions. Original history retained.",
    );
  }
  const budget = measureContextBudget({ ...input, messages: compacted.messages });
  if (!compacted.wasCompacted || budget.inputTokens >= before.inputTokens)
    throw new ContextBudgetError(
      "compaction_not_reduced",
      "Context recovery did not reduce history. Original history retained; reduce context or choose a larger model.",
    );
  if (!budget.fits)
    throw new ContextBudgetError(
      "compacted_context_exceeds_window",
      "Compacted history still exceeds the context window including tool schemas and output reserve. Reduce context or choose a larger model.",
    );
  return { messages: compacted.messages, budget };
}
