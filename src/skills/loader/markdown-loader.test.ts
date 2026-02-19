import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  isMarkdownSkill,
  loadMarkdownMetadata,
  loadMarkdownContent,
  toKebabCase,
} from "./markdown-loader.js";

const FIXTURES_DIR = join(process.cwd(), "test/fixtures/skills");

describe("isMarkdownSkill", () => {
  it("should return true for directory with SKILL.md", async () => {
    const result = await isMarkdownSkill(join(FIXTURES_DIR, "test-skill"));
    expect(result).toBe(true);
  });

  it("should return false for non-existent directory", async () => {
    const result = await isMarkdownSkill(join(FIXTURES_DIR, "non-existent"));
    expect(result).toBe(false);
  });

  it("should return false for directory without SKILL.md", async () => {
    const result = await isMarkdownSkill(FIXTURES_DIR);
    expect(result).toBe(false);
  });
});

describe("loadMarkdownMetadata", () => {
  it("should load metadata from a complete SKILL.md", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "test-skill"), "project");
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe("test-skill");
    expect(meta!.name).toBe("test-skill");
    expect(meta!.description).toBe("A test skill for unit testing the skills system");
    expect(meta!.version).toBe("1.0.0");
    expect(meta!.kind).toBe("markdown");
    expect(meta!.scope).toBe("project");
    expect(meta!.category).toBe("testing");
    expect(meta!.tags).toEqual(["testing", "example"]);
    expect(meta!.author).toBe("corbat-team");
  });

  it("should load metadata from a minimal SKILL.md", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "minimal-skill"), "global");
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe("minimal-skill");
    expect(meta!.name).toBe("minimal-skill");
    expect(meta!.description).toBe("A minimal skill with only required fields");
    expect(meta!.version).toBe("1.0.0");
    expect(meta!.kind).toBe("markdown");
    expect(meta!.scope).toBe("global");
    expect(meta!.category).toBe("custom");
  });

  it("should return null for non-existent skill", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "non-existent"), "project");
    expect(meta).toBeNull();
  });
});

describe("loadMarkdownContent", () => {
  it("should load full content from test-skill", async () => {
    const content = await loadMarkdownContent(join(FIXTURES_DIR, "test-skill"));
    expect(content).not.toBeNull();
    expect(content!.instructions).toContain("# Test Skill Instructions");
    expect(content!.instructions).toContain("Always write tests before implementation");
    expect(content!.references.length).toBe(1);
    expect(content!.references[0]).toContain("api-guide.md");
    expect(content!.scripts).toEqual([]);
    expect(content!.templates).toEqual([]);
  });

  it("should load content from minimal skill", async () => {
    const content = await loadMarkdownContent(join(FIXTURES_DIR, "minimal-skill"));
    expect(content).not.toBeNull();
    expect(content!.instructions).toBe("Just follow these instructions.");
    expect(content!.references).toEqual([]);
  });

  it("should return null for non-existent skill", async () => {
    const content = await loadMarkdownContent(join(FIXTURES_DIR, "non-existent"));
    expect(content).toBeNull();
  });
});

describe("toKebabCase", () => {
  it("should convert camelCase", () => {
    expect(toKebabCase("mySkillName")).toBe("my-skill-name");
  });

  it("should convert spaces", () => {
    expect(toKebabCase("my skill name")).toBe("my-skill-name");
  });

  it("should convert underscores", () => {
    expect(toKebabCase("my_skill_name")).toBe("my-skill-name");
  });

  it("should lowercase everything", () => {
    expect(toKebabCase("MySkill")).toBe("my-skill");
  });

  it("should strip invalid characters", () => {
    expect(toKebabCase("my-skill@v2!")).toBe("my-skillv2");
  });

  it("should handle already-kebab-case", () => {
    expect(toKebabCase("already-kebab")).toBe("already-kebab");
  });
});
