import { createHmac, timingSafeEqual } from "node:crypto";
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

export interface WhatsAppInboundMessage {
  from: string;
  text: string;
  messageId?: string;
  profileName?: string;
  metadata?: Record<string, unknown>;
}

export interface WhatsAppAssistantAdapter {
  surface: "whatsapp";
  handleInbound(input: WhatsAppInboundMessage): Promise<ChannelOutput>;
}

export interface ChannelSessionMapper {
  getSessionId(input: { tenantId: string; channel: string; senderId: string }): string | undefined;
  setSessionId(input: {
    tenantId: string;
    channel: string;
    senderId: string;
    sessionId: string;
  }): void;
}

export interface WhatsAppCloudWebhookInput {
  rawBody: string;
  signature: string | undefined;
  body?: unknown;
  tenantId: string;
}

export interface WhatsAppCloudMedia {
  id: string;
  type: "image" | "audio" | "video" | "document" | "sticker";
  mimeType?: string;
  caption?: string;
}

export interface WhatsAppCloudMessage {
  messageId: string;
  from: string;
  text: string;
  profileName?: string;
  media?: WhatsAppCloudMedia;
}

export interface WhatsAppCloudAdapterOptions {
  runtime: AgentRuntime;
  appSecret: string;
  tenantId: string;
  sessionMapper?: ChannelSessionMapper;
  maxMessagesPerMinutePerSender?: number;
  optOutKeywords?: string[];
  optInKeywords?: string[];
}

export interface WhatsAppCloudWebhookResult {
  accepted: boolean;
  duplicate?: boolean;
  optedOut?: boolean;
  rateLimited?: boolean;
  outputs: ChannelOutput[];
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

export function createWhatsAppAssistantAdapter(runtime: AgentRuntime): WhatsAppAssistantAdapter {
  return {
    surface: "whatsapp",
    async handleInbound(input) {
      const adapter = createHttpAssistantAdapter(runtime);
      return adapter.handleMessage({
        content: input.text,
        userId: input.from,
        metadata: {
          surface: "whatsapp",
          channel: "whatsapp",
          phoneNumber: input.from,
          profileName: input.profileName,
          messageId: input.messageId,
          ...input.metadata,
        },
      });
    },
  };
}

export class InMemoryChannelSessionMapper implements ChannelSessionMapper {
  private readonly sessions = new Map<string, string>();

  getSessionId(input: { tenantId: string; channel: string; senderId: string }): string | undefined {
    return this.sessions.get(sessionKey(input));
  }

  setSessionId(input: {
    tenantId: string;
    channel: string;
    senderId: string;
    sessionId: string;
  }): void {
    this.sessions.set(sessionKey(input), input.sessionId);
  }
}

export class WhatsAppCloudAdapter {
  private readonly mapper: ChannelSessionMapper;
  private readonly processedMessageIds = new Set<string>();
  private readonly optOutSenders = new Set<string>();
  private readonly senderTimestamps = new Map<string, number[]>();

  constructor(private readonly options: WhatsAppCloudAdapterOptions) {
    this.mapper = options.sessionMapper ?? new InMemoryChannelSessionMapper();
  }

  validateSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.options.appSecret).update(rawBody).digest("hex");
    const actual = signature.slice("sha256=".length);
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(actual, "hex");
    return (
      expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  async handleWebhook(input: WhatsAppCloudWebhookInput): Promise<WhatsAppCloudWebhookResult> {
    if (!this.validateSignature(input.rawBody, input.signature)) {
      throw new Error("Invalid WhatsApp webhook signature.");
    }
    const messages = parseWhatsAppCloudMessages(input.body ?? JSON.parse(input.rawBody));
    const outputs: ChannelOutput[] = [];

    for (const message of messages) {
      if (this.processedMessageIds.has(message.messageId)) {
        return { accepted: true, duplicate: true, outputs };
      }
      this.processedMessageIds.add(message.messageId);

      const senderKey = `${input.tenantId}:${message.from}`;
      const normalizedText = message.text.trim();
      if (this.isOptOut(normalizedText)) {
        this.optOutSenders.add(senderKey);
        return { accepted: true, optedOut: true, outputs };
      }
      if (this.isOptIn(normalizedText)) {
        this.optOutSenders.delete(senderKey);
      }
      if (this.optOutSenders.has(senderKey)) {
        return { accepted: true, optedOut: true, outputs };
      }
      if (!this.consumeRateLimit(senderKey)) {
        return { accepted: true, rateLimited: true, outputs };
      }

      const sessionId = this.getOrCreateSession(input.tenantId, message);
      const result = await this.options.runtime.runTurn({
        sessionId,
        content: normalizedText || mediaFallbackText(message.media),
        metadata: {
          surface: "whatsapp",
          channel: "whatsapp-cloud",
          tenantId: input.tenantId,
          phoneNumber: message.from,
          profileName: message.profileName,
          messageId: message.messageId,
          media: message.media,
        },
      });
      outputs.push({ sessionId, content: result.content, metadata: { model: result.model } });
    }

    return { accepted: true, outputs };
  }

  private getOrCreateSession(tenantId: string, message: WhatsAppCloudMessage): string {
    const existing = this.mapper.getSessionId({
      tenantId,
      channel: "whatsapp-cloud",
      senderId: message.from,
    });
    if (existing) return existing;
    const session = this.options.runtime.createSession({
      mode: "ask",
      metadata: {
        surface: "whatsapp",
        channel: "whatsapp-cloud",
        tenantId,
        phoneNumber: message.from,
        profileName: message.profileName,
      },
    });
    this.mapper.setSessionId({
      tenantId,
      channel: "whatsapp-cloud",
      senderId: message.from,
      sessionId: session.id,
    });
    return session.id;
  }

  private consumeRateLimit(senderKey: string): boolean {
    const limit = this.options.maxMessagesPerMinutePerSender;
    if (!limit) return true;
    const now = Date.now();
    const recent = (this.senderTimestamps.get(senderKey) ?? []).filter(
      (timestamp) => timestamp > now - 60_000,
    );
    if (recent.length >= limit) {
      this.senderTimestamps.set(senderKey, recent);
      return false;
    }
    recent.push(now);
    this.senderTimestamps.set(senderKey, recent);
    return true;
  }

  private isOptOut(text: string): boolean {
    const keywords = this.options.optOutKeywords ?? ["stop", "unsubscribe", "baja"];
    return keywords.includes(text.toLowerCase());
  }

  private isOptIn(text: string): boolean {
    const keywords = this.options.optInKeywords ?? ["start", "subscribe", "alta"];
    return keywords.includes(text.toLowerCase());
  }
}

export function createWhatsAppCloudAdapter(
  options: WhatsAppCloudAdapterOptions,
): WhatsAppCloudAdapter {
  return new WhatsAppCloudAdapter(options);
}

export function createInMemoryChannelSessionMapper(): ChannelSessionMapper {
  return new InMemoryChannelSessionMapper();
}

function sessionKey(input: { tenantId: string; channel: string; senderId: string }): string {
  return `${input.tenantId}:${input.channel}:${input.senderId}`;
}

function parseWhatsAppCloudMessages(body: unknown): WhatsAppCloudMessage[] {
  if (!body || typeof body !== "object") return [];
  const entries = Array.isArray((body as { entry?: unknown[] }).entry)
    ? (body as { entry: unknown[] }).entry
    : [];
  return entries.flatMap((entry) => {
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    return changes.flatMap((change) => {
      const value = (change as { value?: { messages?: unknown[]; contacts?: unknown[] } }).value;
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const profileByWaId = new Map(
        contacts.map((contact) => [
          (contact as { wa_id?: string }).wa_id,
          (contact as { profile?: { name?: string } }).profile?.name,
        ]),
      );
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      return messages.map((message) => normalizeWhatsAppMessage(message, profileByWaId));
    });
  });
}

function normalizeWhatsAppMessage(
  message: unknown,
  profileByWaId: Map<string | undefined, string | undefined>,
): WhatsAppCloudMessage {
  const record = message as Record<string, unknown>;
  const from = String(record["from"] ?? "");
  const type = String(record["type"] ?? "text");
  const text = type === "text" ? String((record["text"] as { body?: unknown })?.body ?? "") : "";
  const media = normalizeMedia(record, type);
  return {
    messageId: String(record["id"] ?? ""),
    from,
    text: text || media?.caption || "",
    profileName: profileByWaId.get(from),
    media,
  };
}

function normalizeMedia(
  record: Record<string, unknown>,
  type: string,
): WhatsAppCloudMedia | undefined {
  if (!["image", "audio", "video", "document", "sticker"].includes(type)) return undefined;
  const mediaRecord = record[type] as Record<string, unknown> | undefined;
  if (!mediaRecord) return undefined;
  return {
    id: String(mediaRecord["id"] ?? ""),
    type: type as WhatsAppCloudMedia["type"],
    mimeType: typeof mediaRecord["mime_type"] === "string" ? mediaRecord["mime_type"] : undefined,
    caption: typeof mediaRecord["caption"] === "string" ? mediaRecord["caption"] : undefined,
  };
}

function mediaFallbackText(media: WhatsAppCloudMedia | undefined): string {
  return media ? `[${media.type}:${media.id}]` : "";
}
