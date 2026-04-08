import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { discoverAllSkills, resolveDiscoveryDirs, scanSkillsDirectory } from "./discovery.js";
import type { LegacySkill } from "./loader/typescript-loader.js";

const FIXTURES_DIR = join(process.cwd(), "test/fixtures/skills");

const mockBuiltins: LegacySkill[] = [
  {
    name: "help",
    description: "Show available commands",
    category: "general",
    execute: async () => ({ success: true }),
  },
  {
    name: "ship",
    description: "Ship changes",
    aliases: ["release"],
    category: "git",
    execute: async () => ({ success: true }),
  },
];

describe("scanSkillsDirectory", () => {
  it("should find markdown skills in a directory", async () => {
    const skills = await scanSkillsDirectory(FIXTURES_DIR, "project");
    expect(skills.length).toBe(2);

    const names = skills.map((s) => s.name);
    expect(names).toContain("test-skill");
    expect(names).toContain("minimal-skill");

    const testSkill = skills.find((s) => s.name === "test-skill");
    expect(testSkill?.scope).toBe("project");
    expect(testSkill?.kind).toBe("markdown");
  });

  it("should return empty array for non-existent directory", async () => {
    const skills = await scanSkillsDirectory("/non/existent/path", "global");
    expect(skills).toEqual([]);
  });
});

describe("discoverAllSkills", () => {
  it("should discover builtin skills", async () => {
    const skills = await discoverAllSkills(
      "/non-existent-project",
      mockBuiltins,
      "/non-existent-global",
    );
    expect(skills.length).toBe(2);

    const helpSkill = skills.find((s) => s.name === "help");
    expect(helpSkill?.kind).toBe("native");
    expect(helpSkill?.scope).toBe("builtin");
  });

  it("should discover project skills from fixtures", async () => {
    const skills = await scanSkillsDirectory(FIXTURES_DIR, "project");
    expect(skills.length).toBe(2);
  });

  it("should deduplicate skills by scope priority (project overrides global)", async () => {
    const builtinWithSameName: LegacySkill[] = [
      {
        name: "test-skill",
        description: "Builtin version of test-skill",
        category: "general",
        execute: async () => ({ success: true }),
      },
    ];

    const skills = await discoverAllSkills(
      "/non-existent-project",
      builtinWithSameName,
      FIXTURES_DIR,
    );

    const testSkill = skills.find((s) => s.name === "test-skill");
    expect(testSkill).toBeDefined();
    expect(testSkill?.scope).toBe("global");
    expect(testSkill?.kind).toBe("markdown");
  });

  it("should return skills sorted by name", async () => {
    const skills = await discoverAllSkills("/non-existent-project", mockBuiltins, FIXTURES_DIR);

    const names = skills.map((s) => s.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("should accept DiscoveryOptions object (new API)", async () => {
    const skills = await discoverAllSkills("/non-existent-project", mockBuiltins, {
      globalDir: FIXTURES_DIR,
    });
    expect(skills.length).toBeGreaterThanOrEqual(2);

    const testSkill = skills.find((s) => s.name === "test-skill");
    expect(testSkill).toBeDefined();
    expect(testSkill?.scope).toBe("global");
  });

  it("should accept string for backward compat (old API)", async () => {
    const skills = await discoverAllSkills("/non-existent-project", mockBuiltins, FIXTURES_DIR);
    expect(skills.length).toBeGreaterThanOrEqual(2);
  });

  it("should support globalDirs as the preferred multi-directory API", async () => {
    const skills = await discoverAllSkills("/non-existent-project", mockBuiltins, {
      globalDirs: ["/non-existent-global", FIXTURES_DIR],
    });
    const testSkill = skills.find((s) => s.name === "test-skill");
    expect(testSkill).toBeDefined();
    expect(testSkill?.scope).toBe("global");
  });
});

describe("resolveDiscoveryDirs", () => {
  it("should resolve project defaults", () => {
    const dirs = resolveDiscoveryDirs("/tmp/my-project");
    expect(dirs.projectDirs).toEqual([
      "/tmp/my-project/.claude/skills",
      "/tmp/my-project/.codex/skills",
      "/tmp/my-project/.gemini/skills",
      "/tmp/my-project/.opencode/skills",
      "/tmp/my-project/.agents/skills",
    ]);
  });

  it("should support legacy string option as globalDir", () => {
    const dirs = resolveDiscoveryDirs("/tmp/my-project", "/tmp/custom-global");
    expect(dirs.globalDirs).toEqual(["/tmp/custom-global"]);
  });

  it("should expand ~ and dedupe multi-directory options", () => {
    const dirs = resolveDiscoveryDirs("/tmp/my-project", {
      globalDirs: ["~/.codex/skills", "~/.codex/skills", " ~/.agents/skills "],
      projectDirs: [".agents/skills", ".agents/skills"],
    });

    expect(dirs.globalDirs).toEqual([
      join(homedir(), ".codex", "skills"),
      join(homedir(), ".agents", "skills"),
    ]);
    expect(dirs.projectDirs).toEqual(["/tmp/my-project/.agents/skills"]);
  });

  it("should prefer new array fields over legacy single-directory fields", () => {
    const dirs = resolveDiscoveryDirs("/tmp/my-project", {
      globalDir: "/tmp/legacy-global",
      globalDirs: ["/tmp/new-global"],
      projectDir: "/tmp/legacy-project",
      projectDirs: ["/tmp/new-project"],
    });

    expect(dirs.globalDirs).toEqual(["/tmp/new-global"]);
    expect(dirs.projectDirs).toEqual(["/tmp/new-project"]);
  });
});
