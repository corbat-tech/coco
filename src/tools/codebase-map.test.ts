/**
 * Tests for codebase map tool
 */

import { describe, it, expect, vi } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("codebase-map", () => {
  describe("detectLanguage", () => {
    it("should detect TypeScript files", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("file.ts")).toBe("typescript");
      expect(detectLanguage("file.tsx")).toBe("typescript");
      expect(detectLanguage("file.mts")).toBe("typescript");
    });

    it("should detect JavaScript files", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("file.js")).toBe("javascript");
      expect(detectLanguage("file.jsx")).toBe("javascript");
      expect(detectLanguage("file.mjs")).toBe("javascript");
    });

    it("should detect Python files", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("file.py")).toBe("python");
    });

    it("should detect Java files", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("File.java")).toBe("java");
    });

    it("should detect Go files", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("main.go")).toBe("go");
    });

    it("should detect Rust files", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("lib.rs")).toBe("rust");
    });

    it("should return null for unknown extensions", async () => {
      const { detectLanguage } = await import("./codebase-map.js");
      expect(detectLanguage("file.txt")).toBeNull();
      expect(detectLanguage("file.md")).toBeNull();
    });
  });

  describe("parseTypeScript", () => {
    it("should parse exported functions", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `export function hello(name: string): string {\n  return name;\n}`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].name).toBe("hello");
      expect(result.definitions[0].type).toBe("function");
      expect(result.definitions[0].exported).toBe(true);
    });

    it("should parse exported classes", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `export class UserService {\n  getData() {}\n}`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].name).toBe("UserService");
      expect(result.definitions[0].type).toBe("class");
      expect(result.definitions[0].exported).toBe(true);
    });

    it("should parse interfaces", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `export interface User {\n  name: string;\n}`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].name).toBe("User");
      expect(result.definitions[0].type).toBe("interface");
    });

    it("should parse type aliases", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `export type UserId = string;`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].name).toBe("UserId");
      expect(result.definitions[0].type).toBe("type");
    });

    it("should parse enums", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `export enum Status {\n  Active,\n  Inactive\n}`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].name).toBe("Status");
      expect(result.definitions[0].type).toBe("enum");
    });

    it("should parse const arrow functions as functions", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `export const greet = (name: string) => name;`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].name).toBe("greet");
      expect(result.definitions[0].type).toBe("function");
    });

    it("should parse imports", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `import { z } from "zod";\nimport path from "node:path";`;
      const result = parseTypeScript(code);
      expect(result.imports).toContain("zod");
      expect(result.imports).toContain("node:path");
    });

    it("should detect non-exported definitions", async () => {
      const { parseTypeScript } = await import("./codebase-map.js");
      const code = `function helper() {}\nclass Internal {}`;
      const result = parseTypeScript(code);
      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].exported).toBe(false);
      expect(result.definitions[1].exported).toBe(false);
    });
  });

  describe("parsePython", () => {
    it("should parse classes and functions", async () => {
      const { parsePython } = await import("./codebase-map.js");
      const code = `class UserService:\n  pass\n\ndef get_user(id):\n  pass\n\nasync def fetch_data():\n  pass`;
      const result = parsePython(code);
      expect(result.definitions).toHaveLength(3);
      expect(result.definitions[0].name).toBe("UserService");
      expect(result.definitions[0].type).toBe("class");
      expect(result.definitions[1].name).toBe("get_user");
      expect(result.definitions[1].type).toBe("function");
      expect(result.definitions[2].name).toBe("fetch_data");
    });

    it("should detect private definitions (underscore prefix)", async () => {
      const { parsePython } = await import("./codebase-map.js");
      const code = `def _private_func():\n  pass\n\ndef public_func():\n  pass`;
      const result = parsePython(code);
      expect(result.definitions[0].exported).toBe(false);
      expect(result.definitions[1].exported).toBe(true);
    });

    it("should parse constants", async () => {
      const { parsePython } = await import("./codebase-map.js");
      const code = `MAX_RETRIES = 3\nDEFAULT_TIMEOUT = 30`;
      const result = parsePython(code);
      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].type).toBe("const");
    });
  });

  describe("parseGo", () => {
    it("should parse functions", async () => {
      const { parseGo } = await import("./codebase-map.js");
      const code = `func HandleRequest(w http.ResponseWriter, r *http.Request) {\n}\n\nfunc helper() {\n}`;
      const result = parseGo(code);
      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].name).toBe("HandleRequest");
      expect(result.definitions[0].exported).toBe(true);
      expect(result.definitions[1].name).toBe("helper");
      expect(result.definitions[1].exported).toBe(false);
    });

    it("should parse structs and interfaces", async () => {
      const { parseGo } = await import("./codebase-map.js");
      const code = `type User struct {\n  Name string\n}\n\ntype Service interface {\n  Get() error\n}`;
      const result = parseGo(code);
      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].name).toBe("User");
      expect(result.definitions[0].type).toBe("class");
      expect(result.definitions[1].name).toBe("Service");
      expect(result.definitions[1].type).toBe("interface");
    });
  });

  describe("parseRust", () => {
    it("should parse pub functions", async () => {
      const { parseRust } = await import("./codebase-map.js");
      const code = `pub fn new() -> Self {\n}\n\nfn private_helper() {\n}`;
      const result = parseRust(code);
      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].exported).toBe(true);
      expect(result.definitions[1].exported).toBe(false);
    });

    it("should parse structs, enums, traits", async () => {
      const { parseRust } = await import("./codebase-map.js");
      const code = `pub struct Config {\n}\n\npub enum Status {\n}\n\npub trait Handler {\n}`;
      const result = parseRust(code);
      expect(result.definitions).toHaveLength(3);
      expect(result.definitions[0].type).toBe("class");
      expect(result.definitions[1].type).toBe("enum");
      expect(result.definitions[2].type).toBe("interface");
    });
  });

  describe("codebaseMapTool", () => {
    it("should have correct metadata", async () => {
      const { codebaseMapTool } = await import("./codebase-map.js");
      expect(codebaseMapTool.name).toBe("codebase_map");
      expect(codebaseMapTool.category).toBe("search");
    });

    it("should validate parameters", async () => {
      const { codebaseMapTool } = await import("./codebase-map.js");

      const valid = codebaseMapTool.parameters.safeParse({});
      expect(valid.success).toBe(true);

      const withLanguages = codebaseMapTool.parameters.safeParse({
        languages: ["typescript", "python"],
      });
      expect(withLanguages.success).toBe(true);
    });
  });
});
