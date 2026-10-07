import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ReplSession } from "../types.js";
const io = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../../config/env.js", () => ({ saveThinkingPreference: io.save }));
import { thinkingCommand, selectThinkingInteractively } from "./thinking.js";
import { mapToOllamaEffort } from "../../../providers/thinking.js";
function session(type = "anthropic", model = "claude-sonnet-4-5") {
  return { config: { provider: { type, model, thinking: "high" } } } as ReplSession;
}
describe("thinking command behavior", () => {
  let input: EventEmitter & {
    isTTY: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    input = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
    });
    vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
  });
  afterEach(() => vi.restoreAllMocks());
  it("preserves explicit off for live Ollama requests and persisted reload", async () => {
    const current = session("ollama", "qwen3.5:4b");
    await thinkingCommand.execute(["off"], current);
    expect(current.config.provider.thinking).toBe("off");
    expect(io.save).toHaveBeenCalledWith("ollama", "off");
    expect(mapToOllamaEffort(current.config.provider.thinking, current.config.provider.model)).toBe(
      "none",
    );
  });
  it("retains current mode when preference storage fails", async () => {
    const current = session();
    io.save.mockRejectedValue(new Error("disk full"));
    await expect(thinkingCommand.execute(["off"], current)).rejects.toThrow("disk full");
    expect(current.config.provider.thinking).toBe("high");
  });
  it.each(["8000junk", "8000.5", "8e3", "-1", "9007199254740993", "invalid"])(
    "rejects malformed budget %s without changing mode",
    async (value) => {
      const current = session();
      await thinkingCommand.execute([value], current);
      expect(current.config.provider.thinking).toBe("high");
      expect(io.save).not.toHaveBeenCalled();
    },
  );
  it("accepts valid budget and refuses out-of-range or unsupported model controls", async () => {
    const current = session();
    await thinkingCommand.execute(["8000"], current);
    expect(current.config.provider.thinking).toEqual({ budget: 8000 });
    expect(io.save).toHaveBeenCalledWith("anthropic", { budget: 8000 });
    io.save.mockClear();
    await thinkingCommand.execute(["999999"], current);
    await thinkingCommand.execute(["8000"], session("openai", "gpt-5.2"));
    await thinkingCommand.execute(["high"], session("openai", "gpt-4o"));
    await thinkingCommand.execute(["off"], session("ollama", "gpt-oss:20b"));
    expect(io.save).not.toHaveBeenCalled();
  });
  it("interactive navigation wraps and cleans up raw input after selection", async () => {
    const pending = selectThinkingInteractively(["off", "low", { budget: 8000 }], "off", true);
    input.emit("data", Buffer.from("\x1b[A"));
    input.emit("data", Buffer.from("\r"));
    expect(await pending).toEqual({ budget: 8000 });
    expect(input.listenerCount("data")).toBe(0);
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.pause).toHaveBeenCalled();
  });
  it.each(["q", "\x1b", "\x03"])("interactive cancellation %j retains preferences", async (key) => {
    const current = session();
    const pending = thinkingCommand.execute([], current);
    input.emit("data", Buffer.from(key));
    await pending;
    expect(current.config.provider.thinking).toBe("high");
    expect(io.save).not.toHaveBeenCalled();
    expect(input.listenerCount("data")).toBe(0);
  });
  it("interactive command saves selected effort and repeated choice stays consistent", async () => {
    const current = session("openai", "gpt-5.2");
    const pending = thinkingCommand.execute([], current);
    input.emit("data", Buffer.from("\x1b[B"));
    input.emit("data", Buffer.from("\n"));
    await pending;
    expect(io.save).toHaveBeenCalled();
    const selected = current.config.provider.thinking;
    await thinkingCommand.execute([String(selected)], current);
    expect(current.config.provider.thinking).toEqual(selected);
  });
});
