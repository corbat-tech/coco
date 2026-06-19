import { createServer, type ServerResponse } from "node:http";
import { publicWebsiteAssistantPreset } from "@corbat-tech/coco/presets";

const providerType = (process.env["COCO_PROVIDER"] ?? "openai") as "openai";
const model = process.env["COCO_MODEL"] ?? "gpt-5.4";
const port = Number(process.env["PORT"] ?? "8788");
const brand = process.env["BRAND"] ?? "Demo Company";

const runtime = await publicWebsiteAssistantPreset.createRuntime({
  brand,
  audience: process.env["AUDIENCE"] ?? "public website visitors",
  providerType,
  model,
});

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(request: AsyncIterable<Buffer>): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      product: "public-web-assistant",
      tools: runtime.snapshot().tools.names,
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
          metadata: { tenantId, product: "public-web-assistant" },
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

server.listen(port, () => {
  console.log(`Coco Public Web Assistant listening on http://localhost:${port}`);
});
