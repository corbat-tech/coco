/**
 * Tests for resume command
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: vi.fn(() => false),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("registerResumeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("should capture action handler that is callable", async () => {
    const { registerResumeCommand } = await import("./resume.js");

    let actionHandler: ((options: { checkpoint?: string; list?: boolean; force?: boolean }) => Promise<void>) | null = null;

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

    expect(actionHandler).not.toBeNull();
    expect(typeof actionHandler).toBe("function");
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

describe("resume command integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
