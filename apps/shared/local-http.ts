import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 64 * 1024;

class HttpInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(status >= 400 ? { connection: "close" } : {}),
  });
  response.end(JSON.stringify(body, null, 2));
}

/** Bound memory while retaining the socket long enough to send a useful 413. */
export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpInputError("Content-Type must be application/json", 415);
  }
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpInputError("Request body too large", 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpInputError("Request body too large", 413);
    chunks.push(buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpInputError("Invalid JSON request body", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpInputError("Request body must be an object", 400);
  }
  const input = body as Record<string, unknown>;
  if (typeof input["message"] !== "string" || !input["message"].trim()) {
    throw new HttpInputError("message must be a non-empty string", 400);
  }
  for (const key of ["sessionId", "tenantId"]) {
    if (input[key] !== undefined && typeof input[key] !== "string") {
      throw new HttpInputError(`${key} must be a string`, 400);
    }
  }
  if (
    input["confirmedTools"] !== undefined &&
    (!Array.isArray(input["confirmedTools"]) ||
      !input["confirmedTools"].every((tool) => typeof tool === "string"))
  ) {
    throw new HttpInputError("confirmedTools must be an array of strings", 400);
  }
  return input;
}

/** Local demo transport only; this does not provide hosted authentication or tenant isolation. */
export function createLocalServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Server {
  return createServer(async (request, response) => {
    try {
      try {
        decodeURI(request.url ?? "/");
      } catch {
        throw new HttpInputError("Invalid request URL", 400);
      }
      await handler(request, response);
    } catch (error) {
      sendJson(response, error instanceof HttpInputError ? error.status : 500, {
        error: error instanceof HttpInputError ? error.message : "Internal server error",
      });
    }
  });
}

export function listenLocal(server: Server, port: number, label: string): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") {
      console.log(`${label} local demo listening on http://127.0.0.1:${address.port}`);
    }
  });
}
