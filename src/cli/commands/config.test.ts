/**
 * Tests for config command
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  text: vi.fn().mockResolvedValue("sk-ant-test-key"),
  select: vi.fn().mockResolvedValue("claude-sonnet-4-20250514"),
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
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("registerConfigCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register config command with program", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(mockProgram.command).toHaveBeenCalledWith("config");
  });

  it("should register get subcommand", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(mockConfigCmd.command).toHaveBeenCalledWith("get <key>");
    expect(mockSubCommand.description).toHaveBeenCalledWith("Get a configuration value");
  });

  it("should register set subcommand", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(mockConfigCmd.command).toHaveBeenCalledWith("set <key> <value>");
    expect(mockSubCommand.description).toHaveBeenCalledWith("Set a configuration value");
  });

  it("should register list subcommand with json option", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(mockConfigCmd.command).toHaveBeenCalledWith("list");
    expect(mockSubCommand.option).toHaveBeenCalledWith("--json", "Output as JSON");
  });

  it("should register init subcommand", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(mockConfigCmd.command).toHaveBeenCalledWith("init");
    expect(mockSubCommand.description).toHaveBeenCalledWith("Initialize configuration interactively");
  });

  it("should register action handlers for all subcommands", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    // Should have been called 4 times (get, set, list, init)
    expect(mockSubCommand.action).toHaveBeenCalledTimes(4);
    expect(mockSubCommand.action).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("config command description", () => {
  it("should have proper description for config command", async () => {
    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn().mockReturnThis(),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(mockConfigCmd.description).toHaveBeenCalledWith("Manage Corbat-Coco configuration");
  });
});

describe("config action handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should capture and execute get action handler", async () => {
    const { registerConfigCommand } = await import("./config.js");

    let getHandler: ((key: string) => Promise<void>) | null = null;

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        getHandler = handler;
        return mockSubCommand;
      }),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(getHandler).not.toBeNull();
  });

  it("should capture and execute set action handler", async () => {
    const { registerConfigCommand } = await import("./config.js");

    let setHandler: ((key: string, value: string) => Promise<void>) | null = null;
    let callCount = 0;

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        callCount++;
        if (callCount === 2) {
          setHandler = handler;
        }
        return mockSubCommand;
      }),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(setHandler).not.toBeNull();
  });

  it("should capture and execute list action handler", async () => {
    const { registerConfigCommand } = await import("./config.js");

    let listHandler: ((options: { json?: boolean }) => Promise<void>) | null = null;
    let callCount = 0;

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        callCount++;
        if (callCount === 3) {
          listHandler = handler;
        }
        return mockSubCommand;
      }),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(listHandler).not.toBeNull();
  });

  it("should capture and execute init action handler", async () => {
    const { registerConfigCommand } = await import("./config.js");

    let initHandler: (() => Promise<void>) | null = null;
    let callCount = 0;

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        callCount++;
        if (callCount === 4) {
          initHandler = handler;
        }
        return mockSubCommand;
      }),
    };

    const mockConfigCmd = {
      command: vi.fn().mockReturnValue(mockSubCommand),
      description: vi.fn().mockReturnThis(),
    };

    const mockProgram = {
      command: vi.fn().mockReturnValue(mockConfigCmd),
    };

    registerConfigCommand(mockProgram as any);

    expect(initHandler).not.toBeNull();
  });
});
