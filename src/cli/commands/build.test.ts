/**
 * Tests for build command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Store original process.exit
const originalExit = process.exit;

// Mock process.exit to prevent test termination
beforeEach(() => {
  process.exit = vi.fn() as unknown as typeof process.exit;
});

afterEach(() => {
  process.exit = originalExit;
});

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
}));

describe("build command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerBuildCommand", () => {
    it("should register build command with program", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.command).toHaveBeenCalledWith("build");
      expect(mockCommand.description).toHaveBeenCalled();
    });

    it("should set correct description", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.description).toHaveBeenCalledWith(
        expect.stringContaining("task")
      );
    });

    it("should have task option with short flag", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "-t, --task <task-id>",
        expect.any(String)
      );
    });

    it("should have sprint option with short flag", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "-s, --sprint <sprint-id>",
        expect.any(String)
      );
    });

    it("should have no-review option", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "--no-review",
        expect.any(String)
      );
    });

    it("should have max-iterations option with default value", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "--max-iterations <n>",
        expect.any(String),
        "10"
      );
    });

    it("should have min-quality option with default value", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledWith(
        "--min-quality <n>",
        expect.any(String),
        "85"
      );
    });

    it("should register action handler", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.action).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should have all 5 options configured", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.option).toHaveBeenCalledTimes(5);
    });
  });

  describe("action handler integration", () => {
    it("should capture the action handler function", async () => {
      const { registerBuildCommand } = await import("./build.js");

      let actionHandler: ((options: any) => Promise<void>) | null = null;

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn((handler) => {
          actionHandler = handler;
          return mockCommand;
        }),
      };

      registerBuildCommand(mockCommand as any);

      expect(actionHandler).not.toBeNull();
      expect(typeof actionHandler).toBe("function");
    });
  });

  describe("build command options", () => {
    it("should parse maxIterations as integer with default 10", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      const maxIterationsCall = mockCommand.option.mock.calls.find(
        (call: string[]) => call[0] === "--max-iterations <n>"
      );

      expect(maxIterationsCall).toBeDefined();
      expect(maxIterationsCall[2]).toBe("10");
    });

    it("should parse minQuality as integer with default 85", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      const minQualityCall = mockCommand.option.mock.calls.find(
        (call: string[]) => call[0] === "--min-quality <n>"
      );

      expect(minQualityCall).toBeDefined();
      expect(minQualityCall[2]).toBe("85");
    });

    it("should have description mentioning build", async () => {
      const { registerBuildCommand } = await import("./build.js");

      const mockCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn().mockReturnThis(),
      };

      registerBuildCommand(mockCommand as any);

      expect(mockCommand.description).toHaveBeenCalledWith(
        expect.stringMatching(/build/i)
      );
    });
  });
});
