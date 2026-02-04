/**
 * Skills System Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createDefaultRegistry,
  createSkillRegistry,
  clearSkill,
  statusSkill,
  compactSkill,
  createHelpSkill,
  SkillRegistry,
} from "./index.js";
import type { Skill, SkillContext, SkillResult } from "./types.js";

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = createSkillRegistry();
  });

  describe("register", () => {
    it("should register a skill", () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        execute: async () => ({ success: true }),
      };

      registry.register(skill);
      expect(registry.has("test")).toBe(true);
      expect(registry.get("test")).toBe(skill);
    });

    it("should register aliases", () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        aliases: ["t", "tst"],
        execute: async () => ({ success: true }),
      };

      registry.register(skill);
      expect(registry.has("t")).toBe(true);
      expect(registry.has("tst")).toBe(true);
      expect(registry.get("t")).toBe(skill);
      expect(registry.get("tst")).toBe(skill);
    });

    it("should throw on duplicate skill name", () => {
      const skill1: Skill = {
        name: "test",
        description: "Test skill 1",
        execute: async () => ({ success: true }),
      };
      const skill2: Skill = {
        name: "test",
        description: "Test skill 2",
        execute: async () => ({ success: true }),
      };

      registry.register(skill1);
      expect(() => registry.register(skill2)).toThrow(
        "Skill 'test' is already registered"
      );
    });

    it("should throw on alias conflict with skill name", () => {
      const skill1: Skill = {
        name: "test",
        description: "Test skill 1",
        execute: async () => ({ success: true }),
      };
      const skill2: Skill = {
        name: "other",
        description: "Test skill 2",
        aliases: ["test"],
        execute: async () => ({ success: true }),
      };

      registry.register(skill1);
      expect(() => registry.register(skill2)).toThrow(
        "Alias 'test' for skill 'other' conflicts with existing skill"
      );
    });
  });

  describe("unregister", () => {
    it("should unregister a skill and its aliases", () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        aliases: ["t"],
        execute: async () => ({ success: true }),
      };

      registry.register(skill);
      expect(registry.unregister("test")).toBe(true);
      expect(registry.has("test")).toBe(false);
      expect(registry.has("t")).toBe(false);
    });

    it("should return false for non-existent skill", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all registered skills", () => {
      const skill1: Skill = {
        name: "test1",
        description: "Test skill 1",
        execute: async () => ({ success: true }),
      };
      const skill2: Skill = {
        name: "test2",
        description: "Test skill 2",
        execute: async () => ({ success: true }),
      };

      registry.register(skill1);
      registry.register(skill2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(skill1);
      expect(all).toContain(skill2);
    });
  });

  describe("execute", () => {
    it("should execute a skill by name", async () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        execute: async () => ({ success: true, output: "executed" }),
      };

      registry.register(skill);

      const context = createMockContext();
      const result = await registry.execute("test", "", context);

      expect(result.success).toBe(true);
      expect(result.output).toBe("executed");
    });

    it("should execute a skill by alias", async () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        aliases: ["t"],
        execute: async () => ({ success: true, output: "executed" }),
      };

      registry.register(skill);

      const context = createMockContext();
      const result = await registry.execute("t", "", context);

      expect(result.success).toBe(true);
      expect(result.output).toBe("executed");
    });

    it("should return error for unknown skill", async () => {
      const context = createMockContext();
      const result = await registry.execute("unknown", "", context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown command");
    });

    it("should catch and return execution errors", async () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        execute: async () => {
          throw new Error("Test error");
        },
      };

      registry.register(skill);

      const context = createMockContext();
      const result = await registry.execute("test", "", context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Test error");
    });
  });

  describe("resolveAlias", () => {
    it("should resolve alias to primary name", () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        aliases: ["t"],
        execute: async () => ({ success: true }),
      };

      registry.register(skill);
      expect(registry.resolveAlias("t")).toBe("test");
    });

    it("should return primary name for primary name", () => {
      const skill: Skill = {
        name: "test",
        description: "Test skill",
        execute: async () => ({ success: true }),
      };

      registry.register(skill);
      expect(registry.resolveAlias("test")).toBe("test");
    });

    it("should return undefined for unknown name", () => {
      expect(registry.resolveAlias("unknown")).toBeUndefined();
    });
  });

  describe("getByCategory", () => {
    it("should group skills by category", () => {
      const skill1: Skill = {
        name: "test1",
        description: "Test skill 1",
        category: "general",
        execute: async () => ({ success: true }),
      };
      const skill2: Skill = {
        name: "test2",
        description: "Test skill 2",
        category: "git",
        execute: async () => ({ success: true }),
      };

      registry.register(skill1);
      registry.register(skill2);

      const byCategory = registry.getByCategory();
      expect(byCategory.get("general")).toContain(skill1);
      expect(byCategory.get("git")).toContain(skill2);
    });
  });
});

describe("createDefaultRegistry", () => {
  it("should create registry with builtin skills", () => {
    const registry = createDefaultRegistry();

    expect(registry.has("help")).toBe(true);
    expect(registry.has("h")).toBe(true);
    expect(registry.has("?")).toBe(true);
    expect(registry.has("clear")).toBe(true);
    expect(registry.has("c")).toBe(true);
    expect(registry.has("status")).toBe(true);
    expect(registry.has("s")).toBe(true);
    expect(registry.has("compact")).toBe(true);
  });
});

describe("builtin skills", () => {
  describe("clearSkill", () => {
    it("should have correct metadata", () => {
      expect(clearSkill.name).toBe("clear");
      expect(clearSkill.aliases).toContain("c");
      expect(clearSkill.category).toBe("general");
    });
  });

  describe("statusSkill", () => {
    it("should have correct metadata", () => {
      expect(statusSkill.name).toBe("status");
      expect(statusSkill.aliases).toContain("s");
      expect(statusSkill.category).toBe("general");
    });
  });

  describe("compactSkill", () => {
    it("should have correct metadata", () => {
      expect(compactSkill.name).toBe("compact");
      expect(compactSkill.category).toBe("model");
    });
  });

  describe("createHelpSkill", () => {
    it("should create a help skill with registry reference", () => {
      const registry = createSkillRegistry();
      const helpSkill = createHelpSkill(registry);

      expect(helpSkill.name).toBe("help");
      expect(helpSkill.aliases).toContain("h");
      expect(helpSkill.aliases).toContain("?");
      expect(helpSkill.category).toBe("general");
    });
  });
});

/**
 * Create a mock SkillContext for testing
 */
function createMockContext(): SkillContext {
  return {
    cwd: "/test/path",
    session: {
      id: "test-session",
      startedAt: new Date(),
      messages: [],
      projectPath: "/test/path",
      config: {
        provider: {
          type: "anthropic",
          model: "claude-3-sonnet-20240229",
          maxTokens: 4096,
        },
        ui: {
          theme: "dark",
          showTimestamps: false,
          maxHistorySize: 100,
        },
        agent: {
          systemPrompt: "test prompt",
          maxToolIterations: 10,
          confirmDestructive: true,
        },
      },
      trustedTools: new Set<string>(),
    },
    config: {
      provider: {
        type: "anthropic",
        model: "claude-3-sonnet-20240229",
        maxTokens: 4096,
      },
      ui: {
        theme: "dark",
        showTimestamps: false,
        maxHistorySize: 100,
      },
      agent: {
        systemPrompt: "test prompt",
        maxToolIterations: 10,
        confirmDestructive: true,
      },
    },
  };
}
