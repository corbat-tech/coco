import { describe, expect, it, vi } from "vitest";
import { createWhatsAppAssistantAdapter } from "./index.js";
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
});
