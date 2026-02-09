/**
 * Tests for code-analyzer tool
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs/promises before importing the module
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
  readFile: vi.fn(),
}));

// Mock node:path
vi.mock("node:path", () => ({
  default: {
    extname: (p: string) => {
      const m = p.match(/\.[^.]+$/);
      return m ? m[0] : "";
    },
    relative: (from: string, to: string) => to.replace(from + "/", ""),
    join: (...parts: string[]) => parts.join("/"),
  },
  extname: (p: string) => {
    const m = p.match(/\.[^.]+$/);
    return m ? m[0] : "";
  },
  relative: (from: string, to: string) => to.replace(from + "/", ""),
  join: (...parts: string[]) => parts.join("/"),
}));

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn(),
}));

// Mock the registry
vi.mock("./registry.js", () => ({
  defineTool: (def: unknown) => def,
}));

describe("code-analyzer", () => {
  let analyzeFile: typeof import("./code-analyzer.js").analyzeFile;
  let analyzeDirectory: typeof import("./code-analyzer.js").analyzeDirectory;
  let fsModule: { readFile: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("node:fs/promises", () => {
      const readFile = vi.fn();
      return { default: { readFile }, readFile };
    });

    const mod = await import("./code-analyzer.js");
    analyzeFile = mod.analyzeFile;
    analyzeDirectory = mod.analyzeDirectory;

    const fsMod = await import("node:fs/promises");
    fsModule = fsMod.default as unknown as { readFile: ReturnType<typeof vi.fn> };
  });

  describe("analyzeFile", () => {
    it("should analyze a TypeScript file with exported function", async () => {
      const code = 'export function hello(name: string): string {\n  return "hello " + name;\n}\n';
      fsModule.readFile.mockResolvedValue(code);

      const result = await analyzeFile("/test/hello.ts");

      expect(result.filePath).toBe("/test/hello.ts");
      expect(result.language).toBe("typescript");
      expect(result.lines).toBe(4);
      expect(result.exports.length).toBeGreaterThanOrEqual(1);
      expect(result.exports[0]?.name).toBe("hello");
    });

    it("should detect imports from import declarations", async () => {
      const code = 'import { z } from "zod";\nimport { foo } from "./foo.js";\n';
      fsModule.readFile.mockResolvedValue(code);

      const result = await analyzeFile("/test/bar.ts");

      expect(result.imports.length).toBe(2);
      expect(result.imports[0]?.source).toBe("zod");
      expect(result.imports[1]?.source).toBe("./foo.js");
    });

    it("should detect multiple import specifiers", async () => {
      const code = 'import { alpha, beta, gamma } from "my-lib";\n';
      fsModule.readFile.mockResolvedValue(code);

      const result = await analyzeFile("/test/multi.ts");

      expect(result.imports.length).toBe(1);
      expect(result.imports[0]?.items).toContain("alpha");
      expect(result.imports[0]?.items).toContain("beta");
      expect(result.imports[0]?.items).toContain("gamma");
    });

    it("should detect exported function declarations with line info", async () => {
      const code = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
      fsModule.readFile.mockResolvedValue(code);

      const result = await analyzeFile("/test/math.ts");

      const addFn = result.functions.find((f) => f.name === "add");
      expect(addFn).toBeDefined();
      expect(addFn?.exported).toBe(true);
      expect(addFn?.line).toBe(1);
    });

    it("should return language as javascript for .js files", async () => {
      fsModule.readFile.mockResolvedValue("function greet() {}\n");

      const result = await analyzeFile("/test/greet.js");

      expect(result.language).toBe("javascript");
    });

    it("should include AST when includeAst is true", async () => {
      fsModule.readFile.mockResolvedValue("const x = 1;\n");

      const result = await analyzeFile("/test/simple.ts", true);

      expect(result.ast).toBeDefined();
    });

    it("should not include AST when includeAst is false", async () => {
      fsModule.readFile.mockResolvedValue("const x = 1;\n");

      const result = await analyzeFile("/test/simple.ts", false);

      expect(result.ast).toBeUndefined();
    });

    it("should calculate complexity metrics", async () => {
      const code = "export function a() {}\nexport function b() {}\n";
      fsModule.readFile.mockResolvedValue(code);

      const result = await analyzeFile("/test/funcs.ts");

      expect(result.complexity).toBeDefined();
      expect(result.complexity.functions).toBeGreaterThanOrEqual(2);
      expect(result.complexity.cyclomatic).toBeGreaterThanOrEqual(4);
    });

    it("should fall back to regex analysis when AST parsing fails", async () => {
      fsModule.readFile.mockResolvedValue(
        "{{{{INVALID SYNTAX{{{{\nexport function rescue() {}\nimport { x } from 'y';",
      );

      const result = await analyzeFile("/test/broken.ts");

      expect(result.functions.length).toBeGreaterThanOrEqual(1);
      expect(result.functions[0]?.name).toBe("rescue");
    });

    it("should handle empty file", async () => {
      fsModule.readFile.mockResolvedValue("");

      const result = await analyzeFile("/test/empty.ts");

      expect(result.lines).toBe(1);
      expect(result.functions).toEqual([]);
      expect(result.classes).toEqual([]);
      expect(result.imports).toEqual([]);
      expect(result.exports).toEqual([]);
    });

    it("should handle file with only comments", async () => {
      fsModule.readFile.mockResolvedValue("// This is a comment\n/* Block comment */\n");

      const result = await analyzeFile("/test/comments.ts");

      expect(result.functions).toEqual([]);
      expect(result.imports).toEqual([]);
    });

    it("should count lines correctly", async () => {
      fsModule.readFile.mockResolvedValue("line1\nline2\nline3\nline4\nline5\n");

      const result = await analyzeFile("/test/lines.ts");

      expect(result.lines).toBe(6);
    });

    it("should compute avgFunctionLength as 0 when no functions", async () => {
      fsModule.readFile.mockResolvedValue("const x = 1;\n");

      const result = await analyzeFile("/test/no-funcs.ts");

      expect(result.complexity.avgFunctionLength).toBe(0);
    });

    it("should detect export type from function declarations", async () => {
      const code = "export function myFunc() {}\n";
      fsModule.readFile.mockResolvedValue(code);

      const result = await analyzeFile("/test/exp.ts");

      const exp = result.exports.find((e) => e.name === "myFunc");
      expect(exp).toBeDefined();
      expect(exp?.type).toBe("function");
    });
  });

  describe("analyzeDirectory", () => {
    it("should aggregate file stats across a directory", async () => {
      const { glob } = await import("glob");
      const mockGlob = glob as unknown as ReturnType<typeof vi.fn>;
      mockGlob.mockResolvedValue(["/dir/a.ts", "/dir/b.ts"]);

      fsModule.readFile.mockImplementation((filePath: string) => {
        if (filePath === "/dir/a.ts") return Promise.resolve("export function foo() {}\n");
        if (filePath === "/dir/b.ts")
          return Promise.resolve("export function bar() {}\nexport function baz() {}\n");
        return Promise.reject(new Error("File not found"));
      });

      const result = await analyzeDirectory("/dir");

      expect(result.totalFiles).toBe(2);
      expect(result.totalLines).toBeGreaterThanOrEqual(2);
      expect(result.largestFiles.length).toBeLessThanOrEqual(10);
      expect(result.mostComplex.length).toBeLessThanOrEqual(10);
    });

    it("should count files by type", async () => {
      const { glob } = await import("glob");
      const mockGlob = glob as unknown as ReturnType<typeof vi.fn>;
      mockGlob.mockResolvedValue(["/dir/a.ts", "/dir/b.js", "/dir/c.ts"]);

      fsModule.readFile.mockResolvedValue("const x = 1;\n");

      const result = await analyzeDirectory("/dir");

      expect(result.filesByType[".ts"]).toBe(2);
      expect(result.filesByType[".js"]).toBe(1);
    });

    it("should skip files that fail to analyze", async () => {
      const { glob } = await import("glob");
      const mockGlob = glob as unknown as ReturnType<typeof vi.fn>;
      mockGlob.mockResolvedValue(["/dir/good.ts", "/dir/bad.ts"]);

      fsModule.readFile.mockImplementation((filePath: string) => {
        if (filePath === "/dir/good.ts") return Promise.resolve("const x = 1;\n");
        return Promise.reject(new Error("Permission denied"));
      });

      const result = await analyzeDirectory("/dir");

      expect(result.totalFiles).toBe(2);
      expect(result.totalLines).toBeGreaterThanOrEqual(1);
    });

    it("should return empty results when no files match", async () => {
      const { glob } = await import("glob");
      const mockGlob = glob as unknown as ReturnType<typeof vi.fn>;
      mockGlob.mockResolvedValue([]);

      const result = await analyzeDirectory("/empty-dir");

      expect(result.totalFiles).toBe(0);
      expect(result.totalLines).toBe(0);
      expect(result.filesByType).toEqual({});
      expect(result.largestFiles).toEqual([]);
      expect(result.mostComplex).toEqual([]);
    });

    it("should sort largestFiles by lines descending", async () => {
      const { glob } = await import("glob");
      const mockGlob = glob as unknown as ReturnType<typeof vi.fn>;
      mockGlob.mockResolvedValue(["/dir/small.ts", "/dir/big.ts"]);

      fsModule.readFile.mockImplementation((filePath: string) => {
        if (filePath === "/dir/small.ts") return Promise.resolve("const x = 1;\n");
        if (filePath === "/dir/big.ts")
          return Promise.resolve(
            "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
          );
        return Promise.reject(new Error("Not found"));
      });

      const result = await analyzeDirectory("/dir");

      expect(result.largestFiles[0]?.lines).toBeGreaterThan(result.largestFiles[1]?.lines ?? 0);
    });
  });
});
