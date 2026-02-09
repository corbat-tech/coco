/**
 * Tests for smart-suggestions tool
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    access: vi.fn(),
  },
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Mock the registry
vi.mock("./registry.js", () => ({
  defineTool: (def: unknown) => def,
}));

describe("smart-suggestions", () => {
  let analyzeAndSuggest: typeof import("./smart-suggestions.js").analyzeAndSuggest;
  let suggestImprovementsTool: typeof import("./smart-suggestions.js").suggestImprovementsTool;
  let calculateCodeScoreTool: typeof import("./smart-suggestions.js").calculateCodeScoreTool;
  let fsModule: {
    readFile: ReturnType<typeof vi.fn>;
    access: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("node:fs/promises", () => {
      const readFile = vi.fn();
      const access = vi.fn();
      return { default: { readFile, access }, readFile, access };
    });

    const mod = await import("./smart-suggestions.js");
    analyzeAndSuggest = mod.analyzeAndSuggest;
    suggestImprovementsTool = mod.suggestImprovementsTool;
    calculateCodeScoreTool = mod.calculateCodeScoreTool;

    const fsMod = await import("node:fs/promises");
    fsModule = fsMod.default as unknown as {
      readFile: ReturnType<typeof vi.fn>;
      access: ReturnType<typeof vi.fn>;
    };
  });

  describe("analyzeAndSuggest", () => {
    it("should detect console.log in production code", async () => {
      fsModule.readFile.mockResolvedValue('console.log("debug info");\n');
      fsModule.access.mockResolvedValue(undefined); // test file exists

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const consoleSuggestion = suggestions.find((s) =>
        s.message.includes("Console.log found"),
      );
      expect(consoleSuggestion).toBeDefined();
      expect(consoleSuggestion?.type).toBe("readability");
      expect(consoleSuggestion?.severity).toBe("medium");
      expect(consoleSuggestion?.line).toBe(1);
    });

    it("should not flag console.log in test files", async () => {
      fsModule.readFile.mockResolvedValue('console.log("debug info");\n');

      const suggestions = await analyzeAndSuggest("/src/app.test.ts");

      const consoleSuggestion = suggestions.find((s) =>
        s.message.includes("Console.log found"),
      );
      expect(consoleSuggestion).toBeUndefined();
    });

    it("should detect TODO comments", async () => {
      fsModule.readFile.mockResolvedValue("// TODO: implement this\n");
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const todoSuggestion = suggestions.find((s) => s.message.includes("TODO/FIXME"));
      expect(todoSuggestion).toBeDefined();
      expect(todoSuggestion?.severity).toBe("low");
    });

    it("should detect FIXME comments", async () => {
      fsModule.readFile.mockResolvedValue("// FIXME: broken logic\n");
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const fixmeSuggestion = suggestions.find((s) => s.message.includes("TODO/FIXME"));
      expect(fixmeSuggestion).toBeDefined();
    });

    it("should detect long lines exceeding 120 chars", async () => {
      const longLine = "const x = " + "a".repeat(120) + ";\n";
      fsModule.readFile.mockResolvedValue(longLine);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const longLineSuggestion = suggestions.find((s) =>
        s.message.includes("exceeds recommended length"),
      );
      expect(longLineSuggestion).toBeDefined();
      expect(longLineSuggestion?.severity).toBe("low");
    });

    it("should not flag lines within 120 chars", async () => {
      const shortLine = "const x = 1;\n";
      fsModule.readFile.mockResolvedValue(shortLine);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const longLineSuggestion = suggestions.find((s) =>
        s.message.includes("exceeds recommended length"),
      );
      expect(longLineSuggestion).toBeUndefined();
    });

    it("should detect any type usage", async () => {
      fsModule.readFile.mockResolvedValue("const data: any = {};\n");
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const anySuggestion = suggestions.find((s) => s.message.includes("'any' type"));
      expect(anySuggestion).toBeDefined();
      expect(anySuggestion?.type).toBe("security");
      expect(anySuggestion?.severity).toBe("high");
    });

    it("should not flag any type when suppressed with @ts- comment", async () => {
      fsModule.readFile.mockResolvedValue("const data: any = {}; // @ts-ignore\n");
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const anySuggestion = suggestions.find((s) => s.message.includes("'any' type"));
      expect(anySuggestion).toBeUndefined();
    });

    it("should detect empty catch blocks", async () => {
      const code = "try {\n  doSomething();\n} catch (error) {\n}\n";
      fsModule.readFile.mockResolvedValue(code);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const emptyCatch = suggestions.find((s) => s.message.includes("Empty catch block"));
      expect(emptyCatch).toBeDefined();
      expect(emptyCatch?.type).toBe("security");
      expect(emptyCatch?.severity).toBe("high");
    });

    it("should detect synchronous fs operations", async () => {
      fsModule.readFile.mockResolvedValue(
        'const data = fs.readFileSync("file.txt", "utf-8");\n',
      );
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const syncSuggestion = suggestions.find((s) =>
        s.message.includes("Synchronous file operation"),
      );
      expect(syncSuggestion).toBeDefined();
      expect(syncSuggestion?.type).toBe("performance");
      expect(syncSuggestion?.severity).toBe("medium");
    });

    it("should detect fs.writeFileSync as synchronous operation", async () => {
      fsModule.readFile.mockResolvedValue(
        'fs.writeFileSync("file.txt", "data");\n',
      );
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const syncSuggestion = suggestions.find((s) =>
        s.message.includes("Synchronous file operation"),
      );
      expect(syncSuggestion).toBeDefined();
    });

    it("should detect async arrow functions without error handling", async () => {
      const code = "const handler = async () => {\n  await doStuff();\n  return result;\n};\n";
      fsModule.readFile.mockResolvedValue(code);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const asyncSuggestion = suggestions.find((s) =>
        s.message.includes("Async function without error handling"),
      );
      expect(asyncSuggestion).toBeDefined();
      expect(asyncSuggestion?.severity).toBe("medium");
    });

    it("should not flag async arrow functions that have try/catch", async () => {
      const code =
        "const handler = async () => {\n  try {\n    await doStuff();\n  } catch (e) {\n    console.error(e);\n  }\n};\n";
      fsModule.readFile.mockResolvedValue(code);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      const asyncSuggestion = suggestions.find((s) =>
        s.message.includes("Async function without error handling"),
      );
      expect(asyncSuggestion).toBeUndefined();
    });

    it("should detect missing test file for exported module", async () => {
      fsModule.readFile.mockResolvedValue("export function doStuff() {}\n");
      fsModule.access.mockRejectedValue(new Error("ENOENT"));

      const suggestions = await analyzeAndSuggest("/src/utils.ts");

      const testSuggestion = suggestions.find((s) =>
        s.message.includes("no test file found"),
      );
      expect(testSuggestion).toBeDefined();
      expect(testSuggestion?.type).toBe("testing");
    });

    it("should not flag missing tests when test file exists", async () => {
      fsModule.readFile.mockResolvedValue("export function doStuff() {}\n");
      fsModule.access.mockResolvedValue(undefined); // test file exists

      const suggestions = await analyzeAndSuggest("/src/utils.ts");

      const testSuggestion = suggestions.find((s) =>
        s.message.includes("no test file found"),
      );
      expect(testSuggestion).toBeUndefined();
    });

    it("should handle clean code with no issues", async () => {
      const cleanCode = "const x = 1;\nconst y = 2;\n";
      fsModule.readFile.mockResolvedValue(cleanCode);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      expect(suggestions.length).toBe(0);
    });

    it("should report multiple issues on different lines", async () => {
      const code =
        '// TODO: fix this\nconsole.log("debug");\nconst data: any = null;\n';
      fsModule.readFile.mockResolvedValue(code);
      fsModule.access.mockResolvedValue(undefined);

      const suggestions = await analyzeAndSuggest("/src/app.ts");

      expect(suggestions.length).toBeGreaterThanOrEqual(3);
      // Check we have different types of suggestions
      const types = new Set(suggestions.map((s) => s.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe("suggestImprovementsTool", () => {
    it("should group suggestions by severity", async () => {
      const code =
        '// TODO: fix\nconst x: any = 1;\nconsole.log("test");\n';
      fsModule.readFile.mockResolvedValue(code);
      fsModule.access.mockResolvedValue(undefined);

      const result = await suggestImprovementsTool.execute({
        filePath: "/src/app.ts",
      });

      expect(result.totalSuggestions).toBeGreaterThan(0);
      expect(result.bySeverity).toBeDefined();
      expect(typeof result.bySeverity.high).toBe("number");
      expect(typeof result.bySeverity.medium).toBe("number");
      expect(typeof result.bySeverity.low).toBe("number");
    });

    it("should group suggestions by type", async () => {
      const code =
        '// TODO: fix\nconst x: any = 1;\nfs.readFileSync("f");\n';
      fsModule.readFile.mockResolvedValue(code);
      fsModule.access.mockResolvedValue(undefined);

      const result = await suggestImprovementsTool.execute({
        filePath: "/src/app.ts",
      });

      expect(result.byType).toBeDefined();
      expect(typeof result.byType.readability).toBe("number");
      expect(typeof result.byType.security).toBe("number");
      expect(typeof result.byType.performance).toBe("number");
    });

    it("should limit suggestions to top 20", async () => {
      // Generate code with many issues (>20 TODO lines)
      const lines = Array.from({ length: 25 }, (_, i) => `// TODO: item ${i}`).join("\n");
      fsModule.readFile.mockResolvedValue(lines);
      fsModule.access.mockResolvedValue(undefined);

      const result = await suggestImprovementsTool.execute({
        filePath: "/src/app.ts",
      });

      expect(result.suggestions.length).toBeLessThanOrEqual(20);
    });
  });

  describe("calculateCodeScoreTool", () => {
    it("should return perfect score for clean code", async () => {
      fsModule.readFile.mockResolvedValue("const x = 1;\nconst y = 2;\n");
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/clean.ts",
      });

      expect(result.score).toBe(100);
      expect(result.grade).toBe("A");
    });

    it("should deduct 10 per high severity issue", async () => {
      fsModule.readFile.mockResolvedValue("const x: any = 1;\n");
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/bad.ts",
      });

      expect(result.score).toBeLessThanOrEqual(90);
      expect(result.issues.high).toBeGreaterThan(0);
    });

    it("should deduct 5 per medium severity issue", async () => {
      fsModule.readFile.mockResolvedValue('console.log("test");\n');
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/medium.ts",
      });

      expect(result.score).toBeLessThanOrEqual(95);
      expect(result.issues.medium).toBeGreaterThan(0);
    });

    it("should deduct 2 per low severity issue", async () => {
      fsModule.readFile.mockResolvedValue("// TODO: do something\n");
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/low.ts",
      });

      expect(result.score).toBeLessThanOrEqual(98);
      expect(result.issues.low).toBeGreaterThan(0);
    });

    it("should deduct for very large files (>500 lines)", async () => {
      const lines = Array.from({ length: 501 }, (_, i) => `const line${i} = ${i};`).join("\n");
      fsModule.readFile.mockResolvedValue(lines);
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/large.ts",
      });

      // Score should be reduced for large file
      expect(result.score).toBeLessThanOrEqual(95);
      expect(result.nonEmptyLines).toBeGreaterThan(500);
    });

    it("should never return score below 0", async () => {
      // Code with many issues to bring score very low
      const badLines = Array.from(
        { length: 15 },
        () => "const x: any = 1;\n",
      ).join("");
      fsModule.readFile.mockResolvedValue(badLines);
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/terrible.ts",
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("should assign correct letter grades", async () => {
      // Grade A: 90+
      fsModule.readFile.mockResolvedValue("const x = 1;\n");
      fsModule.access.mockResolvedValue(undefined);
      let result = await calculateCodeScoreTool.execute({ filePath: "/src/a.ts" });
      expect(result.grade).toBe("A");

      // Grade F: score < 60 (many high severity issues)
      const badCode = Array.from({ length: 10 }, () => "const x: any = 1;\n").join("");
      fsModule.readFile.mockResolvedValue(badCode);
      result = await calculateCodeScoreTool.execute({ filePath: "/src/f.ts" });
      expect(["D", "F"]).toContain(result.grade);
    });

    it("should include recommendations based on score", async () => {
      // Low score code
      const badCode = Array.from({ length: 8 }, () => "const x: any = 1;\n").join("");
      fsModule.readFile.mockResolvedValue(badCode);
      fsModule.access.mockResolvedValue(undefined);

      const result = await calculateCodeScoreTool.execute({
        filePath: "/src/bad.ts",
      });

      if (result.score < 70) {
        expect(result.recommendations).toContain("Address high severity issues");
      }
    });
  });
});
