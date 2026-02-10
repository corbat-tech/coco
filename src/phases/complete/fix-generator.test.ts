import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the ast-validator module
vi.mock("../../tools/ast-validator.js", () => ({
  validateCode: vi.fn(),
}));

import { FixGenerator, createFixGenerator } from "./fix-generator.js";
import { validateCode } from "../../tools/ast-validator.js";
import type { LLMProvider } from "../../providers/types.js";
import type { FailureAnalysis } from "./test-analyzer.js";
import type { GeneratedFile } from "./types.js";

const mockedValidateCode = vi.mocked(validateCode);

function createMockLLM(chatResponses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    id: "mock",
    name: "Mock Provider",
    initialize: vi.fn(),
    chat: vi.fn().mockImplementation(async () => {
      const content = chatResponses[callIndex] ?? "// fixed code";
      callIndex++;
      return {
        id: "resp-1",
        content,
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "mock-model",
      };
    }),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn().mockReturnValue(10),
    getContextWindow: vi.fn().mockReturnValue(8192),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as LLMProvider;
}

function makeFile(path: string, content: string): GeneratedFile {
  return { path, content, action: "create" };
}

function makeAnalysis(failures: FailureAnalysis["failures"]): FailureAnalysis {
  return {
    failures,
    totalFailures: failures.length,
    highConfidenceCount: failures.filter((f) => f.confidence >= 70).length,
    summary: `${failures.length} failures`,
  };
}

describe("FixGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: validation always passes
    mockedValidateCode.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  describe("createFixGenerator", () => {
    it("should create a FixGenerator instance", () => {
      const llm = createMockLLM(["// code"]);
      const generator = createFixGenerator(llm);
      expect(generator).toBeInstanceOf(FixGenerator);
    });
  });

  describe("generateFixes", () => {
    it("should return original files when no failures match", async () => {
      const llm = createMockLLM([]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/utils.ts", "const x = 1;")];
      const analysis = makeAnalysis([
        {
          test: "someTest",
          location: { file: "src/other.ts", line: 10, column: 0 },
          rootCause: "Missing function",
          suggestedFix: "Add function",
          confidence: 80,
          affectedFiles: ["src/other.ts"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);

      expect(result.size).toBe(1);
      expect(result.get("src/utils.ts")?.content).toBe("const x = 1;");
      // LLM should not have been called
      expect(llm.chat).not.toHaveBeenCalled();
    });

    it("should fix file when failure matches by location", async () => {
      const fixedCode = 'export function greet() { return "hello"; }';
      const llm = createMockLLM([fixedCode]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/greet.ts", "export function greet() {}")];
      const analysis = makeAnalysis([
        {
          test: "greet test",
          location: { file: "src/greet.ts", line: 1, column: 0 },
          rootCause: "Function returns undefined",
          suggestedFix: 'Return "hello"',
          confidence: 90,
          affectedFiles: ["src/greet.ts"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);

      expect(result.get("src/greet.ts")?.content).toBe(fixedCode);
      expect(llm.chat).toHaveBeenCalledTimes(1);
    });

    it("should fix file when failure matches by affectedFiles", async () => {
      const fixedCode = "const x = 42;";
      const llm = createMockLLM([fixedCode]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/config.ts", "const x = null;")];
      const analysis = makeAnalysis([
        {
          test: "config test",
          location: { file: "src/other.ts", line: 5, column: 0 },
          rootCause: "Config value is null",
          suggestedFix: "Set default value",
          confidence: 75,
          affectedFiles: ["src/config.ts"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);

      expect(result.get("src/config.ts")?.content).toBe(fixedCode);
    });

    it("should keep original file if fix generation throws", async () => {
      const llm = createMockLLM([]);
      // Make chat throw an error
      vi.mocked(llm.chat).mockRejectedValue(new Error("LLM error"));
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/broken.ts", "original code")];
      const analysis = makeAnalysis([
        {
          test: "broken test",
          location: { file: "src/broken.ts", line: 1, column: 0 },
          rootCause: "Something broken",
          suggestedFix: "Fix it",
          confidence: 60,
          affectedFiles: ["src/broken.ts"],
        },
      ]);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await generator.generateFixes(files, analysis);
      consoleSpy.mockRestore();

      expect(result.get("src/broken.ts")?.content).toBe("original code");
    });

    it("should handle multiple files with some having failures", async () => {
      const llm = createMockLLM(["// fixed A"]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/a.ts", "// original A"), makeFile("src/b.ts", "// original B")];

      const analysis = makeAnalysis([
        {
          test: "test A",
          location: { file: "src/a.ts", line: 1, column: 0 },
          rootCause: "Bug in A",
          suggestedFix: "Fix A",
          confidence: 80,
          affectedFiles: ["src/a.ts"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);

      expect(result.get("src/a.ts")?.content).toBe("// fixed A");
      expect(result.get("src/b.ts")?.content).toBe("// original B");
    });
  });

  describe("extractCode (via generateFixes)", () => {
    it("should extract code from markdown code blocks", async () => {
      const llmResponse = "```typescript\nconst x = 42;\n```";
      const llm = createMockLLM([llmResponse]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/val.ts", "const x = 0;")];
      const analysis = makeAnalysis([
        {
          test: "val test",
          location: { file: "src/val.ts", line: 1, column: 0 },
          rootCause: "Wrong value",
          suggestedFix: "Change to 42",
          confidence: 95,
          affectedFiles: ["src/val.ts"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);
      expect(result.get("src/val.ts")?.content).toBe("const x = 42;");
    });

    it("should extract code from javascript code blocks", async () => {
      const llmResponse = "```javascript\nfunction add(a, b) { return a + b; }\n```";
      const llm = createMockLLM([llmResponse]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/math.js", "function add() {}")];
      const analysis = makeAnalysis([
        {
          test: "add test",
          location: { file: "src/math.js", line: 1, column: 0 },
          rootCause: "Missing params",
          suggestedFix: "Add params",
          confidence: 90,
          affectedFiles: ["src/math.js"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);
      expect(result.get("src/math.js")?.content).toBe("function add(a, b) { return a + b; }");
    });

    it("should use raw response when no code blocks present", async () => {
      const llmResponse = "const raw = true;";
      const llm = createMockLLM([llmResponse]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/raw.ts", "const raw = false;")];
      const analysis = makeAnalysis([
        {
          test: "raw test",
          location: { file: "src/raw.ts", line: 1, column: 0 },
          rootCause: "Wrong boolean",
          suggestedFix: "Set true",
          confidence: 100,
          affectedFiles: ["src/raw.ts"],
        },
      ]);

      const result = await generator.generateFixes(files, analysis);
      expect(result.get("src/raw.ts")?.content).toBe("const raw = true;");
    });
  });

  describe("buildFixPrompt (via LLM call inspection)", () => {
    it("should include failure details in the prompt", async () => {
      const llm = createMockLLM(["// fixed"]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/target.ts", "let x;")];
      const analysis = makeAnalysis([
        {
          test: "target test",
          location: { file: "src/target.ts", line: 5, column: 3, function: "init" },
          rootCause: "Undefined variable access",
          suggestedFix: "Initialize x = 0",
          confidence: 85,
          affectedFiles: ["src/target.ts"],
        },
      ]);

      await generator.generateFixes(files, analysis);

      const callArgs = vi.mocked(llm.chat).mock.calls[0]?.[0];
      const userMessage = callArgs?.find((m) => m.role === "user");
      const userContent = userMessage?.content as string;

      expect(userContent).toContain("target test");
      expect(userContent).toContain("Line 5");
      expect(userContent).toContain("init");
      expect(userContent).toContain("Undefined variable access");
      expect(userContent).toContain("Initialize x = 0");
      expect(userContent).toContain("85%");
      expect(userContent).toContain("let x;");
    });

    it("should include attempt note on retry", async () => {
      // First attempt: invalid code; second attempt: valid code
      const llm = createMockLLM(["invalid{{{", "// valid fix"]);
      const generator = new FixGenerator(llm);

      mockedValidateCode
        .mockResolvedValueOnce({
          valid: false,
          errors: [{ line: 1, column: 1, message: "Unexpected token" }],
          warnings: [],
        })
        .mockResolvedValueOnce({
          valid: true,
          errors: [],
          warnings: [],
        });

      const files = [makeFile("src/retry.ts", "original code")];
      const analysis = makeAnalysis([
        {
          test: "retry test",
          location: { file: "src/retry.ts", line: 1, column: 0 },
          rootCause: "Bug",
          suggestedFix: "Fix",
          confidence: 70,
          affectedFiles: ["src/retry.ts"],
        },
      ]);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await generator.generateFixes(files, analysis);
      consoleSpy.mockRestore();

      // The second call should include attempt note
      expect(llm.chat).toHaveBeenCalledTimes(2);
      const secondCallArgs = vi.mocked(llm.chat).mock.calls[1]?.[0];
      const userMessage = secondCallArgs?.find((m) => m.role === "user");
      const content = userMessage?.content as string;
      expect(content).toContain("attempt 2");
    });
  });

  describe("max retry logic", () => {
    it("should return original file after 3 failed validation attempts", async () => {
      const llm = createMockLLM(["bad1{", "bad2{", "bad3{"]);
      const generator = new FixGenerator(llm);

      mockedValidateCode.mockResolvedValue({
        valid: false,
        errors: [{ line: 1, column: 1, message: "Syntax error" }],
        warnings: [],
      });

      const files = [makeFile("src/unfixable.ts", "original content")];
      const analysis = makeAnalysis([
        {
          test: "unfixable test",
          location: { file: "src/unfixable.ts", line: 1, column: 0 },
          rootCause: "Deep issue",
          suggestedFix: "Major refactor needed",
          confidence: 50,
          affectedFiles: ["src/unfixable.ts"],
        },
      ]);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await generator.generateFixes(files, analysis);
      consoleSpy.mockRestore();

      // Should return the original file after max attempts
      expect(result.get("src/unfixable.ts")?.content).toBe("original content");
      // Should have called LLM exactly 3 times (maxFixAttempts)
      expect(llm.chat).toHaveBeenCalledTimes(3);
    });

    it("should succeed on second attempt when validation passes", async () => {
      const llm = createMockLLM(["bad{", "const good = true;"]);
      const generator = new FixGenerator(llm);

      mockedValidateCode
        .mockResolvedValueOnce({
          valid: false,
          errors: [{ line: 1, column: 1, message: "Parse error" }],
          warnings: [],
        })
        .mockResolvedValueOnce({
          valid: true,
          errors: [],
          warnings: [],
        });

      const files = [makeFile("src/fixable.ts", "const bad = false;")];
      const analysis = makeAnalysis([
        {
          test: "fixable test",
          location: { file: "src/fixable.ts", line: 1, column: 0 },
          rootCause: "Incorrect value",
          suggestedFix: "Set true",
          confidence: 85,
          affectedFiles: ["src/fixable.ts"],
        },
      ]);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await generator.generateFixes(files, analysis);
      consoleSpy.mockRestore();

      expect(result.get("src/fixable.ts")?.content).toBe("const good = true;");
      expect(llm.chat).toHaveBeenCalledTimes(2);
    });
  });

  describe("language detection for validation", () => {
    it("should detect typescript for .ts files", async () => {
      const llm = createMockLLM(["// ts code"]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/file.ts", "code")];
      const analysis = makeAnalysis([
        {
          test: "test",
          location: { file: "src/file.ts", line: 1, column: 0 },
          rootCause: "Bug",
          suggestedFix: "Fix",
          confidence: 80,
          affectedFiles: ["src/file.ts"],
        },
      ]);

      await generator.generateFixes(files, analysis);
      expect(mockedValidateCode).toHaveBeenCalledWith("// ts code", "src/file.ts", "typescript");
    });

    it("should detect typescript for .tsx files", async () => {
      const llm = createMockLLM(["// tsx code"]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/Component.tsx", "code")];
      const analysis = makeAnalysis([
        {
          test: "test",
          location: { file: "src/Component.tsx", line: 1, column: 0 },
          rootCause: "Bug",
          suggestedFix: "Fix",
          confidence: 80,
          affectedFiles: ["src/Component.tsx"],
        },
      ]);

      await generator.generateFixes(files, analysis);
      expect(mockedValidateCode).toHaveBeenCalledWith(
        "// tsx code",
        "src/Component.tsx",
        "typescript",
      );
    });

    it("should detect javascript for .js files", async () => {
      const llm = createMockLLM(["// js code"]);
      const generator = new FixGenerator(llm);

      const files = [makeFile("src/file.js", "code")];
      const analysis = makeAnalysis([
        {
          test: "test",
          location: { file: "src/file.js", line: 1, column: 0 },
          rootCause: "Bug",
          suggestedFix: "Fix",
          confidence: 80,
          affectedFiles: ["src/file.js"],
        },
      ]);

      await generator.generateFixes(files, analysis);
      expect(mockedValidateCode).toHaveBeenCalledWith("// js code", "src/file.js", "javascript");
    });
  });
});
