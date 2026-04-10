import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplSession } from "../types.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("chalk", () => ({
  default: {
    cyan: (value: string) => value,
  },
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    access: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../../config/loader.js", () => ({
  findAllConfigPaths: vi.fn().mockResolvedValue({ project: "/test/project/.coco/config.json" }),
  loadConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../tools/index.js", () => ({
  createFullToolRegistry: vi.fn(() => ({
    getToolDefinitionsForLLM: () => [{ name: "read_file" }, { name: "grep" }],
  })),
}));

vi.mock("../hooks/index.js", () => ({
  createHookRegistry: vi.fn(() => ({
    size: 2,
    loadFromFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../../auth/index.js", () => ({
  isADCConfigured: vi.fn().mockResolvedValue(false),
  isOAuthConfigured: vi.fn().mockResolvedValue(false),
}));

function createSession(agentOverrides?: Partial<ReplSession["config"]["agent"]>): ReplSession {
  return {
    id: "doctor-session",
    startedAt: new Date(),
    messages: [],
    projectPath: "/test/project",
    config: {
      provider: { type: "anthropic" as any, model: "claude-sonnet-4-6", maxTokens: 8192 },
      ui: { theme: "auto", showTimestamps: false, maxHistorySize: 100, showDiff: "on_request" },
      agent: {
        systemPrompt: "test",
        maxToolIterations: 10,
        confirmDestructive: true,
        doctorV2: true,
        ...agentOverrides,
      },
    },
    trustedTools: new Set<string>(),
  };
}

describe("doctorCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("returns a warning check when provider auth is missing", async () => {
    const { runDoctorChecks } = await import("./doctor.js");

    const checks = await runDoctorChecks(createSession());
    const auth = checks.find((check) => check.name === "Provider auth");

    expect(auth?.status).toBe("warn");
    expect(auth?.detail).toContain("ANTHROPIC_API_KEY");
  });

  it("passes provider auth when the expected env var is present", async () => {
    const { runDoctorChecks } = await import("./doctor.js");
    process.env["ANTHROPIC_API_KEY"] = "test-key";

    const checks = await runDoctorChecks(createSession());
    const auth = checks.find((check) => check.name === "Provider auth");

    expect(auth?.status).toBe("pass");
  });

  it("short-circuits when doctorV2 is disabled", async () => {
    const prompts = await import("@clack/prompts");
    const { doctorCommand } = await import("./doctor.js");

    const result = await doctorCommand.execute([], createSession({ doctorV2: false }));

    expect(result).toBe(false);
    expect(prompts.log.warn).toHaveBeenCalled();
  });
});
