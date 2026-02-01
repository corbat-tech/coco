/**
 * Tests for init command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn().mockResolvedValue("test-project"),
  select: vi.fn().mockResolvedValue("typescript"),
  confirm: vi.fn().mockResolvedValue(true),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("{}"),
  },
}));

vi.mock("../../orchestrator/project.js", () => ({
  createProjectStructure: vi.fn().mockResolvedValue(undefined),
}));

describe("registerInitCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should register init command with program", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.command).toHaveBeenCalledWith("init");
  });

  it("should have description", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.description).toHaveBeenCalledWith(
      "Initialize a new Corbat-Coco project"
    );
  });

  it("should accept path argument", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.argument).toHaveBeenCalledWith(
      "[path]",
      "Project directory path",
      "."
    );
  });

  it("should have template option", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledWith(
      "-t, --template <template>",
      "Project template to use"
    );
  });

  it("should have yes option", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledWith(
      "-y, --yes",
      "Skip prompts and use defaults"
    );
  });

  it("should have skip-discovery option", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.option).toHaveBeenCalledWith(
      "--skip-discovery",
      "Skip the discovery phase (use existing spec)"
    );
  });

  it("should register action handler", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    expect(mockProgram.action).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should chain all configuration methods", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    // Verify the chain was called correctly
    expect(mockProgram.command).toHaveBeenCalledTimes(1);
    expect(mockProgram.description).toHaveBeenCalledTimes(1);
    expect(mockProgram.argument).toHaveBeenCalledTimes(1);
    expect(mockProgram.option).toHaveBeenCalledTimes(3); // template, yes, skip-discovery
    expect(mockProgram.action).toHaveBeenCalledTimes(1);
  });

  it("should capture action handler that is callable", async () => {
    const { registerInitCommand } = await import("./init.js");

    let actionHandler: ((path: string, options: { template?: string; yes?: boolean; skipDiscovery?: boolean }) => Promise<void>) | null = null;

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        actionHandler = handler;
        return mockProgram;
      }),
    };

    registerInitCommand(mockProgram as any);

    expect(actionHandler).not.toBeNull();
    expect(typeof actionHandler).toBe("function");
  });
});

describe("init command integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have default path argument value of current directory", async () => {
    const { registerInitCommand } = await import("./init.js");

    const mockProgram = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      argument: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    registerInitCommand(mockProgram as any);

    // Third argument should be the default value "."
    expect(mockProgram.argument).toHaveBeenCalledWith(
      "[path]",
      expect.any(String),
      "."
    );
  });

  it("should register command before description", async () => {
    const { registerInitCommand } = await import("./init.js");

    const callOrder: string[] = [];

    const mockProgram = {
      command: vi.fn(() => {
        callOrder.push("command");
        return mockProgram;
      }),
      description: vi.fn(() => {
        callOrder.push("description");
        return mockProgram;
      }),
      argument: vi.fn(() => {
        callOrder.push("argument");
        return mockProgram;
      }),
      option: vi.fn(() => {
        callOrder.push("option");
        return mockProgram;
      }),
      action: vi.fn(() => {
        callOrder.push("action");
        return mockProgram;
      }),
    };

    registerInitCommand(mockProgram as any);

    expect(callOrder[0]).toBe("command");
    expect(callOrder[1]).toBe("description");
  });
});
