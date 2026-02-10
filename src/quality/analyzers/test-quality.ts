/**
 * Test Quality Analyzer
 * Measures assertion density, trivial assertion ratio, and edge case coverage
 */

import { readFile } from "node:fs/promises";
import { glob } from "glob";

/**
 * Test quality analysis result
 */
export interface TestQualityResult {
  score: number;
  assertionDensity: number;
  trivialAssertionRatio: number;
  edgeCaseRatio: number;
  assertionDiversity: number;
  totalTestFiles: number;
  totalAssertions: number;
  trivialAssertions: number;
  edgeCaseTests: number;
  totalTests: number;
  details: string;
}

/**
 * Trivial assertion patterns (provide little verification value)
 */
const TRIVIAL_PATTERNS = [
  /\.toBeDefined\(\)/,
  /\.toBeUndefined\(\)/,
  /\.toBeTruthy\(\)/,
  /\.toBeFalsy\(\)/,
  /\.toBe\(true\)/,
  /\.toBe\(false\)/,
  /\.not\.toBeNull\(\)/,
  /\.toBeInstanceOf\(/,
  /\.toBeTypeOf\(/,
];

/**
 * Edge case test name patterns
 */
const EDGE_CASE_PATTERNS = [
  /error/i,
  /edge/i,
  /boundary/i,
  /invalid/i,
  /empty/i,
  /null/i,
  /undefined/i,
  /negative/i,
  /overflow/i,
  /timeout/i,
  /fail/i,
  /reject/i,
  /throw/i,
  /missing/i,
  /malformed/i,
  /corrupt/i,
];

/**
 * Assertion matcher patterns for diversity measurement
 */
const MATCHER_PATTERNS = [
  /\.toBe\(/,
  /\.toEqual\(/,
  /\.toStrictEqual\(/,
  /\.toContain\(/,
  /\.toMatch\(/,
  /\.toHaveLength\(/,
  /\.toHaveProperty\(/,
  /\.toThrow/,
  /\.toHaveBeenCalled/,
  /\.toHaveBeenCalledWith\(/,
  /\.toHaveBeenCalledTimes\(/,
  /\.toBeGreaterThan\(/,
  /\.toBeLessThan\(/,
  /\.toBeCloseTo\(/,
  /\.resolves\./,
  /\.rejects\./,
];

/**
 * Analyze a single test file
 */
function analyzeTestFile(content: string): {
  totalAssertions: number;
  trivialAssertions: number;
  totalTests: number;
  edgeCaseTests: number;
  matchersUsed: Set<number>;
} {
  const lines = content.split("\n");
  let totalAssertions = 0;
  let trivialAssertions = 0;
  let totalTests = 0;
  let edgeCaseTests = 0;
  const matchersUsed = new Set<number>();

  for (const line of lines) {
    const trimmed = line.trim();

    // Count test declarations
    if (/^\s*(it|test)\s*\(/.test(trimmed) || /^\s*(it|test)\s*\./.test(trimmed)) {
      totalTests++;

      // Check if test name matches edge case patterns
      for (const pattern of EDGE_CASE_PATTERNS) {
        if (pattern.test(trimmed)) {
          edgeCaseTests++;
          break;
        }
      }
    }

    // Count assertions (expect calls)
    if (/expect\s*\(/.test(trimmed)) {
      totalAssertions++;

      // Check for trivial assertions
      for (const pattern of TRIVIAL_PATTERNS) {
        if (pattern.test(trimmed)) {
          trivialAssertions++;
          break;
        }
      }

      // Track matcher diversity
      for (let i = 0; i < MATCHER_PATTERNS.length; i++) {
        if (MATCHER_PATTERNS[i]!.test(trimmed)) {
          matchersUsed.add(i);
        }
      }
    }
  }

  return { totalAssertions, trivialAssertions, totalTests, edgeCaseTests, matchersUsed };
}

/**
 * Test Quality Analyzer
 */
export class TestQualityAnalyzer {
  constructor(private projectPath: string) {}

  /**
   * Analyze test quality across the project
   */
  async analyze(files?: string[]): Promise<TestQualityResult> {
    const testFiles = files ?? (await this.findTestFiles());

    let totalAssertions = 0;
    let trivialAssertions = 0;
    let totalTests = 0;
    let edgeCaseTests = 0;
    const allMatchersUsed = new Set<number>();

    for (const file of testFiles) {
      try {
        const content = await readFile(file, "utf-8");
        const result = analyzeTestFile(content);

        totalAssertions += result.totalAssertions;
        trivialAssertions += result.trivialAssertions;
        totalTests += result.totalTests;
        edgeCaseTests += result.edgeCaseTests;
        for (const m of result.matchersUsed) {
          allMatchersUsed.add(m);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Calculate metrics
    const assertionDensity = totalTests > 0 ? totalAssertions / totalTests : 0;
    const trivialAssertionRatio =
      totalAssertions > 0 ? (trivialAssertions / totalAssertions) * 100 : 0;
    const edgeCaseRatio = totalTests > 0 ? (edgeCaseTests / totalTests) * 100 : 0;
    const assertionDiversity = (allMatchersUsed.size / MATCHER_PATTERNS.length) * 100;

    // Score calculation
    // Start at 100, penalize for problems, bonus for good practices
    let score = 100;

    // Penalize high trivial assertion ratio (up to -40 points)
    score -= Math.min(40, trivialAssertionRatio * 0.4);

    // Penalize low assertion density (< 2 assertions per test) (up to -20 points)
    if (assertionDensity < 2) {
      score -= (2 - assertionDensity) * 10;
    }

    // Bonus for edge case tests (up to +10 points)
    if (edgeCaseRatio > 10) {
      score += Math.min(10, (edgeCaseRatio - 10) * 0.5);
    }

    // Bonus for assertion diversity (up to +10 points)
    if (assertionDiversity > 30) {
      score += Math.min(10, (assertionDiversity - 30) * 0.15);
    }

    // Penalize if no tests at all
    if (totalTests === 0) {
      score = 0;
    }

    score = Math.round(Math.max(0, Math.min(100, score)));

    const details = [
      `${totalTests} tests, ${totalAssertions} assertions`,
      `${assertionDensity.toFixed(1)} assertions/test`,
      `${trivialAssertionRatio.toFixed(1)}% trivial`,
      `${edgeCaseRatio.toFixed(1)}% edge cases`,
      `${allMatchersUsed.size}/${MATCHER_PATTERNS.length} matcher types`,
    ].join(", ");

    return {
      score,
      assertionDensity,
      trivialAssertionRatio,
      edgeCaseRatio,
      assertionDiversity,
      totalTestFiles: testFiles.length,
      totalAssertions,
      trivialAssertions,
      edgeCaseTests,
      totalTests,
      details,
    };
  }

  private async findTestFiles(): Promise<string[]> {
    return glob("**/*.{test,spec}.{ts,tsx,js,jsx}", {
      cwd: this.projectPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    });
  }
}

/**
 * Create test quality analyzer instance
 */
export function createTestQualityAnalyzer(projectPath: string): TestQualityAnalyzer {
  return new TestQualityAnalyzer(projectPath);
}
