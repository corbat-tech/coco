import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
const io = vi.hoisted(() => ({
  program: null as Command | null,
  onboard: vi.fn(),
  save: vi.fn(),
  start: vi.fn(),
}));
vi.mock("commander", async (original) => {
  const actual = await original<typeof import("commander")>();
  return {
    ...actual,
    Command: class extends actual.Command {
      override async parseAsync(): Promise<this> {
        io.program = this;
        return this;
      }
    },
  };
});
vi.mock("../utils/proxy.js", () => ({ installProxyDispatcher: vi.fn() }));
vi.mock("./repl/index.js", () => ({ startRepl: io.start }));
vi.mock("./repl/onboarding-v2.js", () => ({
  runOnboardingV2: io.onboard,
  saveConfiguration: io.save,
}));
vi.mock("./deferred-update.js", () => ({
  runWithDeferredUpdateNotice: (fn: () => unknown) => fn(),
}));

describe("CLI setup cancellation contract", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    io.onboard.mockResolvedValue({ type: "ollama", model: "qwen3:8b", apiKey: "local" });
    io.save.mockResolvedValue(false);
    await import("./index.js");
  });
  afterEach(() => vi.restoreAllMocks());
  async function run(args: string[]) {
    const actual = await vi.importActual<typeof import("commander")>("commander");
    await actual.Command.prototype.parseAsync.call(io.program, ["node", "coco", ...args]);
  }
  it.each([["setup"], ["chat", "--setup"]])(
    "cancelled storage for %j neither claims success nor starts a session",
    async (...args) => {
      await run(args);
      expect(io.save).toHaveBeenCalledTimes(1);
      expect(io.start).not.toHaveBeenCalled();
      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).toContain("Setup cancelled");
      expect(output).not.toContain("Configuration saved");
    },
  );
  it("standalone setup reports success only after successful save", async () => {
    io.save.mockResolvedValue(true);
    await run(["setup"]);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("Configuration saved");
    expect(io.start).not.toHaveBeenCalled();
  });
  it("initial cancellation never attempts to save", async () => {
    io.onboard.mockResolvedValue(null);
    await run(["setup"]);
    expect(io.save).not.toHaveBeenCalled();
  });
});
