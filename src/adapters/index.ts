import type { AgentRuntime } from "../runtime/agent-runtime.js";
import type { RuntimeTurnStreamEvent } from "../runtime/types.js";

export interface ChannelInput {
  sessionId?: string;
  content: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutput {
  sessionId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  id: string;
  surface: "web" | "whatsapp" | "slack" | "api" | "internal";
  handle(input: ChannelInput): Promise<ChannelOutput>;
}

export interface HttpAssistantAdapter {
  createSession(metadata?: Record<string, unknown>): { sessionId: string };
  handleMessage(input: ChannelInput): Promise<ChannelOutput>;
}

export interface StreamingHttpAssistantAdapter extends HttpAssistantAdapter {
  streamMessage(input: ChannelInput): AsyncIterable<RuntimeTurnStreamEvent>;
}

export function createHttpAssistantAdapter(runtime: AgentRuntime): HttpAssistantAdapter {
  return {
    createSession(metadata = {}) {
      const session = runtime.createSession({ mode: "ask", metadata });
      return { sessionId: session.id };
    },
    async handleMessage(input) {
      const sessionId =
        input.sessionId ?? runtime.createSession({ mode: "ask", metadata: input.metadata }).id;
      const result = await runtime.runTurn({
        sessionId,
        content: input.content,
        metadata: input.metadata,
      });
      return { sessionId, content: result.content, metadata: { model: result.model } };
    },
  };
}

export function createStreamingHttpAssistantAdapter(
  runtime: AgentRuntime,
): StreamingHttpAssistantAdapter {
  const base = createHttpAssistantAdapter(runtime);
  return {
    ...base,
    async *streamMessage(input) {
      const sessionId =
        input.sessionId ?? runtime.createSession({ mode: "ask", metadata: input.metadata }).id;
      yield* runtime.streamTurn({
        sessionId,
        content: input.content,
        metadata: input.metadata,
      });
    },
  };
}

export function createWebhookAssistantAdapter(
  runtime: AgentRuntime,
  options: { id?: string; surface?: ChannelAdapter["surface"] } = {},
): ChannelAdapter {
  return {
    id: options.id ?? "webhook-assistant",
    surface: options.surface ?? "api",
    async handle(input) {
      const adapter = createHttpAssistantAdapter(runtime);
      return adapter.handleMessage(input);
    },
  };
}
