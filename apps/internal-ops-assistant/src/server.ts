import { createLocalServer, listenLocal, readJsonBody, sendJson } from "../../shared/local-http.js";
import { internalOpsAssistantPreset } from "@corbat-tech/coco/presets";
import type { InternalOpsDraftInput, InternalOpsDraftOutput } from "@corbat-tech/coco/tools";

const providerType = (process.env["COCO_PROVIDER"] ?? "openai") as "openai";
const model = process.env["COCO_MODEL"] ?? "gpt-5.4";
const port = Number(process.env["PORT"] ?? "8790");
const brand = process.env["BRAND"] ?? "Demo Company";

async function createInternalOpsDraft(
  input: InternalOpsDraftInput,
): Promise<InternalOpsDraftOutput> {
  const sensitiveWorkflow = /billing|account|permission|erp|crm/i.test(input.workflow);
  return {
    draft: [
      `Workflow: ${input.workflow}`,
      `Requested action: ${input.requestedAction}`,
      input.context ? `Context: ${input.context}` : "",
      "Recommended handling: prepare for human approval before execution.",
    ]
      .filter(Boolean)
      .join("\n"),
    risk: sensitiveWorkflow ? "high" : "medium",
    requiresApproval: true,
  };
}

const runtime = await internalOpsAssistantPreset.createRuntime({
  brand,
  providerType,
  model,
  opsDraft: createInternalOpsDraft,
});

export const server = createLocalServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      product: "internal-ops-assistant",
      tools: runtime.snapshot().tools.names,
    });
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/events/")) {
    const sessionId = decodeURIComponent(request.url.slice("/events/".length));
    const events = runtime.eventLog.list().filter((event) => event.data["sessionId"] === sessionId);
    sendJson(response, 200, { sessionId, events });
    return;
  }

  if (request.method !== "POST" || request.url !== "/chat") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const body = await readJsonBody(request);
  const message = typeof body["message"] === "string" ? body["message"] : "";
  if (!message) {
    sendJson(response, 400, { error: "message is required" });
    return;
  }

  const requestedSessionId = typeof body["sessionId"] === "string" ? body["sessionId"] : undefined;
  const tenantId = typeof body["tenantId"] === "string" ? body["tenantId"] : "demo";
  const session =
    requestedSessionId && runtime.getSession(requestedSessionId)
      ? runtime.getSession(requestedSessionId)!
      : runtime.createSession({
          mode: "ask",
          metadata: { tenantId, product: "internal-ops-assistant" },
        });

  const result = await runtime.runTurn({
    sessionId: session.id,
    content: message,
    metadata: { tenantId },
  });

  sendJson(response, 200, {
    sessionId: result.sessionId,
    content: result.content,
    model: result.model,
  });
});

listenLocal(server, port, "Coco internal-ops-assistant");
