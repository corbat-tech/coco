/**
 * Test Failure Analyzer
 * Analyzes test failures to identify root causes
 */

import * as fs from "node:fs/promises";
import type { LLMProvider } from "../../providers/types.js";
import type { TestResult } from "../../types/test.js";

export interface FailureLocation {
  file: string;
  line: number;
  column: number;
  function?: string;
}

export interface FailureAnalysisResult {
  test: string;
  location: FailureLocation;
  rootCause: string;
  suggestedFix: string;
  confidence: number; // 0-100
  affectedFiles: string[];
}

export interface FailureAnalysis {
  failures: FailureAnalysisResult[];
  totalFailures: number;
  highConfidenceCount: number; // confidence >= 70
  summary: string;
}

/**
 * Test Failure Analyzer
 */
export class TestFailureAnalyzer {
  private llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Analyze test failures and identify root causes
   */
  async analyzeFailures(testResults: TestResult[]): Promise<FailureAnalysis> {
    const failures = testResults.filter((t) => t.status === "failed");

    if (failures.length === 0) {
      return {
        failures: [],
        totalFailures: 0,
        highConfidenceCount: 0,
        summary: "All tests passed",
      };
    }

    // Analyze each failure
    const analyses = await Promise.all(failures.map((failure) => this.analyzeFailure(failure)));

    const highConfidenceCount = analyses.filter((a) => a.confidence >= 70).length;

    // Generate summary
    const summary = this.generateSummary(analyses);

    return {
      failures: analyses,
      totalFailures: failures.length,
      highConfidenceCount,
      summary,
    };
  }

  /**
   * Analyze a single test failure
   */
  private async analyzeFailure(testResult: TestResult): Promise<FailureAnalysisResult> {
    // Extract location from stack trace
    const location = this.extractLocation(testResult.error?.stack || "");

    // Read source code context
    const sourceContext = await this.readSourceContext(location, 10);

    // Use LLM to diagnose the failure
    const diagnosis = await this.diagnosWithLLM(testResult, location, sourceContext);

    return {
      test: testResult.name || "Unknown test",
      location,
      rootCause: diagnosis.rootCause,
      suggestedFix: diagnosis.suggestedFix,
      confidence: diagnosis.confidence,
      affectedFiles: diagnosis.affectedFiles,
    };
  }

  /**
   * Extract failure location from stack trace
   */
  private extractLocation(stackTrace: string): FailureLocation {
    // Parse stack trace to find the error location
    // Common formats:
    // - at functionName (file.ts:line:col)
    // - at file.ts:line:col
    // - file.ts:line:col

    // Try Node.js format first: at functionName (file.ts:line:col) or at file.ts:line:col
    const nodePattern = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/;
    const nodeMatch = stackTrace.match(nodePattern);
    if (nodeMatch) {
      return {
        file: nodeMatch[2] || "unknown",
        line: parseInt(nodeMatch[3] || "0", 10),
        column: parseInt(nodeMatch[4] || "0", 10),
        function: nodeMatch[1] || undefined,
      };
    }

    // Try simple format: file.ts:line:col
    const simplePattern = /^(.+?):(\d+):(\d+)/;
    const simpleMatch = stackTrace.match(simplePattern);
    if (simpleMatch) {
      return {
        file: simpleMatch[1] || "unknown",
        line: parseInt(simpleMatch[2] || "0", 10),
        column: parseInt(simpleMatch[3] || "0", 10),
      };
    }

    // Fallback
    return {
      file: "unknown",
      line: 0,
      column: 0,
    };
  }

  /**
   * Read source code context around the failure location
   */
  private async readSourceContext(
    location: FailureLocation,
    contextLines: number,
  ): Promise<string> {
    if (location.file === "unknown") {
      return "";
    }

    try {
      const content = await fs.readFile(location.file, "utf-8");
      const lines = content.split("\n");

      const startLine = Math.max(0, location.line - contextLines - 1);
      const endLine = Math.min(lines.length, location.line + contextLines);

      const contextWithLineNumbers = lines
        .slice(startLine, endLine)
        .map((line, idx) => {
          const lineNum = startLine + idx + 1;
          const marker = lineNum === location.line ? ">>>" : "   ";
          return `${marker} ${lineNum.toString().padStart(4)}: ${line}`;
        })
        .join("\n");

      return contextWithLineNumbers;
    } catch {
      return `Could not read source file: ${location.file}`;
    }
  }

  /**
   * Diagnose failure using LLM
   */
  private async diagnosWithLLM(
    testResult: TestResult,
    location: FailureLocation,
    sourceContext: string,
  ): Promise<{
    rootCause: string;
    suggestedFix: string;
    confidence: number;
    affectedFiles: string[];
  }> {
    const prompt = `You are a debugging expert. Analyze this test failure and identify the root cause.

Test Name: ${testResult.name}
Status: ${testResult.status}
Error Message: ${testResult.error?.message || "No error message"}

Stack Trace:
${testResult.error?.stack || "No stack trace"}

Location: ${location.file}:${location.line}:${location.column}
${location.function ? `Function: ${location.function}` : ""}

Source Code Context:
\`\`\`
${sourceContext}
\`\`\`

Provide:
1. Root Cause: What is the underlying issue? (not just the symptom)
2. Suggested Fix: Specific code change to fix the issue
3. Confidence: Your confidence in this diagnosis (0-100)
4. Affected Files: List of files that need to be modified

Respond in JSON format:
{
  "rootCause": "string",
  "suggestedFix": "string",
  "confidence": number,
  "affectedFiles": ["string"]
}`;

    try {
      const response = await this.llm.chat([
        {
          role: "system",
          content:
            "You are a debugging expert. Analyze test failures and provide root cause analysis in JSON format.",
        },
        { role: "user", content: prompt },
      ]);

      // Parse JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON in response");
      }

      const diagnosis = JSON.parse(jsonMatch[0]) as {
        rootCause?: string;
        suggestedFix?: string;
        confidence?: number;
        affectedFiles?: string[];
      };

      return {
        rootCause: diagnosis.rootCause || "Unknown root cause",
        suggestedFix: diagnosis.suggestedFix || "No specific fix suggested",
        confidence: Math.min(100, Math.max(0, diagnosis.confidence || 50)),
        affectedFiles: diagnosis.affectedFiles || [location.file],
      };
    } catch {
      // Fallback diagnosis
      return {
        rootCause: `Test failed with: ${testResult.error?.message || "Unknown error"}`,
        suggestedFix: "Review the code at the failure location",
        confidence: 30,
        affectedFiles: [location.file],
      };
    }
  }

  /**
   * Generate summary of failures
   */
  private generateSummary(analyses: FailureAnalysisResult[]): string {
    if (analyses.length === 0) {
      return "No failures to analyze";
    }

    // Group by root cause type
    const causeTypes = new Map<string, number>();
    for (const analysis of analyses) {
      const type = this.categorizeRootCause(analysis.rootCause);
      causeTypes.set(type, (causeTypes.get(type) || 0) + 1);
    }

    const lines = [
      `Analyzed ${analyses.length} test failure(s):`,
      `- High confidence fixes: ${analyses.filter((a) => a.confidence >= 70).length}`,
      `- Medium confidence fixes: ${analyses.filter((a) => a.confidence >= 40 && a.confidence < 70).length}`,
      `- Low confidence fixes: ${analyses.filter((a) => a.confidence < 40).length}`,
      "",
      "Root cause categories:",
    ];

    for (const [type, count] of causeTypes.entries()) {
      lines.push(`- ${type}: ${count}`);
    }

    return lines.join("\n");
  }

  /**
   * Categorize root cause into types
   */
  private categorizeRootCause(rootCause: string): string {
    const lower = rootCause.toLowerCase();

    if (lower.includes("syntax")) {
      return "Syntax Error";
    }
    if (lower.includes("undefined") || lower.includes("null")) {
      return "Null/Undefined Reference";
    }
    if (lower.includes("assertion") || lower.includes("expect(")) {
      return "Assertion Failure";
    }
    if (
      lower.includes("type") &&
      (lower.includes("mismatch") ||
        lower.includes("assignable") ||
        lower.includes("incompatible") ||
        lower.includes("not assignable") ||
        lower.includes("expected"))
    ) {
      return "Type Mismatch";
    }
    if (lower.includes("async") || lower.includes("promise") || lower.includes("await")) {
      return "Async/Promise Issue";
    }
    if (lower.includes("import") || lower.includes("module") || lower.includes("require")) {
      return "Import/Module Issue";
    }
    if (lower.includes("timeout")) {
      return "Timeout";
    }

    return "Other";
  }
}

/**
 * Create a test failure analyzer
 */
export function createTestFailureAnalyzer(llm: LLMProvider): TestFailureAnalyzer {
  return new TestFailureAnalyzer(llm);
}
