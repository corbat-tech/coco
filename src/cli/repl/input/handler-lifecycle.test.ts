import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplSession } from "../types.js";
import { createInputHandler, type InputHandler } from "./handler.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("../commands/index.js", () => ({
  getAllCommands: () => [
    { name: "help", description: "Help" },
    { name: "history", description: "History" },
    { name: "model", description: "Model" },
  ],
  setPendingImage: vi.fn(),
  getPendingImageCount: () => 0,
}));
vi.mock("../quality-loop.js", () => ({ isQualityLoop: () => false }));
vi.mock("../output/clipboard.js", () => ({
  readClipboardImage: vi.fn(async () => null),
  copyToClipboard: vi.fn(),
}));
vi.mock("../output/renderer.js", () => ({ getLastBlock: () => null }));

const events = ["data", "end", "close", "error"] as const;
const emit = (value: string | Buffer) =>
  process.stdin.emit("data", Buffer.isBuffer(value) ? value : Buffer.from(value));

describe("actual input handler behavior and ownership", () => {
  let handler: InputHandler;
  let counts: number[];
  let resize: number;
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdin, "resume").mockReturnThis();
    vi.spyOn(process.stdin, "pause").mockReturnThis();
    vi.spyOn(process.stdin, "readableEnded", "get").mockReturnValue(false);
    vi.spyOn(process.stdin, "destroyed", "get").mockReturnValue(false);
    counts = events.map((event) => process.stdin.listenerCount(event));
    resize = process.stdout.listenerCount("resize");
    handler = createInputHandler({} as ReplSession);
  });
  afterEach(() => {
    handler.close();
    expect(events.map((event) => process.stdin.listenerCount(event))).toEqual(counts);
    expect(process.stdout.listenerCount("resize")).toBe(resize);
    vi.restoreAllMocks();
  });
  it("settles active input and removes listeners on explicit close", async () => {
    const pending = handler.prompt();
    handler.close();
    await expect(pending).resolves.toBeNull();
    await expect(handler.prompt()).resolves.toBeNull();
    expect(process.stdin.pause).toHaveBeenCalled();
  });
  it.each(["end", "close"])(
    "settles EOF event %s without waiting for another character",
    async (event) => {
      const pending = handler.prompt();
      process.stdin.emit(event);
      await expect(pending).resolves.toBeNull();
    },
  );
  it("rejects input errors and releases prompt resources", async () => {
    const pending = handler.prompt();
    const assertion = expect(pending).rejects.toThrow("terminal lost");
    process.stdin.emit("error", new Error("terminal lost"));
    await assertion;
  });
  it("rejects overlapping prompts without displacing the first owner", async () => {
    const pending = handler.prompt();
    await expect(handler.prompt()).rejects.toThrow(/already active/);
    emit("retained");
    emit("\r");
    await expect(pending).resolves.toBe("retained");
  });
  it("preserves Unicode split across stdin chunks", async () => {
    const pending = handler.prompt();
    const bytes = Buffer.from("café 🥥");
    for (const byte of bytes) emit(Buffer.from([byte]));
    emit("\r");
    await expect(pending).resolves.toBe("café 🥥");
  });
  it("keeps bracketed multiline paste as input rather than executing embedded enter", async () => {
    const pending = handler.prompt();
    emit("\x1b[200~first\n");
    emit("second");
    emit("\x1b[201~");
    emit("\r");
    await expect(pending).resolves.toBe("first\nsecond");
  });
  it.each([
    { keys: ["abc", "\x01", "X", "\x05", "\x7f"], expected: "Xab" },
    { keys: ["abcd", "\x1b[H", "\x1b[C", "\x1b[3~"], expected: "acd" },
    { keys: ["one two", "\x1bb", "\x0b"], expected: "one" },
    { keys: ["one two", "\x1bb", "\x15"], expected: "two" },
    { keys: ["discard", "\x03", "replacement"], expected: "replacement" },
    { keys: ["/h", "\x1b[C", "\t"], expected: "/history" },
  ])("edits submitted text correctly: $expected", async ({ keys, expected }) => {
    const pending = handler.prompt();
    for (const key of keys) emit(key);
    process.stdout.emit("resize");
    emit("\r");
    await expect(pending).resolves.toBe(expected);
  });
  it("recalls history across prompts without duplicating listeners", async () => {
    const first = handler.prompt();
    emit("previous task");
    emit("\r");
    await first;
    const second = handler.prompt();
    emit("\x1b[A");
    emit("\r");
    await expect(second).resolves.toBe("previous task");
  });
});
