import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplSession } from "../types.js";
const mocks = vi.hoisted(() => ({ runSprints: vi.fn(), error: vi.fn() }));
vi.mock("../../../swarm/sprint-runner.js", () => ({ runSprints: mocks.runSprints }));
vi.mock("../../../swarm/spec-agent.js", () => ({
  runSpecInterview: vi
    .fn()
    .mockResolvedValue({ projectName: "fixture", sprints: [], qualityThreshold: 85 }),
  UserCancelledError: class extends Error {},
}));
vi.mock("../../../providers/index.js", () => ({ createProvider: vi.fn().mockResolvedValue({}) }));
vi.mock("../full-power-risk-mode.js", () => ({ isFullPowerRiskMode: () => false }));
vi.mock("@clack/prompts", () => ({ log: { error: mocks.error } }));
import { buildAppCommand } from "./build-app.js";
const session = {
  projectPath: "/fixture",
  config: { provider: { type: "openai", model: "fixture", maxTokens: 1 } },
} as ReplSession;
const result = {
  success: true,
  outputPath: "/fixture/output",
  finalQualityScore: 90,
  sprintResults: [],
  totalDurationMs: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("build-app sprint signal ownership", () => {
  it.each(["success", "failure", "SIGINT", "SIGTERM"])(
    "releases only its own listeners on %s",
    async (ending) => {
      const beforeInt = process.listeners("SIGINT");
      const beforeTerm = process.listeners("SIGTERM");
      let signal!: AbortSignal;
      mocks.runSprints.mockImplementation(async (options) => {
        signal = options.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        if (ending === "failure") throw new Error("fixture failure");
        if (ending === "SIGINT" || ending === "SIGTERM") {
          const before = ending === "SIGINT" ? beforeInt : beforeTerm;
          const listener = process.listeners(ending).find((fn) => !before.includes(fn));
          expect(listener).toBeDefined();
          listener!();
        }
        return result;
      });
      await buildAppCommand.execute(["fixture", "--yes"], session);
      expect(process.listeners("SIGINT")).toEqual(beforeInt);
      expect(process.listeners("SIGTERM")).toEqual(beforeTerm);
      if (ending === "SIGINT" || ending === "SIGTERM") {
        expect(signal.aborted).toBe(true);
        expect(
          vi
            .mocked(console.log)
            .mock.calls.flat()
            .some((line) => String(line).includes("Build complete!")),
        ).toBe(false);
      }
      expect(mocks.error).toHaveBeenCalledTimes(ending === "success" ? 0 : 1);
    },
  );
});
