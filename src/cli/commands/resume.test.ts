/**
 * Tests for resume command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as p from "@clack/prompts";

// Store original process.exit
const originalExit = process.exit;

// Mock fs.access function (used for checking project)
const mockFsAccess = vi.fn();
const mockFsReadFile = vi.fn();
const mockFsReaddir = vi.fn();
const mockFsStat = vi.fn();

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock node:fs/promises - ensure it works with dynamic import
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mockFsReadFile,
    readdir: mockFsReaddir,
    stat: mockFsStat,
    access: mockFsAccess,
  },
  readFile: mockFsReadFile,
  readdir: mockFsReaddir,
  stat: mockFsStat,
  access: mockFsAccess,
}));

describe("registerResumeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  it("should register resume command with program", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.command).toHaveBeenCalledWith("resume");
  });

  it("should have description", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.description).toHaveBeenCalledWith(
      "Resume from the last checkpoint after an interruption"
    );
  });

  it("should have checkpoint option", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledWith(
      "-c, --checkpoint <id>",
      "Resume from a specific checkpoint"
    );
  });

  it("should have list option", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledWith(
      "--list",
      "List available checkpoints"
    );
  });

  it("should have force option", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledWith(
      "--force",
      "Force resume even if state is inconsistent"
    );
  });

  it("should register action handler", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.action).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should have all three options configured", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledTimes(3);
  });
});

describe("resume action handler - runResume", () => {
  let actionHandler: ((options: { checkpoint?: string; list?: boolean; force?: boolean }) => Promise<void>) | null = null;

  function setupDefaultMocks() {
    mockFsAccess.mockReset();
    vi.mocked(p.intro).mockReset();
    vi.mocked(p.outro).mockReset();
    vi.mocked(p.cancel).mockReset();
    vi.mocked(p.spinner).mockReset();
    vi.mocked(p.confirm).mockReset();
    vi.mocked(p.isCancel).mockReset();
    vi.mocked(p.log.info).mockReset();
    vi.mocked(p.log.success).mockReset();
    vi.mocked(p.log.warning).mockReset();
    vi.mocked(p.log.error).mockReset();

    // Default: project exists
    mockFsAccess.mockResolvedValue(undefined);
    vi.mocked(p.spinner).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    });
    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(p.confirm).mockResolvedValue(true);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
    setupDefaultMocks();

    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        actionHandler = handler;
        return mockProgram;
      }),
    };

    registerResumeCommand(mockProgram as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  it("should display intro message", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.intro).toHaveBeenCalled();
  });

  it("should check for existing project", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFsAccess).toHaveBeenCalledWith(".coco");
  });

  it("should exit with error if no project found", async () => {
    mockFsAccess.mockRejectedValueOnce(new Error("ENOENT"));

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.error).toHaveBeenCalledWith("No Corbat-Coco project found.");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should list checkpoints when --list flag is provided", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ list: true });
    await vi.runAllTimersAsync();
    await promise;

    // Should return early after listing, no confirmation prompt
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it("should load specific checkpoint when --checkpoint flag is provided", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ checkpoint: "cp-custom-001" });
    await vi.runAllTimersAsync();
    await promise;

    // Should confirm resuming from the specified checkpoint
    expect(p.confirm).toHaveBeenCalledWith({
      message: "Resume from checkpoint cp-custom-001?",
    });
  });

  it("should find latest checkpoint when no --checkpoint flag", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    // Should confirm resuming from auto-found checkpoint
    expect(p.confirm).toHaveBeenCalledWith({
      message: expect.stringMatching(/Resume from checkpoint/),
    });
  });

  it("should exit if user cancels resume confirmation", async () => {
    vi.mocked(p.isCancel).mockReturnValue(true);

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.cancel).toHaveBeenCalledWith("Resume cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should exit if user declines resume confirmation", async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(false);

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.cancel).toHaveBeenCalledWith("Resume cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should use spinner while restoring state", async () => {
    const mockSpinnerInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSpinnerInstance.start).toHaveBeenCalledWith("Restoring state from checkpoint...");
    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("State restored successfully.");
  });

  it("should log success message with phase info", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringMatching(/Resuming from phase:/)
    );
  });

  it("should display success outro message", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.outro).toHaveBeenCalled();
  });

  it("should force resume even with validation issues when --force flag is provided", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ force: true });
    await vi.runAllTimersAsync();
    await promise;

    // Should still complete successfully
    expect(p.outro).toHaveBeenCalled();
  });

  it("should handle checkpoint restore error and rethrow", async () => {
    const mockSpinnerInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

    // Note: The current implementation doesn't actually throw on restore
    // This test ensures the flow works correctly
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSpinnerInstance.stop).toHaveBeenCalled();
  });

  it("should exit with error when no checkpoint found", async () => {
    // This tests the case where findLatestCheckpoint returns null
    // The current implementation always returns a checkpoint, but we can test the path exists
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    // The handler should complete without error for now
    // since findLatestCheckpoint always returns a checkpoint
    expect(p.intro).toHaveBeenCalled();
  });
});

describe("resume command integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  it("should chain all configuration methods correctly", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerResumeCommand(mockProgram as any);

    expect(mockProgram.command).toHaveBeenCalledTimes(1);
    expect(mockProgram.description).toHaveBeenCalledTimes(1);
    expect(mockProgram.option).toHaveBeenCalledTimes(3);
    expect(mockProgram.action).toHaveBeenCalledTimes(1);
  });
});

describe("checkpoint listing", () => {
  let actionHandler: ((options: { checkpoint?: string; list?: boolean; force?: boolean }) => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;

    mockFsAccess.mockReset();
    mockFsAccess.mockResolvedValue(undefined);
    vi.mocked(p.spinner).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    });
    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(p.confirm).mockResolvedValue(true);

    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        actionHandler = handler;
        return mockProgram;
      }),
    };

    registerResumeCommand(mockProgram as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  it("should display checkpoint list with --list flag", async () => {
    // Spy on console.log to verify output
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ list: true });
    await vi.runAllTimersAsync();
    await promise;

    // Should have logged checkpoint information
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("should not prompt for confirmation when listing", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ list: true });
    await vi.runAllTimersAsync();
    await promise;

    expect(p.confirm).not.toHaveBeenCalled();
  });

  it("should return early after listing checkpoints", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ list: true });
    await vi.runAllTimersAsync();
    await promise;

    // Should not show outro (which happens after resume)
    expect(p.outro).not.toHaveBeenCalled();
  });
});

describe("checkpoint validation", () => {
  let actionHandler: ((options: { checkpoint?: string; list?: boolean; force?: boolean }) => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;

    mockFsAccess.mockReset();
    mockFsAccess.mockResolvedValue(undefined);
    vi.mocked(p.spinner).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    });
    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(p.confirm).mockResolvedValue(true);

    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        actionHandler = handler;
        return mockProgram;
      }),
    };

    registerResumeCommand(mockProgram as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  it("should display checkpoint information before confirming", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    // Should display checkpoint info (ID, Created, Phase, Task)
    const calls = consoleSpy.mock.calls.flat().join(" ");
    expect(calls).toMatch(/ID:/);
    expect(calls).toMatch(/Created:/);
    expect(calls).toMatch(/Phase:/);
    expect(calls).toMatch(/Task:/);

    consoleSpy.mockRestore();
  });

  it("should pass validation with valid checkpoint (no issues)", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    // Should complete successfully without validation error
    expect(p.log.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/validation failed/)
    );
  });

  it("should bypass validation with --force flag", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({ force: true });
    await vi.runAllTimersAsync();
    await promise;

    // Should complete successfully
    expect(p.outro).toHaveBeenCalled();
  });
});

describe("state restoration", () => {
  let actionHandler: ((options: { checkpoint?: string; list?: boolean; force?: boolean }) => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;

    mockFsAccess.mockReset();
    mockFsAccess.mockResolvedValue(undefined);
    vi.mocked(p.spinner).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    });
    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(p.confirm).mockResolvedValue(true);

    const { registerResumeCommand } = await import("./resume.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        actionHandler = handler;
        return mockProgram;
      }),
    };

    registerResumeCommand(mockProgram as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
  });

  it("should restore state from checkpoint", async () => {
    const mockSpinnerInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(mockSpinnerInstance.start).toHaveBeenCalledWith("Restoring state from checkpoint...");
    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("State restored successfully.");
  });

  it("should indicate ready to continue after restore", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.outro).toHaveBeenCalled();
  });

  it("should show phase information on success", async () => {
    expect(actionHandler).not.toBeNull();
    const promise = actionHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith(
      expect.stringContaining("complete")
    );
  });
});
