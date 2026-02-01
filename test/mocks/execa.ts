/**
 * Mock implementation for execa (command execution)
 */

import { vi } from "vitest";

export interface MockCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
}

export interface MockCommandConfig {
  result?: MockCommandResult;
  error?: Error;
  delay?: number;
}

/**
 * Mock command executor for testing
 */
export class MockCommandExecutor {
  private commands: Map<string, MockCommandConfig> = new Map();
  private executedCommands: Array<{ command: string; args: string[] }> = [];
  private defaultResult: MockCommandResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
    failed: false,
  };

  /**
   * Register a mock response for a command
   */
  register(command: string, config: MockCommandConfig): void {
    this.commands.set(command, config);
  }

  /**
   * Register mock for test commands (vitest, jest, etc.)
   */
  registerTestRunner(coverage?: number): void {
    // vitest run
    this.register("vitest", {
      result: {
        stdout: `
 ✓ src/index.test.ts (3 tests) 45ms
 ✓ src/utils.test.ts (5 tests) 23ms

 Test Files  2 passed (2)
      Tests  8 passed (8)
   Coverage  ${coverage ?? 85}%
`,
        stderr: "",
        exitCode: 0,
        failed: false,
      },
    });

    // jest
    this.register("jest", {
      result: {
        stdout: `
PASS src/index.test.ts
PASS src/utils.test.ts

Test Suites: 2 passed, 2 total
Tests:       8 passed, 8 total
Coverage:    ${coverage ?? 85}%
`,
        stderr: "",
        exitCode: 0,
        failed: false,
      },
    });
  }

  /**
   * Register mock for linter commands
   */
  registerLinter(issues?: number): void {
    const issueCount = issues ?? 0;
    this.register("oxlint", {
      result: {
        stdout: issueCount === 0
          ? "No issues found"
          : `Found ${issueCount} issues`,
        stderr: "",
        exitCode: issueCount > 0 ? 1 : 0,
        failed: issueCount > 0,
      },
    });

    this.register("eslint", {
      result: {
        stdout: issueCount === 0
          ? "✔ No problems found"
          : `✖ ${issueCount} problems`,
        stderr: "",
        exitCode: issueCount > 0 ? 1 : 0,
        failed: issueCount > 0,
      },
    });
  }

  /**
   * Register mock for git commands
   */
  registerGit(): void {
    this.register("git status", {
      result: {
        stdout: "On branch main\nnothing to commit, working tree clean",
        stderr: "",
        exitCode: 0,
        failed: false,
      },
    });

    this.register("git diff", {
      result: {
        stdout: "",
        stderr: "",
        exitCode: 0,
        failed: false,
      },
    });

    this.register("git log", {
      result: {
        stdout: "abc123 Initial commit\ndef456 Add feature",
        stderr: "",
        exitCode: 0,
        failed: false,
      },
    });
  }

  /**
   * Execute a command
   */
  async execute(command: string, args: string[] = []): Promise<MockCommandResult> {
    const fullCommand = args.length > 0 ? `${command} ${args.join(" ")}` : command;
    this.executedCommands.push({ command, args });

    // Find matching config
    let config: MockCommandConfig | undefined;

    // Try exact match first
    config = this.commands.get(fullCommand);

    // Try command without args
    if (!config) {
      config = this.commands.get(command);
    }

    // Try partial match
    if (!config) {
      for (const [key, value] of this.commands) {
        if (fullCommand.startsWith(key) || command.startsWith(key)) {
          config = value;
          break;
        }
      }
    }

    if (config?.delay) {
      await new Promise((resolve) => setTimeout(resolve, config.delay));
    }

    if (config?.error) {
      throw config.error;
    }

    return config?.result ?? this.defaultResult;
  }

  /**
   * Get executed commands
   */
  getExecutedCommands(): Array<{ command: string; args: string[] }> {
    return [...this.executedCommands];
  }

  /**
   * Reset
   */
  reset(): void {
    this.commands.clear();
    this.executedCommands = [];
  }

  /**
   * Set default result
   */
  setDefaultResult(result: MockCommandResult): void {
    this.defaultResult = result;
  }
}

/**
 * Setup mock for execa
 */
export function setupExecaMock() {
  const mockExecutor = new MockCommandExecutor();

  vi.mock("execa", () => ({
    execa: (command: string, args?: string[]) => mockExecutor.execute(command, args ?? []),
    execaCommand: (command: string) => {
      const parts = command.split(" ");
      return mockExecutor.execute(parts[0], parts.slice(1));
    },
  }));

  return mockExecutor;
}
