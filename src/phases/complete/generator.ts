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

/**
 * Code Generator
 */
export class CodeGenerator {
  private llm: LLMProvider;

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

    return this.parseGenerationResponse(response.content);
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
