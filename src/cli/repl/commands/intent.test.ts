/**
 * Tests for /intent command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("chalk", () => {
  const id = (s: string) => s;
  const chained = Object.assign(id, {
    dim: id,
    green: id,
    red: id,
    bold: id,
    yellow: id,
    cyan: id,
  });
  return { default: chained };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { intentCommand, isIntentRecognitionEnabled } from "./intent.js";
import type { ReplSession } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSession = {
  id: "test-session",
  startedAt: new Date(),
  messages: [],
  projectPath: "/test/project",
  config: {
    provider: { type: "anthropic", model: "claude-sonnet-4-20250514", maxTokens: 8192 },
    ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
    agent: { systemPrompt: "test", maxToolIterations: 25, confirmDestructive: true },
  },
  trustedTools: new Set(),
} as unknown as ReplSession;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  // Reset intent recognition to default (on) before each test
  await intentCommand.execute(["on"], mockSession);
  consoleLogSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe("intentCommand metadata", () => {
  it("has name 'intent'", () => {
    expect(intentCommand.name).toBe("intent");
  });

  it("has empty aliases array", () => {
    expect(intentCommand.aliases).toEqual([]);
  });

  it("has a description mentioning intent recognition", () => {
    expect(intentCommand.description.toLowerCase()).toContain("intent");
  });

  it("has a usage string", () => {
    expect(intentCommand.usage).toContain("/intent");
  });
});

// ---------------------------------------------------------------------------
// /intent (no args) — shows status
// ---------------------------------------------------------------------------

describe("/intent with no args", () => {
  it("shows status when no argument provided", async () => {
    await intentCommand.execute([], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Intent recognition");
  });

  it("shows 'on' when enabled (default)", async () => {
    await intentCommand.execute([], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("on");
  });

  it("returns false (never exits the REPL)", async () => {
    const result = await intentCommand.execute([], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /intent status
// ---------------------------------------------------------------------------

describe("/intent status", () => {
  it("shows status when 'status' argument provided", async () => {
    await intentCommand.execute(["status"], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Intent recognition");
  });

  it("shows 'on' when enabled", async () => {
    await intentCommand.execute(["status"], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("on");
  });

  it("shows 'off' after disabling", async () => {
    await intentCommand.execute(["off"], mockSession);
    consoleLogSpy.mockClear();

    await intentCommand.execute(["status"], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("off");
  });

  it("returns false", async () => {
    const result = await intentCommand.execute(["status"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /intent off
// ---------------------------------------------------------------------------

describe("/intent off", () => {
  it("disables intent recognition", async () => {
    await intentCommand.execute(["off"], mockSession);

    expect(isIntentRecognitionEnabled()).toBe(false);
  });

  it("logs a message about disabling", async () => {
    await intentCommand.execute(["off"], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput.toLowerCase()).toContain("disabled");
  });

  it("returns false", async () => {
    const result = await intentCommand.execute(["off"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /intent on
// ---------------------------------------------------------------------------

describe("/intent on", () => {
  it("enables intent recognition", async () => {
    // First disable
    await intentCommand.execute(["off"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(false);

    // Then enable
    await intentCommand.execute(["on"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(true);
  });

  it("logs a message about enabling", async () => {
    await intentCommand.execute(["on"], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput.toLowerCase()).toContain("enabled");
  });

  it("returns false", async () => {
    const result = await intentCommand.execute(["on"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown subcommand
// ---------------------------------------------------------------------------

describe("/intent unknown subcommand", () => {
  it("shows error for unrecognized argument", async () => {
    await intentCommand.execute(["foobar"], mockSession);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("foobar");
  });

  it("returns false", async () => {
    const result = await intentCommand.execute(["unknown"], mockSession);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isIntentRecognitionEnabled state after toggling
// ---------------------------------------------------------------------------

describe("isIntentRecognitionEnabled", () => {
  it("returns true by default", () => {
    expect(isIntentRecognitionEnabled()).toBe(true);
  });

  it("returns false after /intent off", async () => {
    await intentCommand.execute(["off"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(false);
  });

  it("returns true after /intent on", async () => {
    await intentCommand.execute(["off"], mockSession);
    await intentCommand.execute(["on"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(true);
  });

  it("reflects correct state after multiple toggles", async () => {
    await intentCommand.execute(["off"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(false);
    await intentCommand.execute(["on"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(true);
    await intentCommand.execute(["off"], mockSession);
    expect(isIntentRecognitionEnabled()).toBe(false);
  });
});
