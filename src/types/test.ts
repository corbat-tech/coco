/**
 * Test execution types
 */

export interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration?: number;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface TestSuite {
  name: string;
  tests: TestResult[];
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface TestExecutionResult {
  suites: TestSuite[];
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
}
