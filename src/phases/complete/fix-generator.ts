/**
 * Fix Generator
 * Generates targeted fixes based on test failure analysis
 */

import type { LLMProvider } from "../../providers/types.js";
import type { GeneratedFile } from "./types.js";
import type { FailureAnalysis } from "./test-analyzer.js";
import { validateCode } from "../../tools/ast-validator.js";

export interface FixResult {
  file: GeneratedFile;
  changesApplied: string[];
  fixAttempts: number;
  success: boolean;
}

/**
 * Fix Generator
 */
export class FixGenerator {
  private llm: LLMProvider;
  private maxFixAttempts = 3;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Generate fixes for files based on failure analysis
   */
  async generateFixes(
    files: GeneratedFile[],
    analysis: FailureAnalysis,
  ): Promise<Map<string, GeneratedFile>> {
    const fixedFiles = new Map<string, GeneratedFile>();

    // Group failures by affected file
    const failuresByFile = this.groupFailuresByFile(analysis);

    for (const file of files) {
      const failures = failuresByFile.get(file.path);

      if (!failures || failures.length === 0) {
        // No failures for this file, keep original
        fixedFiles.set(file.path, file);
        continue;
      }

      // Generate fix for this file
      try {
        const fixResult = await this.generateFix(file, failures);
        fixedFiles.set(file.path, fixResult.file);
      } catch (error) {
        console.warn(`[FixGenerator] Failed to fix ${file.path}:`, error);
        // Keep original file if fix fails
        fixedFiles.set(file.path, file);
      }
    }

    return fixedFiles;
  }

  /**
   * Generate fix for a single file
   */
  private async generateFix(
    file: GeneratedFile,
    failures: FailureAnalysis["failures"],
  ): Promise<FixResult> {
    let currentFile = file;
    let attempt = 0;
    const changesApplied: string[] = [];

    while (attempt < this.maxFixAttempts) {
      attempt++;

      // Build fix prompt
      const fixPrompt = this.buildFixPrompt(currentFile, failures, attempt);

      // Get fix from LLM
      const response = await this.llm.chat([
        {
          role: "system",
          content: `You are a code fixing expert. Fix issues based on test failure analysis.
Return ONLY the fixed code without markdown formatting or explanations.
Preserve all functionality while fixing the identified issues.`,
        },
        { role: "user", content: fixPrompt },
      ]);

      // Extract code from response
      let fixedCode = this.extractCode(response.content);

      // Validate the fix
      const language =
        file.path.endsWith(".ts") || file.path.endsWith(".tsx") ? "typescript" : "javascript";
      const validation = await validateCode(fixedCode, file.path, language);

      if (!validation.valid) {
        console.warn(
          `[FixGenerator] Fix attempt ${attempt} produced invalid code for ${file.path}`,
        );

        if (attempt >= this.maxFixAttempts) {
          // Max attempts reached, return original
          return {
            file,
            changesApplied,
            fixAttempts: attempt,
            success: false,
          };
        }

        // Try again with validation errors as feedback
        failures = [
          ...failures,
          {
            test: "Syntax Validation",
            location: { file: file.path, line: 0, column: 0 },
            rootCause: `Generated code has syntax errors: ${validation.errors.map((e) => e.message).join(", ")}`,
            suggestedFix: "Fix the syntax errors",
            confidence: 100,
            affectedFiles: [file.path],
          },
        ];
        continue;
      }

      // Fix is valid
      currentFile = {
        ...file,
        content: fixedCode,
      };

      changesApplied.push(
        ...failures.map(
          (f) => `Fixed: ${f.rootCause.substring(0, 100)}${f.rootCause.length > 100 ? "..." : ""}`,
        ),
      );

      return {
        file: currentFile,
        changesApplied,
        fixAttempts: attempt,
        success: true,
      };
    }

    // Should not reach here, but return original as fallback
    return {
      file,
      changesApplied,
      fixAttempts: attempt,
      success: false,
    };
  }

  /**
   * Build fix prompt for LLM
   */
  private buildFixPrompt(
    file: GeneratedFile,
    failures: FailureAnalysis["failures"],
    attempt: number,
  ): string {
    const failureDescriptions = failures
      .map(
        (f, i) => `
${i + 1}. Test: ${f.test}
   Location: Line ${f.location.line}${f.location.function ? ` in ${f.location.function}` : ""}
   Root Cause: ${f.rootCause}
   Suggested Fix: ${f.suggestedFix}
   Confidence: ${f.confidence}%
`,
      )
      .join("\n");

    const attemptNote =
      attempt > 1 ? `\n\nThis is attempt ${attempt}. Previous attempts had issues.\n` : "";

    return `Fix the following issues in ${file.path}:

${failureDescriptions}
${attemptNote}
Current code:
\`\`\`${file.path.endsWith(".ts") || file.path.endsWith(".tsx") ? "typescript" : "javascript"}
${file.content}
\`\`\`

IMPORTANT:
- Return ONLY the complete fixed code
- Do NOT include markdown code blocks or explanations
- Fix ALL identified issues
- Preserve all other functionality
- Ensure the code is syntactically valid
- Maintain the original file structure and imports
`;
  }

  /**
   * Extract code from LLM response (remove markdown if present)
   */
  private extractCode(response: string): string {
    let code = response.trim();

    // Remove markdown code blocks if present
    const codeBlockRegex = /```(?:typescript|javascript|ts|js)?\n?([\s\S]*?)```/;
    const match = code.match(codeBlockRegex);

    if (match?.[1]) {
      code = match[1].trim();
    }

    return code;
  }

  /**
   * Group failures by affected file
   */
  private groupFailuresByFile(analysis: FailureAnalysis): Map<string, FailureAnalysis["failures"]> {
    const byFile = new Map<string, FailureAnalysis["failures"]>();

    for (const failure of analysis.failures) {
      // Primary affected file is the location file
      if (!byFile.has(failure.location.file)) {
        byFile.set(failure.location.file, []);
      }
      byFile.get(failure.location.file)!.push(failure);

      // Also add to other affected files
      for (const affectedFile of failure.affectedFiles) {
        if (affectedFile !== failure.location.file) {
          if (!byFile.has(affectedFile)) {
            byFile.set(affectedFile, []);
          }
          byFile.get(affectedFile)!.push(failure);
        }
      }
    }

    return byFile;
  }
}

/**
 * Create a fix generator
 */
export function createFixGenerator(llm: LLMProvider): FixGenerator {
  return new FixGenerator(llm);
}
