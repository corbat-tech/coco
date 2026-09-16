import { isDeepStrictEqual } from "node:util";
import { ResponseIntegrityError } from "./response-integrity.js";
import type { ToolCall } from "./types.js";

export interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}

function getSingleBuilderKey(builders: Map<string, unknown>): string | null {
  return builders.size === 1 ? (Array.from(builders.keys())[0] ?? null) : null;
}

/** Tool inputs must be complete objects; never synthesize executable arguments. */
export function validateToolCallInput(
  input: unknown,
  providerName: string,
): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResponseIntegrityError(
      "Invalid tool arguments: expected a JSON object",
      providerName,
    );
  }
  return input as Record<string, unknown>;
}

export function parseToolCallArguments(
  args: string,
  providerName: string,
): Record<string, unknown> {
  let input: unknown;
  try {
    input = JSON.parse(args);
  } catch {
    // Parser errors may contain argument values: do not expose their message/cause.
    throw new ResponseIntegrityError(
      "Invalid tool arguments: expected complete JSON",
      providerName,
    );
  }
  return validateToolCallInput(input, providerName);
}

export interface ChatToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export class ChatToolCallAssembler {
  private builders: Map<string, ToolCallBuilder> = new Map();

  consume(delta: ChatToolCallDelta): {
    started?: { id?: string; name?: string };
    argumentDelta?: { id: string; name: string; text: string };
  } {
    const indexedKey = typeof delta.index === "number" ? `index:${delta.index}` : undefined;
    const idMatches = delta.id
      ? [...this.builders.entries()].filter(([, builder]) => builder.id === delta.id)
      : [];
    if (!indexedKey && idMatches.length > 1) {
      throw new ResponseIntegrityError("Conflicting tool call references", "Chat Completions");
    }
    const key =
      indexedKey ??
      idMatches[0]?.[0] ??
      (delta.id ? `id:${delta.id}` : getSingleBuilderKey(this.builders));
    if (!key) {
      throw new ResponseIntegrityError(
        "Missing or ambiguous tool call reference",
        "Chat Completions",
      );
    }
    if (!this.builders.has(key) && !delta.id && !delta.function?.name) {
      throw new ResponseIntegrityError("Unknown tool call reference", "Chat Completions");
    }

    let started: { id?: string; name?: string } | undefined;
    if (!this.builders.has(key)) {
      const initialId = delta.id ?? "";
      const initialName = delta.function?.name ?? "";
      this.builders.set(key, { id: initialId, name: initialName, arguments: "" });
      started = {
        id: initialId || undefined,
        name: initialName || undefined,
      };
    }

    const builder = this.builders.get(key)!;

    if (
      (delta.id && builder.id && delta.id !== builder.id) ||
      (delta.function?.name && builder.name && delta.function.name !== builder.name)
    ) {
      throw new ResponseIntegrityError(
        "Tool call identity changed during streaming",
        "Chat Completions",
      );
    }
    if (delta.id) builder.id = delta.id;
    if (delta.function?.name) builder.name = delta.function.name;

    const text = delta.function?.arguments ?? "";
    if (!text) return { started };
    builder.arguments += text;

    return {
      started,
      argumentDelta: {
        id: builder.id,
        name: builder.name,
        text,
      },
    };
  }

  finalizeAll(providerName: string): ToolCall[] {
    const result: ToolCall[] = [];
    for (const builder of this.builders.values()) {
      result.push({
        id: builder.id,
        name: builder.name,
        input: parseToolCallArguments(builder.arguments, providerName),
      });
    }
    this.builders.clear();
    return result;
  }
}

type ResponsesAddedItem = {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

export class ResponsesToolCallAssembler {
  private builders: Map<string, { callId: string; name: string; arguments: string }> = new Map();
  private outputIndexToBuilderKey: Map<number, string> = new Map();
  private identities = new Map<
    string,
    { callId: string; name: string; initialArguments: string }
  >();

  onOutputItemAdded(event: {
    output_index?: number;
    item?: ResponsesAddedItem;
  }): { id: string; name: string } | null {
    const item = event.item;
    if (!item || item.type !== "function_call") return null;

    const callId = item.call_id ?? "";
    const itemKey = item.id ?? callId;
    const knownKey =
      typeof event.output_index === "number"
        ? this.outputIndexToBuilderKey.get(event.output_index)
        : undefined;
    const known =
      this.identities.get(itemKey) ?? (knownKey ? this.identities.get(knownKey) : undefined);
    if (
      known &&
      (known.callId !== callId ||
        known.name !== (item.name ?? "") ||
        known.initialArguments !== (item.arguments ?? ""))
    ) {
      throw new ResponseIntegrityError(
        "Tool call identity or initial arguments changed",
        "Responses",
      );
    }
    if (known) return { id: callId, name: known.name };
    this.identities.set(itemKey, {
      callId,
      name: item.name ?? "",
      initialArguments: item.arguments ?? "",
    });
    this.builders.set(itemKey, {
      callId,
      name: item.name ?? "",
      arguments: item.arguments ?? "",
    });

    if (typeof event.output_index === "number") {
      this.outputIndexToBuilderKey.set(event.output_index, itemKey);
    }

    return {
      id: callId,
      name: item.name ?? "",
    };
  }

  onArgumentsDelta(event: {
    item_id?: string;
    output_index?: number;
    delta?: string;
  }): { id: string; name: string; text: string } | undefined {
    const builderKey = this.resolveBuilderKey(event.item_id, event.output_index);
    if (!builderKey) return;
    const builder = this.builders.get(builderKey);
    if (!builder) return;
    const text = event.delta ?? "";
    builder.arguments += text;
    return { id: builder.callId, name: builder.name, text };
  }

  onArgumentsDone(
    event: {
      item_id?: string;
      output_index?: number;
      arguments?: string;
    },
    providerName: string,
  ): ToolCall | null {
    const builderKey = this.resolveBuilderKey(event.item_id, event.output_index);
    if (!builderKey) return null;
    const builder = this.builders.get(builderKey);
    if (!builder) return null;

    const toolCall: ToolCall = {
      id: builder.callId,
      name: builder.name,
      input: parseToolCallArguments(event.arguments ?? builder.arguments, providerName),
    };

    if (event.arguments !== undefined) {
      let provisional: unknown;
      let complete = false;
      try {
        provisional = JSON.parse(builder.arguments);
        complete = true;
      } catch {
        /* A final arguments event may complete a provisional JSON fragment. */
      }
      if (
        complete &&
        !isDeepStrictEqual(toolCall.input, validateToolCallInput(provisional, providerName))
      ) {
        throw new ResponseIntegrityError(
          "Completed arguments contradict the accumulated tool call",
          providerName,
        );
      }
    }
    this.deleteBuilder(builderKey);
    return toolCall;
  }

  finalizeAll(providerName: string): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const builder of this.builders.values()) {
      calls.push({
        id: builder.callId,
        name: builder.name,
        input: parseToolCallArguments(builder.arguments, providerName),
      });
    }
    this.builders.clear();
    this.outputIndexToBuilderKey.clear();
    this.identities.clear();
    return calls;
  }

  /** Merge authoritative completed output before parsing potentially incomplete deltas. */
  finalizeCompleted(
    providerName: string,
    output: ResponsesAddedItem[],
    completedCalls: ToolCall[],
  ): ToolCall[] {
    const calls = new Map<string, ToolCall>();
    const authoritativeIds = new Set(
      output
        .filter((item) => item.type === "function_call" && item.arguments !== undefined)
        .map((item) => item.call_id),
    );
    const conflict = () =>
      new ResponseIntegrityError("Conflicting tool calls share an identity", providerName);
    const add = (call: ToolCall) => {
      const existing = calls.get(call.id);
      if (
        existing &&
        (existing.name !== call.name || !isDeepStrictEqual(existing.input, call.input))
      ) {
        throw conflict();
      }
      calls.set(call.id, call);
    };
    for (const call of completedCalls) add(call);
    for (const item of output) {
      if (item.type !== "function_call") continue;
      if (!item.call_id || !item.name) {
        throw new ResponseIntegrityError(
          "Completed tool call is missing its identity",
          providerName,
        );
      }
      const known = item.id ? this.identities.get(item.id) : undefined;
      if (known && (known.callId !== item.call_id || known.name !== item.name)) throw conflict();
      const builders = [...this.builders.values()].filter((entry) => entry.callId === item.call_id);
      if (builders.some((builder) => builder.name !== item.name)) throw conflict();
      const existing = calls.get(item.call_id);
      if (existing && existing.name !== item.name) throw conflict();
      if (item.arguments === undefined) {
        if (existing || builders.length > 0) continue;
      }
      add({
        id: item.call_id,
        name: item.name,
        input: parseToolCallArguments(item.arguments ?? "", providerName),
      });
    }
    for (const builder of this.builders.values()) {
      const existing = calls.get(builder.callId);
      if (existing) {
        if (existing.name !== builder.name) throw conflict();
        if (authoritativeIds.has(builder.callId)) {
          // Terminal output may complete a fragment, but cannot contradict a complete object.
          let provisional: unknown;
          try {
            provisional = JSON.parse(builder.arguments);
          } catch {
            continue;
          }
          if (!isDeepStrictEqual(existing.input, validateToolCallInput(provisional, providerName)))
            throw conflict();
          continue;
        }
        add({
          id: builder.callId,
          name: builder.name,
          input: parseToolCallArguments(builder.arguments, providerName),
        });
        continue;
      }
      add({
        id: builder.callId,
        name: builder.name,
        input: parseToolCallArguments(builder.arguments, providerName),
      });
    }
    this.builders.clear();
    this.outputIndexToBuilderKey.clear();
    this.identities.clear();
    return [...calls.values()];
  }

  private resolveBuilderKey(itemId?: string, outputIndex?: number): string | null {
    const hasItem = itemId !== undefined;
    const hasIndex = outputIndex !== undefined;
    const itemKey =
      hasItem && typeof itemId === "string" && this.builders.has(itemId) ? itemId : undefined;
    const indexKey =
      hasIndex && typeof outputIndex === "number"
        ? this.outputIndexToBuilderKey.get(outputIndex)
        : undefined;
    if (
      (hasItem && !itemKey) ||
      (hasIndex && (!indexKey || !this.builders.has(indexKey))) ||
      (itemKey && indexKey && itemKey !== indexKey)
    ) {
      throw new ResponseIntegrityError("Unknown or conflicting tool call references", "Responses");
    }
    const key = itemKey ?? indexKey ?? getSingleBuilderKey(this.builders);
    if (!key)
      throw new ResponseIntegrityError("Missing or ambiguous tool call reference", "Responses");
    return key;
  }

  private deleteBuilder(builderKey: string): void {
    this.builders.delete(builderKey);
  }
}
