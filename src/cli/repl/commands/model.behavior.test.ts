import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ReplSession } from "../types.js";
const io = vi.hoisted(() => ({ save: vi.fn(), saveThinking: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../config/env.js", () => ({
  getBaseUrl: () => "http://localhost:11434/v1",
  saveProviderPreference: io.save,
  saveThinkingPreference: io.saveThinking,
}));
vi.mock("../providers-config.js", () => {
  const defs = [
    {
      id: "anthropic",
      name: "Anthropic",
      emoji: "A",
      models: [
        { id: "claude-sonnet-4-6", name: "Sonnet", contextWindow: 200000, recommended: true },
        { id: "claude-opus-4-6", name: "Opus", description: "Reasoning" },
      ],
    },
    {
      id: "openai",
      name: "OpenAI",
      emoji: "O",
      models: [{ id: "gpt-5.2", description: "Premium x1" }],
    },
    {
      id: "ollama",
      name: "Ollama",
      emoji: "L",
      models: [
        { id: "qwen3.5:4b", name: "Qwen", recommended: true },
        { id: "missing:8b", description: "Not installed" },
      ],
    },
    { id: "lmstudio", name: "LM", emoji: "L", models: [] },
  ];
  return {
    getAllProviders: () => defs,
    getProviderDefinition: (id: string) => defs.find((d) => d.id === id),
  };
});
import { modelCommand, fetchLocalModels } from "./model.js";
function session(type = "anthropic", model = "claude-sonnet-4-6") {
  return { config: { provider: { type, model, thinking: "high" } } } as ReplSession;
}
describe("model selection behavior", () => {
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
    vi.stubGlobal("fetch", io.fetch);
    input = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
    });
    vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function keys(...values: string[]) {
    await Promise.resolve();
    await Promise.resolve();
    for (const value of values) input.emit("data", Buffer.from(value));
  }
  it("refuses cross-provider model and preserves current configuration", async () => {
    const current = session();
    await modelCommand.execute(["gpt-5.2"], current);
    expect(current.config.provider.model).toBe("claude-sonnet-4-6");
    expect(io.save).not.toHaveBeenCalled();
  });
  it("supports custom model without pretending failed persistence succeeded", async () => {
    const current = session();
    io.save.mockRejectedValue(new Error("disk unavailable"));
    await modelCommand.execute(["private-finetune"], current);
    expect(current.config.provider.model).toBe("private-finetune");
    expect(current.config.provider.thinking).toBeUndefined();
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("session only");
  });
  it("does not write preferences when current model is requested", async () => {
    const current = session();
    await modelCommand.execute([current.config.provider.model], current);
    expect(io.save).not.toHaveBeenCalled();
  });
  it("reconciles budget thinking when a model supports effort only", async () => {
    const current = session("openai", "custom");
    current.config.provider.thinking = { budget: 8000 };
    await modelCommand.execute(["gpt-5.2"], current);
    expect(current.config.provider.thinking).not.toEqual({ budget: 8000 });
    expect(io.save).toHaveBeenCalledWith("openai", "gpt-5.2");
  });
  it.each(["\x1b", "\x03"])(
    "interactive cancel %j preserves model and removes listener",
    async (key) => {
      const current = session();
      const pending = modelCommand.execute([], current);
      await keys(key);
      await pending;
      expect(current.config.provider.model).toBe("claude-sonnet-4-6");
      expect(io.save).not.toHaveBeenCalled();
      expect(input.listenerCount("data")).toBe(0);
    },
  );
  it("interactive model change retains explicitly selected off thinking", async () => {
    const current = session();
    const pending = modelCommand.execute([], current);
    await keys("\x1b[B", "\r");
    // Wait for persisted model before the thinking selector subscribes.
    for (let i = 0; i < 10 && input.listenerCount("data") === 0; i++) await Promise.resolve();
    await keys("\x1b[B", "\r");
    await pending;
    expect(current.config.provider.model).toBe("claude-opus-4-6");
    expect(current.config.provider.thinking).toBe("off");
    expect(io.saveThinking).toHaveBeenCalledWith("anthropic", "off");
    expect(input.listenerCount("data")).toBe(0);
  });
  it("local downloaded models are selectable while missing recommended models remain disabled", async () => {
    io.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qwen3.5:4b" }, { id: "custom-local" }] }),
    });
    const current = session("ollama", "custom-local");
    const pending = modelCommand.execute([], current);
    for (let i = 0; i < 12 && input.listenerCount("data") === 0; i++) await Promise.resolve();
    await keys("\x1b[B", "\x1b[A", "\r");
    await pending;
    expect(current.config.provider.model).toBe("custom-local");
    expect(io.save).not.toHaveBeenCalled();
    expect(vi.mocked(process.stdout.write).mock.calls.flat().join("\n")).toContain(
      "not downloaded",
    );
  });
  it("local server failures and empty catalog return without changing session", async () => {
    io.fetch.mockRejectedValue(new Error("offline"));
    expect(await fetchLocalModels("ollama")).toEqual([]);
    const current = session("lmstudio", "current");
    await modelCommand.execute([], current);
    expect(current.config.provider.model).toBe("current");
    expect(io.save).not.toHaveBeenCalled();
  });
  it("rejects non-OK local response without treating error payload as a model", async () => {
    io.fetch.mockResolvedValue({ ok: false });
    expect(await fetchLocalModels("ollama")).toEqual([]);
  });
});
