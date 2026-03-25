import { jsonrepair } from "jsonrepair";
import type { ToolCall } from "./types.js";

export interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}

function getSingleBuilderKey(builders: Map<string, unknown>): string | null {
  return builders.size === 1 ? (Array.from(builders.keys())[0] ?? null) : null;
}

export function parseToolCallArguments(
  args: string,
  providerName: string,
): Record<string, unknown> {
  try {
    return args ? JSON.parse(args) : {};
  } catch {
    try {
      if (args) {
        const repaired = jsonrepair(args);
        return JSON.parse(repaired);
      }
    } catch {
      console.error(`[${providerName}] Cannot parse tool arguments: ${args.slice(0, 200)}`);
    }
    return {};
  }
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
  private lastBuilderKey: string | null = null;

  consume(delta: ChatToolCallDelta): {
    started?: { id?: string; name?: string };
    argumentDelta?: { id: string; name: string; text: string };
  } {
    const key =
      typeof delta.index === "number"
        ? `index:${delta.index}`
        : typeof delta.id === "string" && delta.id.length > 0
          ? `id:${delta.id}`
          : (getSingleBuilderKey(this.builders) ??
            this.lastBuilderKey ??
            `fallback:${this.builders.size}`);

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
    this.lastBuilderKey = key;

    if (delta.id) {
      builder.id = delta.id;
    }
    if (delta.function?.name) {
      builder.name = delta.function.name;
    }

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
    this.lastBuilderKey = null;
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

  onOutputItemAdded(event: {
    output_index?: number;
    item?: ResponsesAddedItem;
  }): { id: string; name: string } | null {
    const item = event.item;
    if (!item || item.type !== "function_call") return null;

    const callId = item.call_id ?? "";
    const itemKey = item.id ?? callId;
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

  onArgumentsDelta(event: { item_id?: string; output_index?: number; delta?: string }): void {
    const builderKey = this.resolveBuilderKey(event.item_id, event.output_index);
    if (!builderKey) return;
    const builder = this.builders.get(builderKey);
    if (!builder) return;
    builder.arguments += event.delta ?? "";
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
    return calls;
  }

  private resolveBuilderKey(itemId?: string, outputIndex?: number): string | null {
    if (itemId && this.builders.has(itemId)) {
      return itemId;
    }
    if (typeof outputIndex === "number") {
      return this.outputIndexToBuilderKey.get(outputIndex) ?? null;
    }
    return getSingleBuilderKey(this.builders);
  }

  private deleteBuilder(builderKey: string): void {
    this.builders.delete(builderKey);
    for (const [idx, key] of this.outputIndexToBuilderKey.entries()) {
      if (key === builderKey) {
        this.outputIndexToBuilderKey.delete(idx);
      }
    }
  }
}
