import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { UnifiedSkillRegistry, createUnifiedSkillRegistry } from "./registry.js";
import type { SkillEvent } from "./registry.js";
import type { LegacySkill } from "./loader/typescript-loader.js";

const FIXTURES_DIR = join(process.cwd(), "test/fixtures/skills");

const mockBuiltins: LegacySkill[] = [
  {
    name: "help",
    description: "Show available commands",
    category: "general",
    execute: async () => ({ success: true, output: "Help text" }),
  },
  {
    name: "ship",
    description: "Ship changes: review, test, branch, version, commit, PR",
    aliases: ["release", "deploy"],
    category: "git",
    execute: async (_args) => ({ success: true, output: "Shipped!" }),
  },
];

describe("UnifiedSkillRegistry", () => {
  let registry: UnifiedSkillRegistry;

  beforeEach(async () => {
    registry = createUnifiedSkillRegistry();
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);
  });

  describe("discovery", () => {
    it("should discover builtin and global (fixture) skills", () => {
      expect(registry.size).toBe(4);
    });

    it("should have all expected skills", () => {
      expect(registry.has("help")).toBe(true);
      expect(registry.has("ship")).toBe(true);
      expect(registry.has("test-skill")).toBe(true);
      expect(registry.has("minimal-skill")).toBe(true);
    });
  });

  describe("metadata access", () => {
    it("should get metadata by ID", () => {
      const meta = registry.getMetadata("ship");
      expect(meta).toBeDefined();
      expect(meta?.name).toBe("ship");
      expect(meta?.kind).toBe("native");
    });

    it("should get metadata by alias", () => {
      const meta = registry.getMetadata("release");
      expect(meta).toBeDefined();
      expect(meta?.name).toBe("ship");
    });

    it("should return undefined for unknown skill", () => {
      const meta = registry.getMetadata("unknown");
      expect(meta).toBeUndefined();
    });

    it("should get all metadata", () => {
      const all = registry.getAllMetadata();
      expect(all.length).toBe(4);
    });

    it("should filter by category", () => {
      const gitSkills = registry.getByCategory("git");
      expect(gitSkills.length).toBe(1);
      expect(gitSkills[0].name).toBe("ship");
    });

    it("should filter by scope", () => {
      const builtins = registry.getByScope("builtin");
      expect(builtins.length).toBe(2);

      const globals = registry.getByScope("global");
      expect(globals.length).toBe(2);
    });
  });

  describe("content loading", () => {
    it("should load native skill content from cache", async () => {
      const loaded = await registry.loadSkill("ship");
      expect(loaded).not.toBeNull();
      expect("execute" in loaded!.content).toBe(true);
    });

    it("should load markdown skill content lazily", async () => {
      const loaded = await registry.loadSkill("test-skill");
      expect(loaded).not.toBeNull();
      expect("instructions" in loaded!.content).toBe(true);
    });

    it("should return null for unknown skill", async () => {
      const loaded = await registry.loadSkill("unknown");
      expect(loaded).toBeNull();
    });

    it("should cache loaded skills", async () => {
      const first = await registry.loadSkill("test-skill");
      const second = await registry.loadSkill("test-skill");
      expect(first).toBe(second);
    });
  });

  describe("activation", () => {
    it("should activate a markdown skill", async () => {
      const result = await registry.activateSkill("test-skill");
      expect(result).toBe(true);
      expect(registry.getActiveSkillIds()).toContain("test-skill");
    });

    it("should not activate a native skill", async () => {
      const result = await registry.activateSkill("ship");
      expect(result).toBe(false);
    });

    it("should deactivate a skill", async () => {
      await registry.activateSkill("test-skill");
      registry.deactivateSkill("test-skill");
      expect(registry.getActiveSkillIds()).not.toContain("test-skill");
    });

    it("should deactivate all skills", async () => {
      await registry.activateSkill("test-skill");
      await registry.activateSkill("minimal-skill");
      registry.deactivateAll();
      expect(registry.getActiveSkillIds()).toEqual([]);
    });

    it("should return active loaded skills", async () => {
      await registry.activateSkill("test-skill");
      const active = registry.getActiveSkills();
      expect(active.length).toBe(1);
      expect(active[0].metadata.id).toBe("test-skill");
    });
  });

  describe("execution", () => {
    it("should execute a native skill", async () => {
      const result = await registry.execute("ship", "", { cwd: "/test" });
      expect(result.success).toBe(true);
      expect(result.output).toBe("Shipped!");
    });

    it("should execute native skill via alias", async () => {
      const result = await registry.execute("release", "", { cwd: "/test" });
      expect(result.success).toBe(true);
    });

    it("should fork a markdown skill with context: fork", async () => {
      const result = await registry.execute("test-skill", "--verbose", { cwd: "/test" });
      expect(result.success).toBe(true);
      // test-skill has context: fork, so it returns instructions for subagent
      expect(result.shouldFork).toBe(true);
      expect(result.output).toContain("Test Skill");
      expect(result.output).toContain("--verbose"); // $ARGUMENTS substituted
    });

    it("should activate an inline markdown skill when executed", async () => {
      // minimal-skill has no context field (defaults to inline activation)
      const result = await registry.execute("minimal-skill", "", { cwd: "/test" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("activated");
      expect(registry.getActiveSkillIds()).toContain("minimal-skill");
    });

    it("should return error for unknown skill", async () => {
      const result = await registry.execute("unknown", "", { cwd: "/test" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown skill");
    });
  });

  describe("matching", () => {
    it("should find relevant skills for a query", () => {
      const matches = registry.findRelevantSkills("testing skill");
      expect(matches.length).toBeGreaterThan(0);
    });

    it("should return empty for unrelated query", () => {
      const matches = registry.findRelevantSkills("quantum physics spacetime", 3, 0.5);
      expect(matches).toEqual([]);
    });
  });
});

describe("createUnifiedSkillRegistry", () => {
  it("should create an empty registry", () => {
    const registry = createUnifiedSkillRegistry();
    expect(registry.size).toBe(0);
  });
});

describe("UnifiedSkillRegistry — config", () => {
  it("should skip discovery when enabled is false", async () => {
    const registry = createUnifiedSkillRegistry();
    registry.setConfig({ enabled: false });
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);
    expect(registry.size).toBe(0);
  });

  it("should filter disabled skills", async () => {
    const registry = createUnifiedSkillRegistry();
    registry.setConfig({ disabled: ["ship"] });
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    expect(registry.has("ship")).toBe(false);
    expect(registry.has("help")).toBe(true);
    expect(registry.has("test-skill")).toBe(true);
  });

  it("should enforce maxActiveSkills with FIFO eviction", async () => {
    const registry = createUnifiedSkillRegistry();
    registry.setConfig({ maxActiveSkills: 1 });
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    const ok1 = await registry.activateSkill("test-skill");
    expect(ok1).toBe(true);
    expect(registry.getActiveSkillIds()).toContain("test-skill");

    const ok2 = await registry.activateSkill("minimal-skill");
    expect(ok2).toBe(true);
    expect(registry.getActiveSkillIds()).toContain("minimal-skill");
    expect(registry.getActiveSkillIds()).not.toContain("test-skill");
    expect(registry.getActiveSkillIds().length).toBe(1);
  });

  it("should emit 'deactivated' event for FIFO-evicted skill", async () => {
    const registry = createUnifiedSkillRegistry();
    registry.setConfig({ maxActiveSkills: 1 });
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    await registry.activateSkill("test-skill");

    const events: SkillEvent[] = [];
    registry.on((e) => events.push(e));

    await registry.activateSkill("minimal-skill");

    // Should emit deactivated for test-skill (FIFO evicted) + activated for minimal-skill
    const deactivatedEvent = events.find((e) => e.type === "deactivated");
    expect(deactivatedEvent).toBeDefined();
    if (deactivatedEvent?.type === "deactivated") {
      expect(deactivatedEvent.skillId).toBe("test-skill");
    }

    const activatedEvent = events.find((e) => e.type === "activated");
    expect(activatedEvent).toBeDefined();
    if (activatedEvent?.type === "activated") {
      expect(activatedEvent.skillId).toBe("minimal-skill");
    }
  });

  it("should not evict if same skill is re-activated", async () => {
    const registry = createUnifiedSkillRegistry();
    registry.setConfig({ maxActiveSkills: 1 });
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    await registry.activateSkill("test-skill");
    await registry.activateSkill("test-skill");
    expect(registry.getActiveSkillIds()).toContain("test-skill");
    expect(registry.getActiveSkillIds().length).toBe(1);
  });

  it("should use default maxActiveSkills (3) when not configured", async () => {
    const registry = createUnifiedSkillRegistry();
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    const ok1 = await registry.activateSkill("test-skill");
    const ok2 = await registry.activateSkill("minimal-skill");
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(registry.getActiveSkillIds().length).toBe(2);
  });
});

// ============================================================================
// Lifecycle Events
// ============================================================================

describe("UnifiedSkillRegistry — lifecycle events", () => {
  let registry: UnifiedSkillRegistry;

  beforeEach(async () => {
    registry = createUnifiedSkillRegistry();
    await registry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);
  });

  it("should emit 'discovered' event during discoverAndRegister", async () => {
    const newRegistry = createUnifiedSkillRegistry();
    const events: SkillEvent[] = [];
    newRegistry.on((e) => events.push(e));

    await newRegistry.discoverAndRegister("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    const discoveredEvent = events.find((e) => e.type === "discovered");
    expect(discoveredEvent).toBeDefined();
    expect(discoveredEvent!.type).toBe("discovered");
    if (discoveredEvent!.type === "discovered") {
      expect(discoveredEvent!.count).toBeGreaterThan(0);
    }
  });

  it("should emit 'activated' event on activateSkill", async () => {
    const events: SkillEvent[] = [];
    registry.on((e) => events.push(e));

    await registry.activateSkill("test-skill");

    const activatedEvent = events.find((e) => e.type === "activated");
    expect(activatedEvent).toBeDefined();
    if (activatedEvent!.type === "activated") {
      expect(activatedEvent!.skillId).toBe("test-skill");
    }
  });

  it("should emit 'deactivated' event on deactivateSkill", async () => {
    await registry.activateSkill("test-skill");

    const events: SkillEvent[] = [];
    registry.on((e) => events.push(e));

    registry.deactivateSkill("test-skill");

    const deactivatedEvent = events.find((e) => e.type === "deactivated");
    expect(deactivatedEvent).toBeDefined();
    if (deactivatedEvent!.type === "deactivated") {
      expect(deactivatedEvent!.skillId).toBe("test-skill");
    }
  });

  it("should emit 'executed' event on execute", async () => {
    const events: SkillEvent[] = [];
    registry.on((e) => events.push(e));

    await registry.execute("ship", "", { cwd: "/test" });

    const executedEvent = events.find((e) => e.type === "executed");
    expect(executedEvent).toBeDefined();
    if (executedEvent!.type === "executed") {
      expect(executedEvent!.skillId).toBe("ship");
      expect(executedEvent!.success).toBe(true);
    }
  });

  it("should return unsubscribe function from on()", async () => {
    const events: SkillEvent[] = [];
    const unsubscribe = registry.on((e) => events.push(e));

    await registry.activateSkill("test-skill");
    expect(events.length).toBe(1);

    unsubscribe();

    await registry.activateSkill("minimal-skill");
    // Should still be 1 because we unsubscribed
    expect(events.length).toBe(1);
  });

  it("should not break when listener throws", async () => {
    registry.on(() => {
      throw new Error("Listener error");
    });

    const goodEvents: SkillEvent[] = [];
    registry.on((e) => goodEvents.push(e));

    // Should not throw, even though one listener errors
    await registry.activateSkill("test-skill");
    expect(goodEvents.length).toBe(1);
  });
});
