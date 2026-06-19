import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import { createInMemoryKnowledgeRetriever } from "@corbat-tech/coco/runtime";
import { supportRagAssistantPreset } from "@corbat-tech/coco/presets";
import type { HumanEscalationInput, SupportDraftInput } from "@corbat-tech/coco/tools";
import { createFallbackKnowledge, loadMarkdownKnowledge } from "./knowledge.js";

const providerType = (process.env["COCO_PROVIDER"] ?? "openai") as "openai";
const model = process.env["COCO_MODEL"] ?? "gpt-5.4";
const port = Number(process.env["PORT"] ?? "8787");
const knowledgeDir = process.env["KNOWLEDGE_DIR"] ?? path.join(process.cwd(), "knowledge");

const markdownKnowledge = await loadMarkdownKnowledge(knowledgeDir);
const knowledge = markdownKnowledge.length > 0 ? markdownKnowledge : createFallbackKnowledge();
const retriever = createInMemoryKnowledgeRetriever(knowledge);

async function createSupportDraft(input: SupportDraftInput) {
  const citations = (input.retrievedSources ?? []).map((source) => source.title);
  return {
    draft: [
      "Thanks for the details. Based on the approved support knowledge, here is the recommended response draft:",
      input.customerMessage,
      citations.length > 0 ? `Sources: ${citations.join(", ")}` : "No approved source matched.",
    ].join("\n\n"),
    citations,
    needsHumanReview: citations.length === 0,
  };
}

async function requestHumanEscalation(input: HumanEscalationInput) {
  return {
    queued: true,
    escalationId: `esc_${Date.now().toString(36)}`,
    message: `Prepared ${input.priority} escalation for ${input.conversationId}: ${input.reason}`,
  };
}

const runtime = await supportRagAssistantPreset.createRuntime({
  brand: "Demo Company",
  providerType,
  model,
  retriever,
  supportDraft: createSupportDraft,
  humanEscalation: requestHumanEscalation,
});

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      product: "support-rag-assistant",
      knowledgeDocuments: knowledge.length,
    });
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/events/")) {
    const sessionId = decodeURIComponent(request.url.slice("/events/".length));
    const events = runtime.eventLog
      .list()
      .filter((event) => event.data["sessionId"] === sessionId);
    sendJson(response, 200, { sessionId, events });
    return;
  }

  if (request.method !== "POST" || request.url !== "/chat") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw || "{}") as {
    message?: string;
    sessionId?: string;
    tenantId?: string;
    confirmedTools?: string[];
  };

  if (!body.message) {
    sendJson(response, 400, { error: "message is required" });
    return;
  }

  const session =
    body.sessionId && runtime.getSession(body.sessionId)
      ? runtime.getSession(body.sessionId)!
      : runtime.createSession({
          mode: "ask",
          instructions: [
            "Answer support questions from approved knowledge.",
            "Use knowledge_search before answering factual policy questions.",
            "Use create_support_draft when a support reply draft is requested.",
            "Use request_human_escalation only when explicitly confirmed by the caller.",
          ].join("\n"),
          metadata: {
            tenantId: body.tenantId ?? "demo",
            product: "support-rag-assistant",
          },
        });

  const result = await runtime.runTurn({
    sessionId: session.id,
    content: body.message,
    confirmedTools: body.confirmedTools,
    metadata: { tenantId: body.tenantId ?? "demo" },
  });

  sendJson(response, 200, {
    sessionId: result.sessionId,
    content: result.content,
    model: result.model,
    events: runtime.eventLog.list().slice(-10),
  });
});

server.listen(port, () => {
  console.log(`Coco Support/RAG Assistant listening on http://localhost:${port}`);
});
