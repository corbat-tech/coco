import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  isMarkdownSkill,
  loadMarkdownMetadata,
  loadMarkdownContent,
  toKebabCase,
  isNamespaceDirectory,
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
    expect(meta!.description).toBe("A test skill for validating the unified skills system");
    expect(meta!.version).toBe("2.0.0");
    expect(meta!.kind).toBe("markdown");
    expect(meta!.scope).toBe("project");
    expect(meta!.category).toBe("testing");
    expect(meta!.tags).toContain("testing");
    expect(meta!.tags).toContain("fixtures");
    expect(meta!.tags).toContain("validation");
    expect(meta!.tags).toContain("quality");
    expect(meta!.author).toBe("test-author");
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
    expect(meta!.category).toBe("general");
  });

  it("should return null for non-existent skill", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "non-existent"), "project");
    expect(meta).toBeNull();
  });

  it("should parse skills.sh standard fields", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "test-skill"), "project");
    expect(meta).not.toBeNull();
    expect(meta!.disableModelInvocation).toBe(true);
    expect(meta!.allowedTools).toEqual(["Bash", "Read", "Edit"]);
    expect(meta!.argumentHint).toBe('[--verbose] <target>');
    expect(meta!.compatibility).toBe("Requires Node.js 22+");
    expect(meta!.model).toBe("claude-sonnet-4-20250514");
    expect(meta!.context).toBe("fork");
  });

  it("should merge tags from top-level and metadata", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "test-skill"), "project");
    expect(meta).not.toBeNull();
    // Should contain tags from both top-level and metadata.tags, deduplicated
    expect(meta!.tags).toContain("testing");
    expect(meta!.tags).toContain("fixtures");
    expect(meta!.tags).toContain("validation");
    expect(meta!.tags).toContain("quality");  // from metadata.tags
    expect(meta!.tags!.length).toBe(4);
  });

  it("should prefer top-level author over metadata.author", async () => {
    // test-skill has no top-level author, only metadata.author
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "test-skill"), "project");
    expect(meta).not.toBeNull();
    expect(meta!.author).toBe("test-author");
  });
});

describe("loadMarkdownContent", () => {
  it("should load full content from test-skill", async () => {
    const content = await loadMarkdownContent(join(FIXTURES_DIR, "test-skill"));
    expect(content).not.toBeNull();
    expect(content!.instructions).toContain("# Test Skill");
    expect(content!.instructions).toContain("unified skills system");
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

  it("should load content with $ARGUMENTS placeholder", async () => {
    const content = await loadMarkdownContent(join(FIXTURES_DIR, "test-skill"));
    expect(content).not.toBeNull();
    expect(content!.instructions).toContain("$ARGUMENTS");
  });
});

describe("loadMarkdownMetadata — namespace & source", () => {
  it("should populate source field from directory name", async () => {
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "test-skill"), "project");
    expect(meta).not.toBeNull();
    expect(meta!.source).toBe("test-skill");
  });

  it("should not detect namespace for skills in root skills directory", async () => {
    // FIXTURES_DIR = test/fixtures/skills → parent of test-skill is "skills"
    const meta = await loadMarkdownMetadata(join(FIXTURES_DIR, "test-skill"), "project");
    expect(meta).not.toBeNull();
    expect(meta!.namespace).toBeUndefined();
    expect(meta!.id).toBe("test-skill"); // no namespace prefix
  });
});

describe("isNamespaceDirectory", () => {
  it("should return false for well-known root dirs", () => {
    expect(isNamespaceDirectory("skills")).toBe(false);
    expect(isNamespaceDirectory(".coco")).toBe(false);
    expect(isNamespaceDirectory(".claude")).toBe(false);
    expect(isNamespaceDirectory(".agents")).toBe(false);
    expect(isNamespaceDirectory(".cursor")).toBe(false);
    expect(isNamespaceDirectory(".windsurf")).toBe(false);
    expect(isNamespaceDirectory(".github")).toBe(false);
  });

  it("should return true for namespace directories", () => {
    expect(isNamespaceDirectory("anthropics")).toBe(true);
    expect(isNamespaceDirectory("my-org")).toBe(true);
    expect(isNamespaceDirectory("corbat")).toBe(true);
  });

  it("should return false for empty string", () => {
    expect(isNamespaceDirectory("")).toBe(false);
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
