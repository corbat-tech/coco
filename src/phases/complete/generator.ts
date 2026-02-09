/**
 * Code Generator for the COMPLETE phase
 *
 * Generates code based on task requirements
 */

import type { CodeGenerationRequest, CodeGenerationResponse, GeneratedFile } from "./types.js";
import type { LLMProvider } from "../../providers/types.js";
import {
  CODE_GENERATION_SYSTEM_PROMPT,
  GENERATE_CODE_PROMPT,
  IMPROVE_CODE_PROMPT,
  GENERATE_TESTS_PROMPT,
  fillPrompt,
  buildPreviousCodeSection,
  buildFeedbackSection,
} from "./prompts.js";
import { PhaseError } from "../../utils/errors.js";
import { validateCode, findMissingImports } from "../../tools/ast-validator.js";

/**
 * Code Generator
 */
export class CodeGenerator {
  private llm: LLMProvider;
  private maxValidationRetries = 3;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Generate initial code for a task
   */
  async generate(request: CodeGenerationRequest): Promise<CodeGenerationResponse> {
    const previousCodeSection = buildPreviousCodeSection(request.previousCode);
    const feedbackSection = buildFeedbackSection(request.feedback);

    const prompt = fillPrompt(GENERATE_CODE_PROMPT, {
      taskTitle: request.task.title,
      taskDescription: request.task.description,
      taskType: request.task.type,
      expectedFiles: JSON.stringify(request.task.files),
      projectContext: request.context,
      previousCodeSection,
      feedbackSection,
    });

    const response = await this.llm.chat([
      { role: "system", content: CODE_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    const generatedResponse = this.parseGenerationResponse(response.content);

    // NEW: Validate and fix syntax errors before returning
    const validatedFiles = await this.validateAndFixFiles(generatedResponse.files);

    return {
      ...generatedResponse,
      files: validatedFiles,
    };
  }

  /**
   * Improve existing code based on feedback
   */
  async improve(
    currentCode: string,
    issues: Array<{ severity: string; message: string; suggestion?: string }>,
    suggestions: Array<{ description: string; priority: string }>,
    request: CodeGenerationRequest,
  ): Promise<CodeGenerationResponse> {
    const prompt = fillPrompt(IMPROVE_CODE_PROMPT, {
      taskTitle: request.task.title,
      iteration: request.iteration,
      currentCode,
      currentScore: 0, // Would be passed in
      issueCount: issues.length,
      criticalIssues: issues.filter((i) => i.severity === "critical").length,
      issues: JSON.stringify(issues),
      suggestions: JSON.stringify(suggestions),
    });

    const response = await this.llm.chat([
      { role: "system", content: CODE_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    return this.parseImprovementResponse(response.content);
  }

  /**
   * Validate generated files and auto-fix syntax errors
   */
  private async validateAndFixFiles(files: GeneratedFile[]): Promise<GeneratedFile[]> {
    const validatedFiles: GeneratedFile[] = [];

    for (const file of files) {
      let validatedFile = file;
      let retries = 0;

      // Skip non-TS/JS files
      const isCodeFile =
        file.path.endsWith(".ts") ||
        file.path.endsWith(".tsx") ||
        file.path.endsWith(".js") ||
        file.path.endsWith(".jsx");

      if (!isCodeFile) {
        validatedFiles.push(file);
        continue;
      }

      // Validate and retry up to maxValidationRetries times
      while (retries < this.maxValidationRetries) {
        const language =
          file.path.endsWith(".ts") || file.path.endsWith(".tsx") ? "typescript" : "javascript";
        const validation = await validateCode(validatedFile.content, validatedFile.path, language);

        if (validation.valid) {
          // Check for missing imports
          const missingImports = findMissingImports(validatedFile.content, validatedFile.path);
          if (missingImports.length > 0) {
            // Add warning but don't fail
            console.warn(
              `[Generator] File ${validatedFile.path} may be missing imports: ${missingImports.join(", ")}`,
            );
          }
          break;
        }

        // Has syntax errors - ask LLM to fix
        retries++;
        console.warn(
          `[Generator] Syntax errors in ${validatedFile.path} (attempt ${retries}/${this.maxValidationRetries})`,
        );

        if (retries >= this.maxValidationRetries) {
          throw new PhaseError(
            `Failed to generate valid code for ${validatedFile.path} after ${this.maxValidationRetries} attempts. Errors: ${validation.errors.map((e) => e.message).join("; ")}`,
            { phase: "complete" },
          );
        }

        // Try to fix the syntax errors
        try {
          const fixedContent = await this.fixSyntaxErrors(validatedFile, validation.errors);
          validatedFile = { ...validatedFile, content: fixedContent };
        } catch (error) {
          throw new PhaseError(
            `Failed to fix syntax errors in ${validatedFile.path}: ${error instanceof Error ? error.message : String(error)}`,
            { phase: "complete" },
          );
        }
      }

      validatedFiles.push(validatedFile);
    }

    return validatedFiles;
  }

  /**
   * Fix syntax errors using LLM
   */
  private async fixSyntaxErrors(
    file: GeneratedFile,
    errors: Array<{ line: number; column: number; message: string }>,
  ): Promise<string> {
    const errorMessages = errors
      .map((e) => `Line ${e.line}, Column ${e.column}: ${e.message}`)
      .join("\n");

    const fixPrompt = `Fix the following syntax errors in this TypeScript/JavaScript code:

Syntax Errors:
${errorMessages}

Original Code:
\`\`\`${file.path.endsWith(".ts") || file.path.endsWith(".tsx") ? "typescript" : "javascript"}
${file.content}
\`\`\`

Return ONLY the fixed code, no explanations or markdown. The code must be syntactically valid.`;

    const response = await this.llm.chat([
      {
        role: "system",
        content:
          "You are a code fixing expert. Fix syntax errors and return only valid code without any markdown formatting or explanations.",
      },
      { role: "user", content: fixPrompt },
    ]);

    // Extract code from response (remove markdown if present)
    let fixedCode = response.content.trim();

    // Remove markdown code blocks if present
    const codeBlockRegex = /```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)```/;
    const match = fixedCode.match(codeBlockRegex);
    if (match?.[1]) {
      fixedCode = match[1].trim();
    }

    return fixedCode;
  }

  /**
   * Generate tests for existing code
   */
  async generateTests(
    codeToTest: string,
    targetCoverage: number,
    currentCoverage: { lines: number; branches: number; functions: number },
  ): Promise<GeneratedFile[]> {
    const prompt = fillPrompt(GENERATE_TESTS_PROMPT, {
      codeToTest,
      targetCoverage,
      lineCoverage: currentCoverage.lines,
      branchCoverage: currentCoverage.branches,
      functionCoverage: currentCoverage.functions,
    });

    const response = await this.llm.chat([
      { role: "system", content: CODE_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        testFiles?: Array<{
          path?: string;
          content?: string;
        }>;
      };

      return (parsed.testFiles || []).map((f) => ({
        path: f.path || "test.ts",
        content: f.content || "",
        action: "create" as const,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Parse generation response from LLM
   */
  private parseGenerationResponse(content: string): CodeGenerationResponse {
    try {
      // Limit content length to prevent ReDoS with [\s\S]* pattern
      const limitedContent = content.substring(0, 50000);
      const jsonMatch = limitedContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        files?: Array<{
          path?: string;
          content?: string;
          action?: string;
        }>;
        explanation?: string;
        confidence?: number;
      };

      return {
        files: (parsed.files || []).map((f) => ({
          path: f.path || "file.ts",
          content: f.content || "",
          action: (f.action as GeneratedFile["action"]) || "create",
        })),
        explanation: parsed.explanation || "",
        confidence: parsed.confidence || 50,
      };
    } catch {
      throw new PhaseError("Failed to parse code generation response", { phase: "complete" });
    }
  }

  /**
   * Parse improvement response from LLM
   */
  private parseImprovementResponse(content: string): CodeGenerationResponse {
    try {
      // Limit content length to prevent ReDoS with [\s\S]* pattern
      const limitedContent = content.substring(0, 50000);
      const jsonMatch = limitedContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        files?: Array<{
          path?: string;
          content?: string;
          action?: string;
        }>;
        changesApplied?: string[];
        explanation?: string;
        confidence?: number;
      };

      return {
        files: (parsed.files || []).map((f) => ({
          path: f.path || "file.ts",
          content: f.content || "",
          action: (f.action as GeneratedFile["action"]) || "modify",
        })),
        explanation: parsed.explanation || (parsed.changesApplied || []).join(", "),
        confidence: parsed.confidence || 50,
      };
    } catch {
      throw new PhaseError("Failed to parse improvement response", { phase: "complete" });
    }
  }
}

/**
 * Create a code generator
 */
export function createCodeGenerator(llm: LLMProvider): CodeGenerator {
  return new CodeGenerator(llm);
}
