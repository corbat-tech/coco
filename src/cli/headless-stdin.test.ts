import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readHeadlessStdin } from "./headless-stdin.js";

function expectClean(input: PassThrough) {
  for (const event of ["data", "end", "error", "close"]) expect(input.listenerCount(event)).toBe(0);
}
describe("headless stdin ownership", () => {
  it("preserves fragmented Unicode and removes all owned listeners", async () => {
    const input = new PassThrough();
    const result = readHeadlessStdin(input);
    const text = Buffer.from("arregla el 🐛");
    input.write(text.subarray(0, text.length - 2));
    input.end(text.subarray(text.length - 2));
    expect(await result).toBe("arregla el 🐛");
    expectClean(input);
  });
  it("bounds bytes before retaining an oversized chunk", async () => {
    const input = new PassThrough();
    const result = readHeadlessStdin(input, { maxBytes: 4 });
    input.write(Buffer.alloc(5));
    await expect(result).rejects.toThrow("limit");
    expectClean(input);
    input.destroy();
  });
  it("keeps its deadline after the first chunk and rejects partial tasks", async () => {
    const input = new PassThrough();
    const result = readHeadlessStdin(input, { timeoutMs: 10 });
    input.write("partial");
    await expect(result).rejects.toThrow("deadline");
    expectClean(input);
    input.destroy();
  });
  it("cancels and removes listeners without destroying a caller-owned stream", async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const result = readHeadlessStdin(input, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toThrow("cancelled");
    expect(input.destroyed).toBe(false);
    expectClean(input);
    input.destroy();
  });
  it("does not attach listeners to a terminal", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    expect(await readHeadlessStdin(input)).toBe("");
    expectClean(input);
    input.destroy();
  });
  it("rejects malformed UTF-8 instead of silently replacing task bytes", async () => {
    const input = new PassThrough();
    const result = readHeadlessStdin(input);
    input.end(Buffer.from([0xff]));
    await expect(result).rejects.toThrow("UTF-8");
    expectClean(input);
  });
  it("reports source errors with cleanup", async () => {
    const input = new PassThrough();
    const result = readHeadlessStdin(input);
    input.emit("error", new Error("producer failed"));
    await expect(result).rejects.toThrow("producer failed");
    expectClean(input);
    input.destroy();
  });
});
