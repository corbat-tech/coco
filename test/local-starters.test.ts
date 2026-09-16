import { once } from "node:events";
import { request, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HumanEscalationInput, HumanEscalationOutput } from "../src/tools/profiles.js";

const mocks = vi.hoisted(() => ({
  supportEscalation: undefined as
    | undefined
    | ((input: HumanEscalationInput) => Promise<HumanEscalationOutput>),
  runtime: {
    snapshot: vi.fn(() => ({ tools: { names: ["fixture_read"] } })),
    eventLog: { list: vi.fn(() => []) },
    getSession: vi.fn(() => undefined),
    createSession: vi.fn(() => ({ id: "fixture-session" })),
    runTurn: vi.fn(),
  },
}));
vi.mock("@corbat-tech/coco/presets", () => {
  const preset = { createRuntime: vi.fn(async () => mocks.runtime) };
  return {
    publicWebsiteAssistantPreset: preset,
    internalOpsAssistantPreset: preset,
    salesIntakeAssistantPreset: preset,
    supportRagAssistantPreset: {
      createRuntime: vi.fn(async (options) => {
        mocks.supportEscalation = options.humanEscalation;
        return mocks.runtime;
      }),
    },
  };
});
vi.mock("@corbat-tech/coco/runtime", () => ({
  createInMemoryKnowledgeRetriever: vi.fn(() => ({})),
}));
vi.mock("../apps/support-rag-assistant/src/knowledge.js", () => ({
  loadMarkdownKnowledge: vi.fn(async () => []),
  createFallbackKnowledge: vi.fn(() => []),
}));

const apps = [
  ["public-web-assistant", () => import("../apps/public-web-assistant/src/server.js")],
  ["internal-ops-assistant", () => import("../apps/internal-ops-assistant/src/server.js")],
  ["sales-intake-assistant", () => import("../apps/sales-intake-assistant/src/server.js")],
  ["support-rag-assistant", () => import("../apps/support-rag-assistant/src/server.js")],
] as const;

describe.each(apps)("%s real local HTTP entrypoint", (app, load) => {
  let server: Server;
  let port: number;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.stubEnv("PORT", "0");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    ({ server } = await load());
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    port = address.port;
  });

  beforeEach(() => {
    mocks.runtime.createSession.mockClear();
    mocks.runtime.runTurn.mockReset().mockResolvedValue({
      sessionId: "fixture-session",
      content: "fixture reply",
      model: "fixture-model",
    });
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    consoleSpy?.mockRestore();
    vi.unstubAllEnvs();
  });

  function send(
    method: string,
    url: string,
    chunks: string[] = [],
    headers: Record<string, string> = {},
  ) {
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port, path: url, method, headers, agent: false },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode!, text }));
          response.on("error", reject);
        },
      );
      req.on("error", reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }
  const post = (raw: string, headers: Record<string, string> = {}) =>
    send("POST", "/chat", [raw], { "content-type": "application/json", ...headers });

  async function healthyChat() {
    expect((await send("GET", "/health")).status).toBe(200);
    const result = await post(JSON.stringify({ message: "hello" }));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toMatchObject({
      sessionId: "fixture-session",
      content: "fixture reply",
    });
  }

  it("binds only IPv4 loopback, answers health and accepts valid chat", async () => {
    expect(server.address()).toMatchObject({ address: "127.0.0.1" });
    const health = await send("GET", "/health");
    expect(JSON.parse(health.text)).toMatchObject({ ok: true, product: app });
    await healthyChat();
    expect(mocks.runtime.runTurn).toHaveBeenCalledTimes(1);
    expect(mocks.runtime.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello" }),
    );
  });

  it.each([
    "{",
    "null",
    "[]",
    '{"message":42}',
    '{"message":""}',
    '{"message":"   "}',
    '{"message":"hello","sessionId":1}',
    '{"message":"hello","tenantId":{}}',
    '{"message":"hello","confirmedTools":"write_file"}',
    '{"message":"hello","confirmedTools":[1]}',
  ])("rejects invalid chat input before provider/session effects: %s", async (raw) => {
    expect((await post(raw)).status).toBe(400);
    expect(mocks.runtime.runTurn).not.toHaveBeenCalled();
    expect(mocks.runtime.createSession).not.toHaveBeenCalled();
    await healthyChat();
  });

  it("requires application/json media type", async () => {
    expect((await post('{"message":"hello"}', { "content-type": "text/plain" })).status).toBe(415);
    expect(mocks.runtime.runTurn).not.toHaveBeenCalled();
    await healthyChat();
  });

  it.each(["content-length", "chunked", "multibyte"])(
    "rejects an oversized %s body and remains usable",
    async (variant) => {
      const raw = JSON.stringify({
        message: variant === "multibyte" ? "😀".repeat(20000) : "x".repeat(66000),
      });
      expect(Buffer.byteLength(raw)).toBeGreaterThan(64 * 1024);
      if (variant === "multibyte") expect(raw.length).toBeLessThan(64 * 1024);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (variant === "content-length") headers["content-length"] = String(Buffer.byteLength(raw));
      else headers["transfer-encoding"] = "chunked";
      const result = await send("POST", "/chat", [raw.slice(0, 100), raw.slice(100)], headers);
      expect(result.status).toBe(413);
      expect(mocks.runtime.runTurn).not.toHaveBeenCalled();
      expect(mocks.runtime.createSession).not.toHaveBeenCalled();
      await healthyChat();
    },
  );

  it("returns a generic 500 without leaking runtime errors and recovers", async () => {
    mocks.runtime.runTurn.mockRejectedValueOnce(
      new Error("PRIVATE_PROVIDER_SECRET fixture-token-123"),
    );
    const result = await post('{"message":"hello"}');
    expect(result.status).toBe(500);
    expect(JSON.parse(result.text)).toHaveProperty("error");
    expect(result.text).not.toMatch(/PRIVATE_PROVIDER_SECRET|fixture-token-123|Error:|stack/i);
    await healthyChat();
  });

  it("rejects malformed percent escapes in the event URI without calling the provider", async () => {
    expect((await send("GET", "/events/%E0%A4%A")).status).toBe(400);
    expect(mocks.runtime.runTurn).not.toHaveBeenCalled();
    await healthyChat();
  });

  if (app === "support-rag-assistant") {
    it("returns an unsent proposal without inventing a queue or escalation identifier", async () => {
      expect(mocks.supportEscalation).toBeTypeOf("function");
      const result = await mocks.supportEscalation!({
        conversationId: "fixture-conversation",
        summary: "Needs review",
        priority: "urgent",
        reason: "Customer asks for a person",
      });
      expect(result.queued).toBe(false);
      expect(result.escalationId).toBe("");
      expect(result.message).toContain("no escalation was sent or queued");
      expect(result.message).toContain("fixture-conversation");
    });
  }

  it("survives a client abort during a partial JSON body", async () => {
    const accepted = once(server, "request");
    const req = request({
      hostname: "127.0.0.1",
      port,
      path: "/chat",
      method: "POST",
      agent: false,
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    });
    req.on("error", () => {});
    const closed = new Promise<void>((resolve) => req.once("close", resolve));
    req.write('{"message":"partial');
    await accepted;
    req.destroy();
    await closed;
    expect(mocks.runtime.runTurn).not.toHaveBeenCalled();
    await healthyChat();
  });
});
