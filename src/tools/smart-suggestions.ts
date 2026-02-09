/**
 * Smart Suggestions Tool
 * AI-powered contextual suggestions for developers
 */

import { defineTool } from "./registry.js";
import { z } from "zod";

const fs = await import("node:fs/promises");

export const SuggestImprovementsSchema = z.object({
  filePath: z.string().describe("File to analyze for improvement suggestions"),
  context: z.string().optional().describe("Additional context about the code"),
});

export type SuggestImprovementsInput = z.infer<typeof SuggestImprovementsSchema>;

export interface CodeSuggestion {
  type: "refactor" | "performance" | "security" | "readability" | "testing";
  line: number;
  severity: "high" | "medium" | "low";
  message: string;
  suggestion: string;
  reasoning: string;
}

/**
 * Analyze code and provide smart suggestions
 */
export async function analyzeAndSuggest(
  filePath: string,
  _context?: string,
): Promise<CodeSuggestion[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const suggestions: CodeSuggestion[] = [];

  // Check for common anti-patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Detect console.log in production code
    if (line.includes("console.log") && !filePath.includes("test")) {
      suggestions.push({
        type: "readability",
        line: i + 1,
        severity: "medium",
        message: "Console.log found in production code",
        suggestion: "Use proper logging framework or remove debug statement",
        reasoning: "Console statements can leak sensitive information and clutter production logs",
      });
    }

    // Detect TODO comments
    if (line.includes("TODO") || line.includes("FIXME")) {
      suggestions.push({
        type: "readability",
        line: i + 1,
        severity: "low",
        message: "TODO/FIXME comment found",
        suggestion: "Consider creating a ticket or addressing this immediately",
        reasoning: "TODO comments can accumulate and become technical debt",
      });
    }

    // Detect long lines
    if (line.length > 120) {
      suggestions.push({
        type: "readability",
        line: i + 1,
        severity: "low",
        message: "Line exceeds recommended length (120 chars)",
        suggestion: "Break line into multiple lines for better readability",
        reasoning: "Long lines are harder to read and review",
      });
    }

    // Detect any type usage
    if (line.includes(": any") && !line.includes("// @ts-")) {
      suggestions.push({
        type: "security",
        line: i + 1,
        severity: "high",
        message: "'any' type defeats TypeScript's type safety",
        suggestion: "Use specific types or 'unknown' with type guards",
        reasoning: "'any' bypasses all type checking and can hide bugs",
      });
    }

    // Detect empty catch blocks
    const trimmedLine = line.trim();
    if (
      trimmedLine.endsWith("catch (error) {") ||
      trimmedLine.endsWith("catch (e) {") ||
      trimmedLine === "catch (error) {" ||
      trimmedLine === "catch (e) {"
    ) {
      const nextLine = lines[i + 1];
      if (nextLine && nextLine.trim() === "}") {
        suggestions.push({
          type: "security",
          line: i + 1,
          severity: "high",
          message: "Empty catch block swallows errors",
          suggestion: "Log error or rethrow with context",
          reasoning: "Silent error handling makes debugging impossible",
        });
      }
    }

    // Detect synchronous fs operations
    if (line.includes("fs.readFileSync") || line.includes("fs.writeFileSync")) {
      suggestions.push({
        type: "performance",
        line: i + 1,
        severity: "medium",
        message: "Synchronous file operation blocks event loop",
        suggestion: "Use async fs operations (fs.readFile, fs.writeFile)",
        reasoning: "Sync operations block Node.js event loop and hurt performance",
      });
    }

    // Detect missing error handling in async functions
    if (line.includes("async ") && line.includes("=>")) {
      let hasErrorHandling = false;
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        if (lines[j]?.includes("try") || lines[j]?.includes("catch")) {
          hasErrorHandling = true;
          break;
        }
      }

      if (!hasErrorHandling) {
        suggestions.push({
          type: "security",
          line: i + 1,
          severity: "medium",
          message: "Async function without error handling",
          suggestion: "Add try/catch block or .catch() handler",
          reasoning: "Unhandled promise rejections can crash the application",
        });
      }
    }

    // Detect missing test files
    if (
      filePath.endsWith(".ts") &&
      !filePath.includes("test") &&
      !filePath.includes(".d.ts") &&
      line.includes("export ")
    ) {
      const testPath = filePath.replace(".ts", ".test.ts");
      try {
        await fs.access(testPath);
      } catch {
        suggestions.push({
          type: "testing",
          line: i + 1,
          severity: "medium",
          message: "Module exports but no test file found",
          suggestion: `Create ${testPath.split("/").pop()}`,
          reasoning: "All exported functionality should have tests",
        });
        break; // Only suggest once per file
      }
    }
  }

  return suggestions;
}

/**
 * Tool: Get smart improvement suggestions for code
 */
export const suggestImprovementsTool = defineTool({
  name: "suggestImprovements",
  description: "Get AI-powered suggestions for code improvements",
  category: "quality" as const,
  parameters: SuggestImprovementsSchema,

  async execute(input) {
    const { filePath, context } = input as SuggestImprovementsInput;
    const suggestions = await analyzeAndSuggest(filePath, context);

    // Group by severity
    const high = suggestions.filter((s) => s.severity === "high");
    const medium = suggestions.filter((s) => s.severity === "medium");
    const low = suggestions.filter((s) => s.severity === "low");

    return {
      filePath,
      totalSuggestions: suggestions.length,
      bySeverity: {
        high: high.length,
        medium: medium.length,
        low: low.length,
      },
      byType: {
        refactor: suggestions.filter((s) => s.type === "refactor").length,
        performance: suggestions.filter((s) => s.type === "performance").length,
        security: suggestions.filter((s) => s.type === "security").length,
        readability: suggestions.filter((s) => s.type === "readability").length,
        testing: suggestions.filter((s) => s.type === "testing").length,
      },
      suggestions: suggestions.slice(0, 20), // Limit to top 20
    };
  },
});

/**
 * Tool: Get code quality score
 */
export const calculateCodeScoreTool = defineTool({
  name: "calculateCodeScore",
  description: "Calculate code quality score based on various metrics",
  category: "quality" as const,
  parameters: z.object({
    filePath: z.string(),
  }),

  async execute(input) {
    const { filePath } = input as { filePath: string };
    const suggestions = await analyzeAndSuggest(filePath);

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim()).length;

    // Calculate score (100 - deductions)
    let score = 100;

    // Deductions for issues
    const high = suggestions.filter((s) => s.severity === "high").length;
    const medium = suggestions.filter((s) => s.severity === "medium").length;
    const low = suggestions.filter((s) => s.severity === "low").length;

    score -= high * 10;
    score -= medium * 5;
    score -= low * 2;

    // Deductions for size (very large files are harder to maintain)
    if (nonEmptyLines > 500) score -= 5;
    if (nonEmptyLines > 1000) score -= 10;

    score = Math.max(0, Math.min(100, score));

    return {
      filePath,
      score,
      grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F",
      lines: lines.length,
      nonEmptyLines,
      issues: {
        high,
        medium,
        low,
        total: suggestions.length,
      },
      recommendations:
        score < 70
          ? [
              "Address high severity issues",
              "Review medium severity issues",
              "Consider refactoring",
            ]
          : score < 90
            ? ["Address remaining issues", "Code quality is good"]
            : ["Excellent code quality"],
    };
  },
});

export const smartSuggestionsTools = [suggestImprovementsTool, calculateCodeScoreTool];
