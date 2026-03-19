import { describe, it, expect } from "vitest";
import { EnhancerRegistry, createEnhancerRegistry } from "../enhancers/registry.js";
import type { PromptEnhancer } from "../enhancers/types.js";

function makeEnhancer(overrides: Partial<PromptEnhancer> = {}): PromptEnhancer {
  return {
    name: "test-enhancer",
    description: "Test enhancer",
    triggers: ["general"],
    priority: 50,
    content: "Test content",
    enabled: true,
    ...overrides,
  };
}

describe("EnhancerRegistry", () => {
  describe("register", () => {
    it("should register an enhancer", () => {
      const registry = new EnhancerRegistry();
      const enhancer = makeEnhancer();
      registry.register(enhancer);
      expect(registry.has("test-enhancer")).toBe(true);
    });

    it("should throw on duplicate registration", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer());
      expect(() => registry.register(makeEnhancer())).toThrow("already registered");
    });
  });

  describe("getForType", () => {
    it("should return enhancers matching the request type", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "a", triggers: ["bugfix"], priority: 10 }));
      registry.register(makeEnhancer({ name: "b", triggers: ["feature"], priority: 20 }));

      const result = registry.getForType("bugfix");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("a");
    });

    it("should include enhancers with 'general' trigger for any type", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "universal", triggers: ["general"], priority: 5 }));
      registry.register(makeEnhancer({ name: "specific", triggers: ["bugfix"], priority: 10 }));

      const result = registry.getForType("bugfix");
      expect(result).toHaveLength(2);
    });

    it("should sort by priority ascending", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "low", triggers: ["feature"], priority: 100 }));
      registry.register(makeEnhancer({ name: "high", triggers: ["feature"], priority: 1 }));
      registry.register(makeEnhancer({ name: "mid", triggers: ["feature"], priority: 50 }));

      const result = registry.getForType("feature");
      expect(result.map((e) => e.name)).toEqual(["high", "mid", "low"]);
    });

    it("should exclude disabled enhancers", () => {
      const registry = new EnhancerRegistry();
      registry.register(
        makeEnhancer({ name: "disabled", triggers: ["feature"], priority: 10, enabled: false }),
      );
      registry.register(
        makeEnhancer({ name: "enabled", triggers: ["feature"], priority: 20, enabled: true }),
      );

      const result = registry.getForType("feature");
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("enabled");
    });

    it("should return empty array for no matches", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "a", triggers: ["bugfix"] }));

      expect(registry.getForType("question")).toEqual([]);
    });
  });

  describe("getAll", () => {
    it("should return all registered enhancers", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "a" }));
      registry.register(makeEnhancer({ name: "b" }));

      expect(registry.getAll()).toHaveLength(2);
    });

    it("should return empty array for empty registry", () => {
      const registry = new EnhancerRegistry();
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("enable/disable", () => {
    it("should disable an enhancer", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "a", triggers: ["feature"] }));
      registry.disable("a");

      expect(registry.getForType("feature")).toHaveLength(0);
    });

    it("should re-enable an enhancer", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "a", triggers: ["feature"] }));
      registry.disable("a");
      registry.enable("a");

      expect(registry.getForType("feature")).toHaveLength(1);
    });

    it("should silently ignore enable/disable for unknown names", () => {
      const registry = new EnhancerRegistry();
      expect(() => registry.enable("nonexistent")).not.toThrow();
      expect(() => registry.disable("nonexistent")).not.toThrow();
    });
  });

  describe("has", () => {
    it("should return true for registered enhancers", () => {
      const registry = new EnhancerRegistry();
      registry.register(makeEnhancer({ name: "exists" }));
      expect(registry.has("exists")).toBe(true);
    });

    it("should return false for unregistered names", () => {
      const registry = new EnhancerRegistry();
      expect(registry.has("nope")).toBe(false);
    });
  });
});

describe("createEnhancerRegistry", () => {
  it("should create a registry with all built-in enhancers", () => {
    const registry = createEnhancerRegistry();
    const all = registry.getAll();

    // Should have all 6 built-in enhancers
    expect(all.length).toBe(6);
    expect(registry.has("Verification Protocol")).toBe(true);
    expect(registry.has("Parallel Tool Execution")).toBe(true);
    expect(registry.has("Proactive Codebase Research")).toBe(true);
    expect(registry.has("Systematic Debugging")).toBe(true);
    expect(registry.has("Testing Discipline")).toBe(true);
    expect(registry.has("Task Planning")).toBe(true);
  });

  it("should return verification + parallel for question type", () => {
    const registry = createEnhancerRegistry();
    const result = registry.getForType("question");

    // Verification and Parallel trigger on all types
    const names = result.map((e) => e.name);
    expect(names).toContain("Verification Protocol");
    expect(names).toContain("Parallel Tool Execution");
    // These should NOT appear for questions
    expect(names).not.toContain("Proactive Codebase Research");
    expect(names).not.toContain("Systematic Debugging");
  });

  it("should return all 6 enhancers for bugfix type", () => {
    const registry = createEnhancerRegistry();
    const result = registry.getForType("bugfix");

    // bugfix triggers: verification, parallel (all types) + research + debugging + testing
    const names = result.map((e) => e.name);
    expect(names).toContain("Verification Protocol");
    expect(names).toContain("Parallel Tool Execution");
    expect(names).toContain("Proactive Codebase Research");
    expect(names).toContain("Systematic Debugging");
    expect(names).toContain("Testing Discipline");
    // Planning is NOT triggered by bugfix
    expect(names).not.toContain("Task Planning");
  });

  it("should return planning enhancer for feature type", () => {
    const registry = createEnhancerRegistry();
    const result = registry.getForType("feature");

    const names = result.map((e) => e.name);
    expect(names).toContain("Task Planning");
    expect(names).toContain("Testing Discipline");
    expect(names).toContain("Proactive Codebase Research");
  });
});
