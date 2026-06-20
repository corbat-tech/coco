import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createWhatsAppAssistantAdapter, createWhatsAppCloudAdapter } from "./index.js";
import type { AgentRuntime } from "../runtime/agent-runtime.js";

describe("product channel adapters", () => {
  it("maps WhatsApp inbound messages into runtime turns with channel metadata", async () => {
    const runtime = {
      createSession: vi.fn(() => ({ id: "session-1" })),
      runTurn: vi.fn(async () => ({
        sessionId: "session-1",
        content: "Hola, podemos ayudarte.",
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock",
        mode: "ask",
      })),
    } as unknown as AgentRuntime;

    const adapter = createWhatsAppAssistantAdapter(runtime);
    const result = await adapter.handleInbound({
      from: "+34123456789",
      text: "Necesito ayuda con una factura",
      messageId: "wamid-1",
      profileName: "Valeria",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      content: "Hola, podemos ayudarte.",
      metadata: { model: "mock" },
    });
    expect(runtime.runTurn).toHaveBeenCalledWith({
      sessionId: "session-1",
      content: "Necesito ayuda con una factura",
      metadata: {
        surface: "whatsapp",
        channel: "whatsapp",
        phoneNumber: "+34123456789",
        profileName: "Valeria",
        messageId: "wamid-1",
      },
    });
  });

  it("validates WhatsApp Cloud signatures, deduplicates messages, and preserves sender sessions", async () => {
    const runtime = {
      createSession: vi.fn(() => ({ id: "session-1" })),
      runTurn: vi.fn(async () => ({
        sessionId: "session-1",
        content: "Respuesta",
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock",
        mode: "ask",
      })),
    } as unknown as AgentRuntime;
    const adapter = createWhatsAppCloudAdapter({
      runtime,
      appSecret: "secret",
      tenantId: "acme",
    });
    const rawBody = JSON.stringify(whatsappPayload({ id: "wamid-1", text: "Hola" }));
    const signature = sign(rawBody);

    await expect(
      adapter.handleWebhook({ rawBody, signature: "sha256=bad", tenantId: "acme" }),
    ).rejects.toThrow("Invalid WhatsApp webhook signature.");

    const first = await adapter.handleWebhook({ rawBody, signature, tenantId: "acme" });
    const duplicate = await adapter.handleWebhook({ rawBody, signature, tenantId: "acme" });
    const secondRawBody = JSON.stringify(whatsappPayload({ id: "wamid-2", text: "Otra" }));
    const second = await adapter.handleWebhook({
      rawBody: secondRawBody,
      signature: sign(secondRawBody),
      tenantId: "acme",
    });

    expect(first.outputs[0]).toMatchObject({ sessionId: "session-1", content: "Respuesta" });
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true, outputs: [] });
    expect(second.outputs[0]?.sessionId).toBe("session-1");
    expect(runtime.createSession).toHaveBeenCalledTimes(1);
    expect(runtime.runTurn).toHaveBeenCalledTimes(2);
  });

  it("normalizes media, opt-out, and rate limits WhatsApp Cloud senders", async () => {
    const runtime = {
      createSession: vi.fn(() => ({ id: "session-1" })),
      runTurn: vi.fn(async () => ({
        sessionId: "session-1",
        content: "Ok",
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock",
        mode: "ask",
      })),
    } as unknown as AgentRuntime;
    const adapter = createWhatsAppCloudAdapter({
      runtime,
      appSecret: "secret",
      tenantId: "acme",
      maxMessagesPerMinutePerSender: 1,
    });
    const mediaRawBody = JSON.stringify(
      whatsappPayload({
        id: "wamid-media",
        type: "image",
        media: { id: "media-1", mime_type: "image/jpeg", caption: "Factura" },
      }),
    );

    const media = await adapter.handleWebhook({
      rawBody: mediaRawBody,
      signature: sign(mediaRawBody),
      tenantId: "acme",
    });
    const limitedRawBody = JSON.stringify(whatsappPayload({ id: "wamid-limited", text: "Hola" }));
    const limited = await adapter.handleWebhook({
      rawBody: limitedRawBody,
      signature: sign(limitedRawBody),
      tenantId: "acme",
    });

    const optOutAdapter = createWhatsAppCloudAdapter({
      runtime,
      appSecret: "secret",
      tenantId: "acme",
    });
    const stopRawBody = JSON.stringify(whatsappPayload({ id: "wamid-stop", text: "STOP" }));
    const optedOut = await optOutAdapter.handleWebhook({
      rawBody: stopRawBody,
      signature: sign(stopRawBody),
      tenantId: "acme",
    });

    expect(media.accepted).toBe(true);
    expect(runtime.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Factura",
        metadata: expect.objectContaining({
          media: {
            id: "media-1",
            type: "image",
            mimeType: "image/jpeg",
            caption: "Factura",
          },
        }),
      }),
    );
    expect(limited).toMatchObject({ accepted: true, rateLimited: true, outputs: [] });
    expect(optedOut).toMatchObject({ accepted: true, optedOut: true, outputs: [] });
  });
});

function sign(rawBody: string): string {
  return `sha256=${createHmac("sha256", "secret").update(rawBody).digest("hex")}`;
}

function whatsappPayload(input: {
  id: string;
  text?: string;
  type?: string;
  media?: Record<string, unknown>;
}): unknown {
  const type = input.type ?? "text";
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "+34123456789", profile: { name: "Valeria" } }],
              messages: [
                {
                  id: input.id,
                  from: "+34123456789",
                  type,
                  ...(type === "text" ? { text: { body: input.text ?? "" } } : {}),
                  ...(input.media ? { [type]: input.media } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
