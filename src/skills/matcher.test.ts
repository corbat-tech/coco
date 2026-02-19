import { describe, it, expect } from "vitest";
import { matchSkills, tokenize, stem, levenshtein } from "./matcher.js";
import type { SkillMetadata } from "./types.js";

const testSkills: SkillMetadata[] = [
  {
    id: "api-standards",
    name: "api-standards",
    description: "REST API design standards and conventions",
    version: "1.0.0",
    category: "coding",
    kind: "markdown",
    scope: "project",
    path: "/fake/path",
    tags: ["api", "rest", "design"],
  },
  {
    id: "docker-deploy",
    name: "docker-deploy",
    description: "Docker deployment workflows and best practices",
    version: "1.0.0",
    category: "deployment",
    kind: "markdown",
    scope: "global",
    path: "/fake/path",
    tags: ["docker", "deployment", "devops"],
  },
  {
    id: "testing-guide",
    name: "testing-guide",
    description: "Testing best practices with Vitest",
    version: "1.0.0",
    category: "testing",
    kind: "markdown",
    scope: "project",
    path: "/fake/path",
    tags: ["testing", "vitest", "tdd"],
  },
  {
    id: "ship",
    name: "ship",
    description: "Ship changes: review, test, branch, version, commit, PR, merge, release",
    version: "1.0.0",
    category: "git",
    kind: "native",
    scope: "builtin",
    path: "",
    aliases: ["release", "deploy"],
  },
];

describe("tokenize", () => {
  it("should lowercase and split words", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("should filter stop words", () => {
    expect(tokenize("create a new REST API")).toEqual(["create", "new", "rest", "api"]);
  });

  it("should split kebab-case and stem tokens", () => {
    expect(tokenize("api-standards")).toEqual(["api", "standard"]);
  });

  it("should remove special characters", () => {
    expect(tokenize("test@v2.0")).toEqual(["test", "v2"]);
  });

  it("should filter single-character tokens", () => {
    expect(tokenize("a b c test")).toEqual(["test"]);
  });
});

describe("matchSkills", () => {
  it("should match by name", () => {
    const matches = matchSkills("api standards", testSkills);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.id).toBe("api-standards");
  });

  it("should match by description keywords", () => {
    const matches = matchSkills("docker deployment", testSkills);
    expect(matches.length).toBeGreaterThan(0);
    const ids = matches.map((m) => m.skill.id);
    expect(ids).toContain("docker-deploy");
  });

  it("should match by tags", () => {
    const matches = matchSkills("vitest tdd", testSkills);
    expect(matches.length).toBeGreaterThan(0);
    const ids = matches.map((m) => m.skill.id);
    expect(ids).toContain("testing-guide");
  });

  it("should return empty for unrelated query", () => {
    const matches = matchSkills("quantum physics", testSkills, { minScore: 0.5 });
    expect(matches).toEqual([]);
  });

  it("should respect maxResults", () => {
    const matches = matchSkills("test deploy api", testSkills, { maxResults: 2 });
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("should respect minScore", () => {
    const matches = matchSkills("test", testSkills, { minScore: 0.8 });
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("should return scores between 0 and 1", () => {
    const matches = matchSkills("api rest design standards", testSkills);
    for (const match of matches) {
      expect(match.score).toBeGreaterThanOrEqual(0);
      expect(match.score).toBeLessThanOrEqual(1);
    }
  });

  it("should sort by score descending", () => {
    const matches = matchSkills("api design standards", testSkills);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it("should handle empty query", () => {
    const matches = matchSkills("", testSkills);
    expect(matches).toEqual([]);
  });

  it("should handle empty skills list", () => {
    const matches = matchSkills("test query", []);
    expect(matches).toEqual([]);
  });

  it("should boost score when activeFiles match skill globs", () => {
    const skillsWithGlobs: SkillMetadata[] = [
      {
        id: "react-guide",
        name: "react-guide",
        description: "React component development guide",
        version: "1.0.0",
        category: "coding",
        kind: "markdown",
        scope: "project",
        path: "/fake/path",
        tags: ["react"],
        globs: ["*.tsx", "*.jsx"],
      },
      {
        id: "python-guide",
        name: "python-guide",
        description: "Python development guide",
        version: "1.0.0",
        category: "coding",
        kind: "markdown",
        scope: "project",
        path: "/fake/path",
        tags: ["python"],
        globs: ["*.py"],
      },
    ];

    const noFiles = matchSkills("development guide", skillsWithGlobs, { minScore: 0.1 });
    const withFiles = matchSkills("development guide", skillsWithGlobs, {
      minScore: 0.1,
      activeFiles: ["src/App.tsx", "src/Header.tsx"],
    });

    const reactWithFiles = withFiles.find((m) => m.skill.id === "react-guide");
    const reactNoFiles = noFiles.find((m) => m.skill.id === "react-guide");

    expect(reactWithFiles).toBeDefined();
    expect(reactNoFiles).toBeDefined();
    expect(reactWithFiles!.score).toBeGreaterThan(reactNoFiles!.score);
  });

  it("should match stemmed forms (testing -> test)", () => {
    const matches = matchSkills("testing best practices", testSkills, { minScore: 0.1 });
    const ids = matches.map((m) => m.skill.id);
    expect(ids).toContain("testing-guide");
  });
});

describe("stem", () => {
  it("should handle words shorter than 4 characters unchanged", () => {
    expect(stem("the")).toBe("the");
    expect(stem("run")).toBe("run");
    expect(stem("go")).toBe("go");
  });

  it("should strip -s plural suffix", () => {
    expect(stem("tests")).toBe("test");
    expect(stem("standards")).toBe("standard");
  });

  it("should strip -es suffix", () => {
    expect(stem("changes")).toBe("chang");
    expect(stem("processes")).toBe("process");
  });

  it("should handle -ies suffix", () => {
    expect(stem("dependencies")).toBe("dependenci");
  });

  it("should strip -ing suffix and handle doubling", () => {
    expect(stem("testing")).toBe("test");
    expect(stem("running")).toBe("run");
    expect(stem("deploying")).toBe("deploy");
  });

  it("should strip -ed suffix and handle doubling", () => {
    expect(stem("tested")).toBe("test");
    expect(stem("mapped")).toBe("map");
    expect(stem("deployed")).toBe("deploy");
  });

  it("should strip -tion suffix", () => {
    expect(stem("creation")).toBe("creat");
    expect(stem("documentation")).toBe("documentat");
  });

  it("should strip -ness suffix", () => {
    expect(stem("happiness")).toBe("happi");
  });

  it("should strip -ment suffix", () => {
    expect(stem("deployment")).toBe("deploy");
  });

  it("should strip -able suffix", () => {
    expect(stem("testable")).toBe("test");
  });

  it("should strip -ful suffix", () => {
    expect(stem("helpful")).toBe("help");
  });
});

describe("levenshtein", () => {
  it("should return 0 for identical strings", () => {
    expect(levenshtein("test", "test")).toBe(0);
  });

  it("should return length for empty string", () => {
    expect(levenshtein("", "test")).toBe(4);
    expect(levenshtein("test", "")).toBe(4);
  });

  it("should return 1 for single character difference", () => {
    expect(levenshtein("test", "tset")).toBe(2); // transposition = 2 ops
    expect(levenshtein("test", "tost")).toBe(1); // substitution
    expect(levenshtein("test", "tests")).toBe(1); // insertion
    expect(levenshtein("tests", "test")).toBe(1); // deletion
  });

  it("should compute correct distance for longer strings", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});
