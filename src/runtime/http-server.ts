import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentRuntime } from "./agent-runtime.js";
import { isAgentMode } from "./agent-modes.js";
import type { RuntimeMode, RuntimeTurnInput } from "./types.js";

export interface RuntimeHttpServerOptions {
  maxBodyBytes?: number;
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readJsonBody<T>(request: IncomingMessage, maxBodyBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new HttpRequestError(`Request body exceeds ${maxBodyBytes} bytes.`, 413);
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  try {
    return (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    throw new HttpRequestError("Invalid JSON request body.", 400);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { error: "Not found" });
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpRequestError) {
    sendJson(response, error.status, { error: error.message });
    return;
  }

  sendJson(response, 500, { error: "Internal server error" });
}

function assertValidMode(mode: unknown): RuntimeMode | undefined {
  if (mode === undefined) return undefined;
  if (typeof mode === "string" && isAgentMode(mode)) return mode;
  throw new HttpRequestError("Invalid runtime mode.", 400);
}

export function createRuntimeHttpServer(
  runtime: AgentRuntime,
  options: RuntimeHttpServerOptions = {},
): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (request.method === "POST" && url.pathname === "/sessions") {
        const body = await readJsonBody<{
          mode?: RuntimeMode;
          instructions?: string;
          metadata?: Record<string, unknown>;
        }>(request, maxBodyBytes);
        const session = runtime.createSession({
          mode: assertValidMode(body.mode),
          instructions: body.instructions,
          metadata: body.metadata,
        });
        sendJson(response, 201, session);
        return;
      }

      if (request.method === "GET" && parts[0] === "sessions" && parts[1] && parts.length === 2) {
        const session = runtime.getSession(parts[1]);
        if (!session) {
          notFound(response);
          return;
        }
        sendJson(response, 200, session);
        return;
      }

      if (
        request.method === "POST" &&
        parts[0] === "sessions" &&
        parts[1] &&
        parts[2] === "messages"
      ) {
        const body = await readJsonBody<Omit<RuntimeTurnInput, "sessionId">>(request, maxBodyBytes);
        if (!body.content || typeof body.content !== "string") {
          sendJson(response, 400, { error: "content is required" });
          return;
        }
        if (!runtime.getSession(parts[1])) {
          notFound(response);
          return;
        }
        const result = await runtime.runTurn({
          ...body,
          mode: assertValidMode(body.mode),
          sessionId: parts[1],
        });
        sendJson(response, 200, result);
        return;
      }

      if (
        request.method === "GET" &&
        parts[0] === "sessions" &&
        parts[1] &&
        parts[2] === "events"
      ) {
        const events = runtime.eventLog
          .list()
          .filter((event) => event.data["sessionId"] === parts[1]);
        sendJson(response, 200, { events });
        return;
      }

      if (request.method === "GET" && url.pathname === "/state") {
        sendJson(response, 200, runtime.snapshot());
        return;
      }

      notFound(response);
    } catch (error) {
      sendError(response, error);
    }
  });
}
