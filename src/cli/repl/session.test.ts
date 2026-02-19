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

describe("generateToolCatalog", () => {
  it("should generate catalog from registry grouped by category", async () => {
    const { generateToolCatalog } = await import("./session.js");

    // Create a minimal mock registry
    const mockRegistry = {
      getAll: () => [
        { name: "read_file", description: "Read a file from disk.", category: "file" },
        { name: "write_file", description: "Write content to a file.", category: "file" },
        { name: "bash_exec", description: "Execute a shell command.", category: "bash" },
        { name: "web_search", description: "Search the web for information.", category: "web" },
      ],
    };

    const catalog = generateToolCatalog(mockRegistry as any);

    expect(catalog).toContain("### File Operations");
    expect(catalog).toContain("### Shell Commands");
    expect(catalog).toContain("### Web (Search & Fetch)");
    expect(catalog).toContain("**read_file**");
    expect(catalog).toContain("**write_file**");
    expect(catalog).toContain("**bash_exec**");
    expect(catalog).toContain("**web_search**");
  });

  it("should use first sentence of description", async () => {
    const { generateToolCatalog } = await import("./session.js");

    const mockRegistry = {
      getAll: () => [
        {
          name: "test_tool",
          description: "Short description. More details here. Even more.",
          category: "file",
        },
      ],
    };

    const catalog = generateToolCatalog(mockRegistry as any);

    expect(catalog).toContain("Short description");
    expect(catalog).not.toContain("More details here");
  });

  it("should handle unknown categories gracefully", async () => {
    const { generateToolCatalog } = await import("./session.js");

    const mockRegistry = {
      getAll: () => [{ name: "custom_tool", description: "A custom tool.", category: "unknown" }],
    };

    const catalog = generateToolCatalog(mockRegistry as any);

    // Falls back to raw category name
    expect(catalog).toContain("### unknown");
    expect(catalog).toContain("**custom_tool**");
  });

  it("should return empty string for empty registry", async () => {
    const { generateToolCatalog } = await import("./session.js");

    const mockRegistry = { getAll: () => [] };
    const catalog = generateToolCatalog(mockRegistry as any);

    expect(catalog).toBe("");
  });
});

describe("getConversationContext with toolRegistry", () => {
  it("should inject tool catalog when registry is provided", async () => {
    const { createSession, getConversationContext } = await import("./session.js");

    const session = createSession("/project");

    const mockRegistry = {
      getAll: () => [
        { name: "web_search", description: "Search the web.", category: "web" },
        { name: "read_file", description: "Read a file.", category: "file" },
      ],
    };

    const context = getConversationContext(session, mockRegistry as any);

    // System prompt should contain the injected tool catalog
    expect(context[0]?.content).toContain("**web_search**");
    expect(context[0]?.content).toContain("**read_file**");
    expect(context[0]?.content).toContain("Web (Search & Fetch)");
    expect(context[0]?.content).toContain("File Operations");
    // The placeholder should be replaced
    expect(context[0]?.content).not.toContain("{TOOL_CATALOG}");
  });

  it("should work without registry (backward compatible)", async () => {
    const { createSession, getConversationContext } = await import("./session.js");

    const session = createSession("/project");
    const context = getConversationContext(session);

    // Should still have system prompt with placeholder unreplaced
    expect(context[0]?.role).toBe("system");
    expect(context[0]?.content).toContain("Corbat-Coco");
  });
});

// ============================================================================
// executeSafeCommand — security tests for $(!command) substitution
// ============================================================================

describe("executeSafeCommand — security", () => {
  const cwd = process.cwd();

  // Safe commands that SHOULD execute
  it("should execute pwd", async () => {
    const { executeSafeCommand } = await import("./session.js");
    const result = executeSafeCommand("pwd", cwd);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("should execute git status", async () => {
    const { executeSafeCommand } = await import("./session.js");
    const result = executeSafeCommand("git status", cwd);
    expect(result).not.toBeNull();
  });

  it("should execute git branch", async () => {
    const { executeSafeCommand } = await import("./session.js");
    const result = executeSafeCommand("git branch", cwd);
    expect(result).not.toBeNull();
  });

  it("should execute echo", async () => {
    const { executeSafeCommand } = await import("./session.js");
    const result = executeSafeCommand("echo hello", cwd);
    expect(result).toBe("hello");
  });

  it("should execute date", async () => {
    const { executeSafeCommand } = await import("./session.js");
    const result = executeSafeCommand("date", cwd);
    expect(result).not.toBeNull();
  });

  it("should execute ls", async () => {
    const { executeSafeCommand } = await import("./session.js");
    const result = executeSafeCommand("ls", cwd);
    expect(result).not.toBeNull();
  });

  // Command injection attempts — MUST be rejected (return null)
  it("should reject semicolons (command chaining)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git status; rm -rf /", cwd)).toBeNull();
  });

  it("should reject && (command chaining)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git status && rm -rf /", cwd)).toBeNull();
  });

  it("should reject || (command chaining)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git status || rm -rf /", cwd)).toBeNull();
  });

  it("should reject pipe (|)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git log | head", cwd)).toBeNull();
  });

  it("should reject backticks", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("echo `whoami`", cwd)).toBeNull();
  });

  it("should reject $() subshell", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("echo $(whoami)", cwd)).toBeNull();
  });

  it("should reject redirect >", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("echo malicious > /etc/passwd", cwd)).toBeNull();
  });

  it("should reject redirect <", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("cat < /etc/passwd", cwd)).toBeNull();
  });

  it("should reject curly braces", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("{ echo a; echo b; }", cwd)).toBeNull();
  });

  it("should reject parentheses", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("(echo a)", cwd)).toBeNull();
  });

  it("should reject newlines", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git status\nrm -rf /", cwd)).toBeNull();
  });

  it("should reject backslash escapes", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git stat\\us", cwd)).toBeNull();
  });

  // Non-allowlisted commands
  it("should reject rm (not in allowlist)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("rm -rf /tmp/test", cwd)).toBeNull();
  });

  it("should reject curl (not in allowlist)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("curl https://evil.com", cwd)).toBeNull();
  });

  it("should reject git push (unsafe subcommand)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git push origin main", cwd)).toBeNull();
  });

  it("should reject git reset (unsafe subcommand)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git reset --hard", cwd)).toBeNull();
  });

  it("should reject git checkout (unsafe subcommand)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("git checkout -- .", cwd)).toBeNull();
  });

  it("should reject node without -e or -p", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("node evil.js", cwd)).toBeNull();
  });

  it("should reject node -e entirely (removed from allowlist for security)", async () => {
    const { executeSafeCommand } = await import("./session.js");
    // node -e allows arbitrary code execution, e.g.:
    // node -e "require('child_process').execSync('rm -rf /')"
    // Therefore node is NOT in the safe commands allowlist
    expect(executeSafeCommand("node -e console.log(1)", cwd)).toBeNull();
    expect(executeSafeCommand("node -p 1+1", cwd)).toBeNull();
  });

  // Edge cases
  it("should reject empty commands", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("", cwd)).toBeNull();
  });

  it("should reject whitespace-only commands", async () => {
    const { executeSafeCommand } = await import("./session.js");
    expect(executeSafeCommand("   ", cwd)).toBeNull();
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
