import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  confirm: vi.fn(),
  isCancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

import { planCommand, PLAN_MODE_SYSTEM_PROMPT } from "./plan.js";
import type { ReplSession } from "../types.js";

function createMockSession(overrides?: Partial<ReplSession>): ReplSession {
  return {
    id: "test-session",
    startedAt: new Date(),
    messages: [],
    projectPath: "/test/project",
    config: {
      provider: { type: "openai" as any, model: "gpt-4", maxTokens: 4096 },
      ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100 },
      agent: { systemPrompt: "test", maxToolIterations: 10, confirmDestructive: true },
    },
    trustedTools: new Set(),
    planMode: false,
    pendingPlan: null,
    ...overrides,
  };
}

describe("plan command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have correct metadata", () => {
    expect(planCommand.name).toBe("plan");
    expect(planCommand.aliases).toContain("p");
  });

  describe("/plan (toggle)", () => {
    it("should activate plan mode when off", async () => {
      const session = createMockSession({ planMode: false });

      await planCommand.execute([], session);

      expect(session.planMode).toBe(true);
      expect(session.pendingPlan).toBeNull();
    });

    it("should deactivate plan mode when on", async () => {
      const session = createMockSession({ planMode: true });

      await planCommand.execute([], session);

      expect(session.planMode).toBe(false);
    });
  });

  describe("/plan <instruction>", () => {
    it("should activate plan mode and inject planning message", async () => {
      const session = createMockSession();

      await planCommand.execute(["add", "user", "authentication"], session);

      expect(session.planMode).toBe(true);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]?.role).toBe("user");
      expect(session.messages[0]?.content).toContain("add user authentication");
      expect(session.messages[0]?.content).toContain("[PLAN MODE]");
    });
  });

  describe("/plan status", () => {
    it("should report plan mode active", async () => {
      const session = createMockSession({ planMode: true });

      const result = await planCommand.execute(["status"], session);

      expect(result).toBe(false);
    });

    it("should report plan mode inactive", async () => {
      const session = createMockSession({ planMode: false });

      const result = await planCommand.execute(["status"], session);

      expect(result).toBe(false);
    });
  });

  describe("/plan approve", () => {
    it("should approve pending plan and inject execution message", async () => {
      const session = createMockSession({
        planMode: true,
        pendingPlan: "1. Create auth module\n2. Add tests",
      });

      await planCommand.execute(["approve"], session);

      expect(session.planMode).toBe(false);
      expect(session.pendingPlan).toBeNull();
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]?.content).toContain("Execute the following approved plan");
      expect(session.messages[0]?.content).toContain("Create auth module");
    });

    it("should warn when no pending plan", async () => {
      const session = createMockSession({ planMode: true, pendingPlan: null });

      await planCommand.execute(["approve"], session);

      expect(session.messages).toHaveLength(0); // no message injected
    });
  });

  describe("/plan reject", () => {
    it("should reject pending plan and deactivate plan mode", async () => {
      const session = createMockSession({
        planMode: true,
        pendingPlan: "some plan",
      });

      await planCommand.execute(["reject"], session);

      expect(session.planMode).toBe(false);
      expect(session.pendingPlan).toBeNull();
    });
  });

  describe("PLAN_MODE_SYSTEM_PROMPT", () => {
    it("should be a non-empty string with plan mode instructions", () => {
      expect(PLAN_MODE_SYSTEM_PROMPT).toBeTruthy();
      expect(PLAN_MODE_SYSTEM_PROMPT).toContain("PLAN MODE");
      expect(PLAN_MODE_SYSTEM_PROMPT).toContain("read-only");
    });
  });
});
