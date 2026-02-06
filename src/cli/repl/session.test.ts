/**
 * Tests for REPL session management
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock crypto
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn().mockReturnValue("test-uuid-1234"),
}));

// Mock env config
vi.mock("../../config/env.js", () => ({
  getDefaultProvider: vi.fn().mockReturnValue("anthropic"),
  getDefaultModel: vi.fn().mockReturnValue("claude-opus-4-6-20260115"),
  getLastUsedProvider: vi.fn().mockReturnValue("anthropic"),
  getLastUsedModel: vi.fn().mockReturnValue(undefined),
}));

describe("createDefaultReplConfig", () => {
  it("should create config with provider settings", async () => {
    const { createDefaultReplConfig } = await import("./session.js");

    const config = createDefaultReplConfig();

    expect(config.provider.type).toBe("anthropic");
    expect(config.provider.model).toBe("claude-opus-4-6-20260115");
    expect(config.provider.maxTokens).toBe(8192);
  });

  it("should create config with UI settings", async () => {
    const { createDefaultReplConfig } = await import("./session.js");

    const config = createDefaultReplConfig();

    expect(config.ui.theme).toBe("auto");
    expect(config.ui.showTimestamps).toBe(false);
    expect(config.ui.maxHistorySize).toBe(100);
  });

  it("should create config with agent settings", async () => {
    const { createDefaultReplConfig } = await import("./session.js");

    const config = createDefaultReplConfig();

    expect(config.agent.systemPrompt).toContain("Corbat-Coco");
    expect(config.agent.maxToolIterations).toBe(25);
    expect(config.agent.confirmDestructive).toBe(true);
  });
});

describe("createSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create session with unique ID", async () => {
    const { createSession } = await import("./session.js");

    const session = createSession("/project");

    expect(session.id).toBe("test-uuid-1234");
  });

  it("should create session with start timestamp", async () => {
    const { createSession } = await import("./session.js");

    const before = new Date();
    const session = createSession("/project");
    const after = new Date();

    expect(session.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(session.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("should create session with empty messages", async () => {
    const { createSession } = await import("./session.js");

    const session = createSession("/project");

    expect(session.messages).toEqual([]);
  });

  it("should set project path", async () => {
    const { createSession } = await import("./session.js");

    const session = createSession("/my/project");

    expect(session.projectPath).toBe("/my/project");
  });

  it("should create session with default config", async () => {
    const { createSession } = await import("./session.js");

    const session = createSession("/project");

    expect(session.config.provider.type).toBe("anthropic");
    expect(session.config.ui.theme).toBe("auto");
    expect(session.config.agent.maxToolIterations).toBe(25);
  });

  it("should merge custom config", async () => {
    const { createSession } = await import("./session.js");

    const session = createSession("/project", {
      provider: { maxTokens: 4096 },
      ui: { showTimestamps: true },
    });

    expect(session.config.provider.maxTokens).toBe(4096);
    expect(session.config.provider.type).toBe("anthropic"); // default preserved
    expect(session.config.ui.showTimestamps).toBe(true);
    expect(session.config.ui.theme).toBe("auto"); // default preserved
  });

  it("should initialize empty trusted tools set", async () => {
    const { createSession } = await import("./session.js");

    const session = createSession("/project");

    expect(session.trustedTools).toBeInstanceOf(Set);
    expect(session.trustedTools.size).toBe(0);
  });
});

describe("addMessage", () => {
  it("should add message to session", async () => {
    const { createSession, addMessage } = await import("./session.js");

    const session = createSession("/project");
    addMessage(session, { role: "user", content: "Hello" });

    expect(session.messages.length).toBe(1);
    expect(session.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("should add multiple messages", async () => {
    const { createSession, addMessage } = await import("./session.js");

    const session = createSession("/project");
    addMessage(session, { role: "user", content: "Hello" });
    addMessage(session, { role: "assistant", content: "Hi there!" });
    addMessage(session, { role: "user", content: "How are you?" });

    expect(session.messages.length).toBe(3);
  });

  it("should trim history when exceeding max", async () => {
    const { createSession, addMessage } = await import("./session.js");

    const session = createSession("/project", {
      ui: { maxHistorySize: 5 },
    });

    // Add 11 messages (exceeds 5 * 2 = 10 threshold)
    // Should trim to last 5 messages
    for (let i = 0; i < 11; i++) {
      addMessage(session, { role: "user", content: `Message ${i}` });
    }

    expect(session.messages.length).toBe(5);
    expect(session.messages[0]?.content).toBe("Message 6");
    expect(session.messages[4]?.content).toBe("Message 10");
  });
});

describe("getConversationContext", () => {
  it("should include system prompt", async () => {
    const { createSession, getConversationContext } = await import("./session.js");

    const session = createSession("/project");
    const context = getConversationContext(session);

    expect(context[0]?.role).toBe("system");
    expect(context[0]?.content).toContain("Corbat-Coco");
  });

  it("should include all messages", async () => {
    const { createSession, addMessage, getConversationContext } = await import("./session.js");

    const session = createSession("/project");
    addMessage(session, { role: "user", content: "Hello" });
    addMessage(session, { role: "assistant", content: "Hi!" });

    const context = getConversationContext(session);

    expect(context.length).toBe(3); // system + 2 messages
    expect(context[1]).toEqual({ role: "user", content: "Hello" });
    expect(context[2]).toEqual({ role: "assistant", content: "Hi!" });
  });
});

describe("clearSession", () => {
  it("should clear all messages", async () => {
    const { createSession, addMessage, clearSession } = await import("./session.js");

    const session = createSession("/project");
    addMessage(session, { role: "user", content: "Hello" });
    addMessage(session, { role: "assistant", content: "Hi!" });

    expect(session.messages.length).toBe(2);

    clearSession(session);

    expect(session.messages.length).toBe(0);
    expect(session.messages).toEqual([]);
  });

  it("should not affect other session properties", async () => {
    const { createSession, clearSession } = await import("./session.js");

    const session = createSession("/project");
    session.trustedTools.add("bash_exec");

    clearSession(session);

    expect(session.id).toBe("test-uuid-1234");
    expect(session.projectPath).toBe("/project");
    expect(session.trustedTools.has("bash_exec")).toBe(true);
  });
});
