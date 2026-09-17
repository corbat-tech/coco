import { MCPTransportError } from "../errors.js";

/** Incoming bytes per JSON frame/SSE event (excluding LF delimiters), or HTTP body. */
export const MAX_MCP_MESSAGE_BYTES = 16 * 1024 * 1024;

export class MCPMessageLimitError extends MCPTransportError {
  constructor() {
    super(`MCP incoming message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes`);
  }
}

/** Geometric growth also bounds bookkeeping for streams of one-byte chunks. */
class BoundedBytes {
  private buffer = Buffer.alloc(0);
  private size = 0;

  constructor(private readonly limit = MAX_MCP_MESSAGE_BYTES) {}

  append(value: Uint8Array): void {
    const nextSize = this.size + value.byteLength;
    if (nextSize > this.limit) throw new MCPMessageLimitError();
    if (nextSize > this.buffer.length) {
      const grown = Buffer.allocUnsafe(
        Math.min(this.limit, Math.max(4096, nextSize, this.buffer.length * 2)),
      );
      this.buffer.copy(grown, 0, 0, this.size);
      this.buffer = grown;
    }
    this.buffer.set(value, this.size);
    this.size = nextSize;
  }

  take(): string {
    const text = this.buffer.toString("utf8", 0, this.size);
    this.buffer = Buffer.alloc(0);
    this.size = 0;
    return text;
  }

  get length(): number {
    return this.size;
  }
}

/** Frame bytes before decoding, preserving UTF-8 split across arbitrary chunks. */
export class BoundedLines {
  private bytes: BoundedBytes;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly reserve: (bytes: number) => void = () => {},
    private readonly limit = MAX_MCP_MESSAGE_BYTES,
  ) {
    this.bytes = new BoundedBytes(limit);
  }

  push(value: Uint8Array): void {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    let start = 0;
    while (start < bytes.length) {
      const newline = bytes.indexOf(10, start);
      const end = newline < 0 ? bytes.length : newline;
      const length = end - start;
      if (this.bytes.length + length > this.limit) throw new MCPMessageLimitError();
      this.reserve(length);
      // Copy only accepted bytes: do not retain an arbitrarily large backing chunk.
      this.bytes.append(bytes.subarray(start, end));
      if (newline < 0) return;
      this.emit();
      start = end + 1;
    }
  }

  finish(): void {
    if (this.bytes.length) this.emit();
  }

  private emit(): void {
    const line = this.bytes.take();
    this.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  }
}

/** Bound the whole SSE event, including ignored fields, not only individual lines. */
export function boundedEventLines(onLine: (line: string) => void): BoundedLines {
  let bytes = 0;
  return new BoundedLines(
    (line) => {
      if (line === "") bytes = 0;
      onLine(line);
    },
    (length) => {
      if (bytes + length > MAX_MCP_MESSAGE_BYTES) throw new MCPMessageLimitError();
      bytes += length;
    },
  );
}

export async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new MCPTransportError("JSON response has no body");
  const reader = response.body.getReader();
  const bytes = new BoundedBytes();
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes.append(value);
    }
    return JSON.parse(bytes.take()) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
