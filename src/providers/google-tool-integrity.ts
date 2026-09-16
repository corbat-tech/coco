import { isDeepStrictEqual } from "node:util";
import { ResponseIntegrityError } from "./response-integrity.js";
import { validateToolCallInput } from "./tool-call-normalizer.js";
import type { ToolCall } from "./types.js";

/** Google sends complete native functionCall objects unless partial streaming is requested. */
export class GoogleToolBatch {
  private calls: Array<{ call: Record<string, unknown>; signature?: string }> = [];
  private finishReason?: string;

  constructor(private readonly provider: "gemini" | "vertex") {}

  add(parts: unknown, finishReason?: string): void {
    if (!Array.isArray(parts)) this.fail();
    for (const part of parts as unknown[]) {
      if (!part || typeof part !== "object") this.fail();
      const value = part as Record<string, unknown>;
      if (this.finishReason && (value.functionCall !== undefined || value.text)) this.fail();
      if (value.functionCall === undefined) continue;
      if (
        !value.functionCall ||
        typeof value.functionCall !== "object" ||
        Array.isArray(value.functionCall)
      )
        this.fail();
      const call = value.functionCall as Record<string, unknown>;
      // Partial-argument streaming is not enabled by these adapters. Never interpret a fragment as a call.
      if (call.willContinue === true || call.partialArgs !== undefined) this.fail();
      const signature =
        value.thoughtSignature ??
        value.thought_signature ??
        call.thoughtSignature ??
        call.thought_signature;
      if (signature !== undefined && typeof signature !== "string") this.fail();
      this.calls.push({ call, signature: signature as string | undefined });
    }
    if (finishReason !== undefined) {
      if (this.finishReason && this.finishReason !== finishReason) this.fail();
      this.finishReason = finishReason;
    }
  }

  complete(): { toolCalls: ToolCall[]; stopReason: "tool_use" | "end_turn" | "max_tokens" } {
    if (
      this.finishReason !== "STOP" &&
      !(this.finishReason === "MAX_TOKENS" && this.calls.length === 0)
    )
      this.fail();
    const toolCalls: ToolCall[] = [];
    const byId = new Map<string, ToolCall>();
    // Reserve native IDs before assigning synthetic ones, including IDs occurring later in the batch.
    const reserved = new Set(this.calls.map(({ call }) => call.id));
    let counter = 0;
    for (const { call, signature } of this.calls) {
      if (typeof call.name !== "string" || !call.name.trim()) this.fail();
      if (call.id !== undefined && (typeof call.id !== "string" || !call.id.trim())) this.fail();
      let id = call.id as string | undefined;
      if (id === undefined) {
        do {
          id = `${this.provider}_call_${++counter}`;
        } while (reserved.has(id));
        reserved.add(id);
      }
      const normalized: ToolCall = {
        id,
        name: call.name as string,
        // Google FunctionCall.args is optional in the native protocol (zero arguments).
        // Only an absent field is empty; null/scalar/array values remain invalid.
        input: validateToolCallInput(call.args === undefined ? {} : call.args, this.provider),
        geminiThoughtSignature: signature,
      };
      const existing = byId.get(id);
      if (existing) {
        if (!isDeepStrictEqual(existing, normalized)) this.fail();
        continue;
      }
      byId.set(id, normalized);
      toolCalls.push(normalized);
    }
    return {
      toolCalls,
      stopReason: toolCalls.length
        ? "tool_use"
        : this.finishReason === "MAX_TOKENS"
          ? "max_tokens"
          : "end_turn",
    };
  }

  private fail(): never {
    throw new ResponseIntegrityError("Invalid or incomplete Google tool response", this.provider);
  }
}
