/**
 * Tests for config diff utility
 */

import { describe, it, expect } from "vitest";
import {
  diffConfigs,
  formatDiff,
  hasBreakingChanges,
} from "./diff.js";

describe("diffConfigs", () => {
  it("should detect added fields", () => {
    const oldConfig = { a: 1 };
    const newConfig = { a: 1, b: 2 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.added).toBe(1);
    expect(result.entries.some(e => e.path === "b" && e.operation === "added")).toBe(true);
  });

  it("should detect removed fields", () => {
    const oldConfig = { a: 1, b: 2 };
    const newConfig = { a: 1 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.removed).toBe(1);
    expect(result.entries.some(e => e.path === "b" && e.operation === "removed")).toBe(true);
  });

  it("should detect modified fields", () => {
    const oldConfig = { a: 1 };
    const newConfig = { a: 2 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.changed).toBe(1);
    expect(result.entries.some(e => e.path === "a" && e.operation === "changed")).toBe(true);
  });

  it("should handle nested objects", () => {
    const oldConfig = { nested: { a: 1 } };
    const newConfig = { nested: { a: 2, b: 3 } };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.entries.some(e => e.path === "nested.a")).toBe(true);
    expect(result.entries.some(e => e.path === "nested.b")).toBe(true);
  });

  it("should handle arrays", () => {
    const oldConfig = { arr: [1, 2, 3] };
    const newConfig = { arr: [1, 2, 4] };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("should report no changes for identical configs", () => {
    const config = { a: 1, nested: { b: 2 } };

    const result = diffConfigs(config, config);

    expect(result.identical).toBe(true);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.changed).toBe(0);
  });

  it("should ignore specified paths", () => {
    const oldConfig = { a: 1, ignore: "old" };
    const newConfig = { a: 1, ignore: "new" };

    const result = diffConfigs(oldConfig, newConfig, { ignorePaths: ["ignore"] });

    expect(result.identical).toBe(true);
  });

  it("should respect maxDepth option", () => {
    const oldConfig = { level1: { level2: { level3: 1 } } };
    const newConfig = { level1: { level2: { level3: 2 } } };

    const result = diffConfigs(oldConfig, newConfig, { maxDepth: 1 });

    expect(result.identical).toBe(false);
    // Should detect change at shallower level
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("should handle null values", () => {
    const oldConfig = { a: null };
    const newConfig = { a: 1 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.entries.some(e => e.path === "a" && e.operation === "changed")).toBe(true);
  });

  it("should handle undefined values", () => {
    const oldConfig: Record<string, unknown> = { a: undefined };
    const newConfig = { a: 1 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
  });

  it("should handle empty objects", () => {
    const result = diffConfigs({}, {});

    expect(result.identical).toBe(true);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.changed).toBe(0);
  });

  it("should handle type changes", () => {
    const oldConfig = { a: "string" };
    const newConfig = { a: 123 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.identical).toBe(false);
    expect(result.entries.some(e => e.path === "a" && e.operation === "changed")).toBe(true);
  });

  it("should generate summary", () => {
    const oldConfig = { a: 1 };
    const newConfig = { a: 2, b: 3 };

    const result = diffConfigs(oldConfig, newConfig);

    expect(result.summary).toContain("changed");
    expect(result.summary).toContain("added");
  });

  it("should include unchanged entries when requested", () => {
    const oldConfig = { a: 1, b: 2 };
    const newConfig = { a: 1, b: 3 };

    const result = diffConfigs(oldConfig, newConfig, { includeUnchanged: true });

    expect(result.entries.some(e => e.path === "a" && e.operation === "unchanged")).toBe(true);
  });
});

describe("formatDiff", () => {
  it("should format add operation", () => {
    const result = diffConfigs({ a: 1 }, { a: 1, b: 2 });
    const formatted = formatDiff(result);

    expect(formatted).toContain("b");
    expect(formatted).toContain("+");
  });

  it("should format remove operation", () => {
    const result = diffConfigs({ a: 1, b: 2 }, { a: 1 });
    const formatted = formatDiff(result);

    expect(formatted).toContain("b");
    expect(formatted).toContain("-");
  });

  it("should format modify operation", () => {
    const result = diffConfigs({ a: 1 }, { a: 2 });
    const formatted = formatDiff(result);

    expect(formatted).toContain("a");
    expect(formatted).toContain("~");
    expect(formatted).toContain("→");
  });

  it("should return 'No changes' for identical configs", () => {
    const result = diffConfigs({ a: 1 }, { a: 1 });
    const formatted = formatDiff(result);

    expect(formatted).toBe("No changes");
  });

  it("should support colorized output", () => {
    const result = diffConfigs({ a: 1 }, { a: 2 });
    const formatted = formatDiff(result, true);

    expect(formatted).toContain("\x1b[");
  });

  it("should format values correctly", () => {
    const result = diffConfigs({ str: "hello" }, { str: "world" });
    const formatted = formatDiff(result);

    expect(formatted).toContain('"hello"');
    expect(formatted).toContain('"world"');
  });
});

describe("hasBreakingChanges", () => {
  it("should detect breaking change on removal of required path", () => {
    const result = diffConfigs({ required: 1 }, {});
    const breaking = hasBreakingChanges(result, ["required"]);

    expect(breaking.breaking).toBe(true);
    expect(breaking.paths).toContain("required");
  });

  it("should not flag removal as breaking if path not required", () => {
    const result = diffConfigs({ optional: 1 }, {});
    const breaking = hasBreakingChanges(result, ["required"]);

    expect(breaking.breaking).toBe(false);
  });

  it("should flag type change of required path as breaking", () => {
    const result = diffConfigs({ required: "string" }, { required: 123 });
    const breaking = hasBreakingChanges(result, ["required"]);

    expect(breaking.breaking).toBe(true);
  });

  it("should not flag same-type modify as breaking", () => {
    const result = diffConfigs({ required: "old" }, { required: "new" });
    const breaking = hasBreakingChanges(result, ["required"]);

    expect(breaking.breaking).toBe(false);
  });

  it("should return false for no changes", () => {
    const result = diffConfigs({ a: 1 }, { a: 1 });
    const breaking = hasBreakingChanges(result);

    expect(breaking.breaking).toBe(false);
    expect(breaking.paths).toHaveLength(0);
  });

  it("should handle nested required paths", () => {
    const result = diffConfigs({ nested: { value: 1 } }, { nested: {} });
    const breaking = hasBreakingChanges(result, ["nested"]);

    expect(breaking.breaking).toBe(true);
  });
});
