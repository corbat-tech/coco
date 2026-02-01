/**
 * Tests for code generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../providers/index.js", () => ({
  createProvider: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        files: [
          { path: "src/user.ts", content: "export class User {}", action: "create" },
          { path: "src/user.test.ts", content: "test code", action: "create" },
        ],
        explanation: "Created User class with tests",
        confidence: 85,
      }),
    }),
  }),
}));

describe("CodeGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generate", () => {
    it("should generate code from task", async () => {
      const { CodeGenerator } = await import("./generator.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            files: [
              { path: "src/user.ts", content: "export class User {}", action: "create" },
            ],
            explanation: "Created User class",
            confidence: 85,
          }),
        }),
      };

      const generator = new CodeGenerator(mockLLM as any);
      const response = await generator.generate({
        task: {
          id: "task-1",
          title: "Create User Model",
          description: "Create a User model with validation",
          type: "feature",
          files: ["src/user.ts"],
        },
        context: "TypeScript project with Zod validation",
        iteration: 0,
      } as any);

      expect(response.files).toBeDefined();
      expect(response.files.length).toBeGreaterThan(0);
      expect(response.explanation).toBeDefined();
    });

    it("should include previous code context when iterating", async () => {
      const { CodeGenerator } = await import("./generator.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            files: [{ path: "src/user.ts", content: "improved", action: "modify" }],
            explanation: "Improved",
            confidence: 90,
          }),
        }),
      };

      const generator = new CodeGenerator(mockLLM as any);
      await generator.generate({
        task: {
          id: "task-1",
          title: "Improve User Model",
          description: "Add email validation",
          type: "feature",
          files: ["src/user.ts"],
        },
        context: "TypeScript project",
        previousCode: "export class User {}",
        feedback: "Add email validation",
        iteration: 1,
      } as any);

      expect(mockLLM.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ])
      );
    });
  });

  describe("improve", () => {
    it("should improve code based on issues", async () => {
      const { CodeGenerator } = await import("./generator.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            files: [
              { path: "src/user.ts", content: "improved code", action: "modify" },
            ],
            changesApplied: ["Added validation", "Fixed error handling"],
            confidence: 90,
          }),
        }),
      };

      const generator = new CodeGenerator(mockLLM as any);
      const response = await generator.improve(
        "export class User {}",
        [
          { severity: "major", message: "Missing validation", suggestion: "Add email validation" },
        ],
        [
          { description: "Add input sanitization", priority: "high" },
        ],
        {
          task: { id: "task-1", title: "Fix User", description: "Fix", type: "fix", files: [] },
          context: "TypeScript",
          previousCode: "export class User {}",
          iteration: 2,
        } as any
      );

      expect(response.files).toBeDefined();
      expect(response.files[0]?.content).toBe("improved code");
    });
  });

  describe("generateTests", () => {
    it("should generate tests for code", async () => {
      const { CodeGenerator } = await import("./generator.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            testFiles: [
              { path: "src/user.test.ts", content: "describe('User', () => { it('works', () => {}) })" },
            ],
          }),
        }),
      };

      const generator = new CodeGenerator(mockLLM as any);
      const tests = await generator.generateTests(
        "export class User { constructor(public name: string) {} }",
        80,
        { lines: 50, branches: 40, functions: 60 }
      );

      expect(tests).toBeDefined();
      expect(tests.length).toBeGreaterThan(0);
      expect(tests[0]?.path).toContain("test");
    });

    it("should return empty array if parsing fails", async () => {
      const { CodeGenerator } = await import("./generator.js");

      const mockLLM = {
        chat: vi.fn().mockResolvedValue({
          content: "Invalid JSON response",
        }),
      };

      const generator = new CodeGenerator(mockLLM as any);
      const tests = await generator.generateTests("code", 80, { lines: 0, branches: 0, functions: 0 });

      expect(tests).toEqual([]);
    });
  });
});

describe("createCodeGenerator", () => {
  it("should create a CodeGenerator instance", async () => {
    const { createCodeGenerator } = await import("./generator.js");

    const mockLLM = { chat: vi.fn() };
    const generator = createCodeGenerator(mockLLM as any);

    expect(generator).toBeDefined();
  });
});
