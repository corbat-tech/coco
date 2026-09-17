import { describe, expect, it, vi } from "vitest";
import {
  BoundedLines,
  boundedEventLines,
  MAX_MCP_MESSAGE_BYTES,
  MCPMessageLimitError,
  readBoundedJson,
} from "./limits.js";

describe("bounded MCP incoming framing", () => {
  it.each([MAX_MCP_MESSAGE_BYTES - 1, MAX_MCP_MESSAGE_BYTES])("accepts a %i byte frame", (size) => {
    const onLine = vi.fn();
    const lines = new BoundedLines(onLine);
    lines.push(Buffer.alloc(size, 120));
    lines.push(Buffer.from("\n"));
    expect(onLine.mock.calls[0]?.[0]).toHaveLength(size);
  });

  it.each([false, true])("rejects oversized frames before delivery, chunked=%s", (chunked) => {
    const onLine = vi.fn();
    const lines = new BoundedLines(onLine);
    if (chunked) lines.push(Buffer.alloc(MAX_MCP_MESSAGE_BYTES, 120));
    expect(() => lines.push(Buffer.alloc(chunked ? 1 : MAX_MCP_MESSAGE_BYTES + 1, 120))).toThrow(
      MCPMessageLimitError,
    );
    expect(onLine).not.toHaveBeenCalled();
  });

  it("preserves multibyte UTF-8 and resets the budget for every frame", () => {
    const onLine = vi.fn();
    const lines = new BoundedLines(onLine, undefined, 4);
    for (const byte of Buffer.from("😀\n😀\n")) lines.push(Uint8Array.of(byte));
    expect(onLine.mock.calls).toEqual([["😀"], ["😀"]]);
  });

  it("bounds aggregate SSE fields even though each line fits", () => {
    const lines = boundedEventLines(() => {});
    const half = Buffer.alloc(MAX_MCP_MESSAGE_BYTES / 2, 120);
    lines.push(half);
    lines.push(Buffer.from("\n"));
    lines.push(half);
    lines.push(Buffer.from("\n"));
    expect(() => lines.push(Buffer.from("x"))).toThrow(MCPMessageLimitError);
  });

  it("resets the SSE event budget only at an empty line", () => {
    const lines = boundedEventLines(() => {});
    const full = Buffer.alloc(MAX_MCP_MESSAGE_BYTES, 120);
    lines.push(full);
    lines.push(Buffer.from("\n\n"));
    expect(() => lines.push(full)).not.toThrow();
  });

  it("counts HTTP body bytes regardless of content-length and cancels overflow", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.alloc(MAX_MCP_MESSAGE_BYTES + 1));
      },
      cancel,
    });
    const response = new Response(body, { headers: { "content-length": "1" } });
    await expect(readBoundedJson(response, new AbortController().signal)).rejects.toThrow(
      MCPMessageLimitError,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("preserves split UTF-8 JSON and accepts an exactly bounded body", async () => {
    const source = Buffer.from(JSON.stringify({ text: "😀" }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of source) controller.enqueue(Uint8Array.of(byte));
        controller.enqueue(Buffer.alloc(MAX_MCP_MESSAGE_BYTES - source.length, 32));
        controller.close();
      },
    });
    await expect(
      readBoundedJson(new Response(body), new AbortController().signal),
    ).resolves.toEqual({ text: "😀" });
  });
});
