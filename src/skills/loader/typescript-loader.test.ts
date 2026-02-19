import { describe, it, expect } from "vitest";
import { nativeSkillToMetadata, nativeSkillToLoaded, type LegacySkill } from "./typescript-loader.js";

const mockSkill: LegacySkill = {
  name: "ship",
  description: "Ship changes: review, test, branch, version, commit, PR, merge, release",
  usage: "/ship [--skip-tests]",
  aliases: ["release", "deploy"],
  category: "git",
  execute: async () => ({ success: true, output: "Shipped!" }),
};

describe("nativeSkillToMetadata", () => {
  it("should convert a native skill to metadata", () => {
    const meta = nativeSkillToMetadata(mockSkill, "builtin");
    expect(meta.id).toBe("ship");
    expect(meta.name).toBe("ship");
    expect(meta.description).toContain("Ship changes");
    expect(meta.kind).toBe("native");
    expect(meta.scope).toBe("builtin");
    expect(meta.category).toBe("git");
    expect(meta.aliases).toEqual(["release", "deploy"]);
    expect(meta.version).toBe("1.0.0");
  });

  it("should default category to general for unknown categories", () => {
    const skill: LegacySkill = {
      name: "test",
      description: "test",
      category: "unknown-category",
      execute: async () => ({ success: true }),
    };
    const meta = nativeSkillToMetadata(skill, "builtin");
    expect(meta.category).toBe("general");
  });

  it("should handle skill without optional fields", () => {
    const minimal: LegacySkill = {
      name: "minimal",
      description: "A minimal skill",
      execute: async () => ({ success: true }),
    };
    const meta = nativeSkillToMetadata(minimal, "global");
    expect(meta.id).toBe("minimal");
    expect(meta.category).toBe("general");
    expect(meta.aliases).toBeUndefined();
    expect(meta.scope).toBe("global");
  });
});

describe("nativeSkillToLoaded", () => {
  it("should convert to a LoadedSkill with executable content", async () => {
    const loaded = nativeSkillToLoaded(mockSkill, "builtin");
    expect(loaded.metadata.id).toBe("ship");
    expect(loaded.metadata.kind).toBe("native");
    expect("execute" in loaded.content).toBe(true);

    const result = await (loaded.content as { execute: Function }).execute("", {});
    expect(result.success).toBe(true);
    expect(result.output).toBe("Shipped!");
  });
});
