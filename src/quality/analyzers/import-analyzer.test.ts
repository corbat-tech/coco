/**
 * Tests for ImportAnalyzer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportAnalyzer, createImportAnalyzer } from "./import-analyzer.js";
import type { GeneratedFile } from "../../phases/complete/types.js";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
}));

// Mock @typescript-eslint/typescript-estree
vi.mock("@typescript-eslint/typescript-estree", () => ({
  parse: vi.fn(),
}));

const fs = vi.mocked(await import("node:fs/promises"));
const { parse: mockParse } = vi.mocked(await import("@typescript-eslint/typescript-estree"));

describe("ImportAnalyzer", () => {
  let analyzer: ImportAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    analyzer = new ImportAnalyzer("/project");
  });

  describe("analyzeImports", () => {
    it("should extract static imports from code files", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import { z } from "zod";\nconst schema = z.object({});',
          action: "create",
        },
      ];

      // Mock AST parse to return import declaration
      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "zod" },
            specifiers: [
              { type: "ImportSpecifier", local: { name: "z" }, imported: { name: "z" } },
            ],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      // Mock package.json with zod installed
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: { zod: "^3.0.0" },
        }),
      );

      const result = await analyzer.analyzeImports(files);

      expect(result.imports.length).toBeGreaterThanOrEqual(1);
      expect(result.imports[0]?.source).toBe("zod");
      expect(result.imports[0]?.specifiers).toContain("z");
    });

    it("should detect missing dependencies", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import express from "express";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "express" },
            specifiers: [
              { type: "ImportDefaultSpecifier", local: { name: "express" } },
            ],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      // package.json without express
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {},
          devDependencies: {},
        }),
      );

      const result = await analyzer.analyzeImports(files);

      expect(result.missingDependencies).toContain("express");
    });

    it("should not report relative imports as missing dependencies", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import { helper } from "./utils.js";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "./utils.js" },
            specifiers: [
              { type: "ImportSpecifier", local: { name: "helper" }, imported: { name: "helper" } },
            ],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      expect(result.missingDependencies).not.toContain("./utils.js");
    });

    it("should handle scoped packages correctly", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import { z } from "@scope/package/subpath";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "@scope/package/subpath" },
            specifiers: [
              { type: "ImportSpecifier", local: { name: "z" }, imported: { name: "z" } },
            ],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      // package.json with the scoped package installed
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          dependencies: { "@scope/package": "^1.0.0" },
        }),
      );

      const result = await analyzer.analyzeImports(files);

      // Should extract @scope/package from @scope/package/subpath
      expect(result.missingDependencies).not.toContain("@scope/package");
    });

    it("should report scoped package as missing when not installed", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import { x } from "@myorg/utils";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "@myorg/utils" },
            specifiers: [
              { type: "ImportSpecifier", local: { name: "x" }, imported: { name: "x" } },
            ],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      expect(result.missingDependencies).toContain("@myorg/utils");
    });

    it("should skip non-code files", async () => {
      const files: GeneratedFile[] = [
        { path: "README.md", content: "# Hello", action: "create" },
        { path: "data.json", content: "{}", action: "create" },
      ];

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      expect(result.imports).toEqual([]);
      expect(mockParse).not.toHaveBeenCalled();
    });

    it("should detect type-only imports", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/types.ts",
          content: 'import type { Config } from "./config.js";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "./config.js" },
            specifiers: [
              { type: "ImportSpecifier", local: { name: "Config" }, imported: { name: "Config" } },
            ],
            importKind: "type",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      expect(result.imports[0]?.isTypeOnly).toBe(true);
    });

    it("should handle package.json read failure gracefully", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import { z } from "zod";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "zod" },
            specifiers: [
              { type: "ImportSpecifier", local: { name: "z" }, imported: { name: "z" } },
            ],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      // package.json read fails
      fs.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await analyzer.analyzeImports(files);

      // zod should be reported as missing since package.json can't be read
      expect(result.missingDependencies).toContain("zod");
    });

    it("should handle parse failure gracefully", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/broken.ts",
          content: "{{invalid syntax}}",
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Parse error");
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      // Should not crash, just return empty imports
      expect(result.imports).toEqual([]);
    });
  });

  describe("detectCircularDependencies", () => {
    it("should detect a simple A -> B -> A cycle", async () => {
      const files: GeneratedFile[] = [
        {
          path: "/project/src/a.ts",
          content: 'import { b } from "./b.js";',
          action: "create",
        },
        {
          path: "/project/src/b.ts",
          content: 'import { a } from "./a.js";',
          action: "create",
        },
      ];

      let callCount = 0;
      (mockParse as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // First file: a.ts imports from ./b.js
          return {
            type: "Program",
            body: [
              {
                type: "ImportDeclaration",
                source: { value: "./b.js" },
                specifiers: [
                  { type: "ImportSpecifier", local: { name: "b" }, imported: { name: "b" } },
                ],
                importKind: "value",
                loc: { start: { line: 1, column: 0 } },
              },
            ],
          };
        }
        // Second file: b.ts imports from ./a.js
        return {
          type: "Program",
          body: [
            {
              type: "ImportDeclaration",
              source: { value: "./a.js" },
              specifiers: [
                { type: "ImportSpecifier", local: { name: "a" }, imported: { name: "a" } },
              ],
              importKind: "value",
              loc: { start: { line: 1, column: 0 } },
            },
          ],
        };
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      expect(result.circularDependencies.length).toBeGreaterThanOrEqual(1);
    });

    it("should not report false positives for linear dependencies", async () => {
      const files: GeneratedFile[] = [
        {
          path: "/project/src/a.ts",
          content: 'import { b } from "./b.js";',
          action: "create",
        },
        {
          path: "/project/src/b.ts",
          content: "export const b = 1;",
          action: "create",
        },
      ];

      let callCount = 0;
      (mockParse as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return {
            type: "Program",
            body: [
              {
                type: "ImportDeclaration",
                source: { value: "./b.js" },
                specifiers: [
                  { type: "ImportSpecifier", local: { name: "b" }, imported: { name: "b" } },
                ],
                importKind: "value",
                loc: { start: { line: 1, column: 0 } },
              },
            ],
          };
        }
        // b.ts has no imports
        return { type: "Program", body: [] };
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      expect(result.circularDependencies).toEqual([]);
    });

    it("should classify short cycles as errors", async () => {
      const files: GeneratedFile[] = [
        {
          path: "/project/src/a.ts",
          content: 'import { b } from "./b.js";',
          action: "create",
        },
        {
          path: "/project/src/b.ts",
          content: 'import { a } from "./a.js";',
          action: "create",
        },
      ];

      let callCount = 0;
      (mockParse as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return {
            type: "Program",
            body: [
              {
                type: "ImportDeclaration",
                source: { value: "./b.js" },
                specifiers: [],
                importKind: "value",
                loc: { start: { line: 1, column: 0 } },
              },
            ],
          };
        }
        return {
          type: "Program",
          body: [
            {
              type: "ImportDeclaration",
              source: { value: "./a.js" },
              specifiers: [],
              importKind: "value",
              loc: { start: { line: 1, column: 0 } },
            },
          ],
        };
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      for (const cycle of result.circularDependencies) {
        if (cycle.cycle.length <= 4) {
          // short cycles (3 nodes = 2 edges) are errors
          expect(cycle.severity).toBe("error");
        }
      }
    });
  });

  describe("generateSuggestions", () => {
    it("should suggest installing missing dependencies", async () => {
      const files: GeneratedFile[] = [
        {
          path: "src/app.ts",
          content: 'import express from "express";',
          action: "create",
        },
      ];

      (mockParse as ReturnType<typeof vi.fn>).mockReturnValue({
        type: "Program",
        body: [
          {
            type: "ImportDeclaration",
            source: { value: "express" },
            specifiers: [{ type: "ImportDefaultSpecifier", local: { name: "express" } }],
            importKind: "value",
            loc: { start: { line: 1, column: 0 } },
          },
        ],
      });

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: {} }));

      const result = await analyzer.analyzeImports(files);

      const installSuggestion = result.suggestions.find(
        (s) => s.action === "install" && s.package === "express",
      );
      expect(installSuggestion).toBeDefined();
      expect(installSuggestion?.version).toBe("latest");
    });
  });

  describe("autoFix", () => {
    it("should add missing dependencies to package.json", async () => {
      const analysis = {
        imports: [],
        missingDependencies: ["lodash", "express"],
        unusedImports: [],
        circularDependencies: [],
        suggestions: [],
      };

      fs.readFile.mockResolvedValue(JSON.stringify({ dependencies: { zod: "^3.0.0" } }));
      fs.writeFile.mockResolvedValue(undefined);

      await analyzer.autoFix(analysis);

      expect(fs.writeFile).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string,
      );
      expect(writtenContent.dependencies.lodash).toBe("latest");
      expect(writtenContent.dependencies.express).toBe("latest");
      expect(writtenContent.dependencies.zod).toBe("^3.0.0");
    });

    it("should handle empty missingDependencies gracefully", async () => {
      const analysis = {
        imports: [],
        missingDependencies: [],
        unusedImports: [],
        circularDependencies: [],
        suggestions: [],
      };

      await analyzer.autoFix(analysis);

      // Should not attempt to write
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle package.json read failure during autoFix", async () => {
      const analysis = {
        imports: [],
        missingDependencies: ["lodash"],
        unusedImports: [],
        circularDependencies: [],
        suggestions: [],
      };

      fs.readFile.mockRejectedValue(new Error("ENOENT"));

      // Should not throw
      await expect(analyzer.autoFix(analysis)).resolves.toBeUndefined();
    });
  });

  describe("createImportAnalyzer", () => {
    it("should create an ImportAnalyzer instance", () => {
      const ia = createImportAnalyzer("/my-project");
      expect(ia).toBeInstanceOf(ImportAnalyzer);
    });
  });
});
