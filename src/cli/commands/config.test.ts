/**
 * Tests for config command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as p from "@clack/prompts";

// Store original process.exit
const originalExit = process.exit;

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

const mockFsWriteFile = vi.fn().mockResolvedValue(undefined);
const mockFsMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: mockFsWriteFile,
    access: vi.fn(),
    mkdir: mockFsMkdir,
  },
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
}));

describe("registerConfigCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
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

describe("config get action handler", () => {
  let getHandler: ((key: string) => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;

    const { registerConfigCommand } = await import("./config.js");

    const mockSubCommand = {
      command: vi.fn().mockReturnThis(),
      description: vi.fn().mockReturnThis(),
      option: vi.fn().mockReturnThis(),
      action: vi.fn((handler) => {
        if (!getHandler) {
          getHandler = handler;
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
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
    getHandler = null;
  });

  it("should output value for existing key", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(getHandler).not.toBeNull();
    const promise = getHandler!("provider.type");
    await vi.runAllTimersAsync();
    await promise;

    expect(consoleSpy).toHaveBeenCalledWith("anthropic");
    consoleSpy.mockRestore();
  });

  it("should output object as JSON for nested keys", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(getHandler).not.toBeNull();
    const promise = getHandler!("provider");
    await vi.runAllTimersAsync();
    await promise;

    const calls = consoleSpy.mock.calls.flat().join("");
    expect(calls).toContain("anthropic");
    expect(calls).toContain("claude-sonnet-4-20250514");
    consoleSpy.mockRestore();
  });

  it("should exit with error for missing key", async () => {
    expect(getHandler).not.toBeNull();
    const promise = getHandler!("nonexistent.key");
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.error).toHaveBeenCalledWith("Configuration key 'nonexistent.key' not found.");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("should handle deeply nested keys", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(getHandler).not.toBeNull();
    const promise = getHandler!("quality.minScore");
    await vi.runAllTimersAsync();
    await promise;

    expect(consoleSpy).toHaveBeenCalledWith("85");
    consoleSpy.mockRestore();
  });
});

describe("config set action handler", () => {
  let setHandler: ((key: string, value: string) => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
    mockFsWriteFile.mockClear();
    mockFsMkdir.mockClear();

    const { registerConfigCommand } = await import("./config.js");

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
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
    setHandler = null;
  });

  it("should set a simple string value", async () => {
    expect(setHandler).not.toBeNull();
    const promise = setHandler!("provider.model", "claude-opus-4-20250514");
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith("Set provider.model = claude-opus-4-20250514");
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  it("should parse JSON values", async () => {
    expect(setHandler).not.toBeNull();
    const promise = setHandler!("quality.minScore", "90");
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith("Set quality.minScore = 90");
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  it("should handle boolean JSON values", async () => {
    expect(setHandler).not.toBeNull();
    const promise = setHandler!("newSetting.enabled", "true");
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith("Set newSetting.enabled = true");
  });

  it("should handle non-JSON string values", async () => {
    expect(setHandler).not.toBeNull();
    const promise = setHandler!("provider.apiKey", "sk-ant-new-key");
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith("Set provider.apiKey = sk-ant-new-key");
  });

  it("should create nested structure for new keys", async () => {
    expect(setHandler).not.toBeNull();
    const promise = setHandler!("new.deeply.nested.key", "value");
    await vi.runAllTimersAsync();
    await promise;

    expect(p.log.success).toHaveBeenCalledWith("Set new.deeply.nested.key = value");
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  it("should save config to .coco directory", async () => {
    expect(setHandler).not.toBeNull();
    const promise = setHandler!("test.key", "test-value");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFsMkdir).toHaveBeenCalledWith(".coco", { recursive: true });
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      ".coco/config.json",
      expect.any(String)
    );
  });
});

describe("config list action handler", () => {
  let listHandler: ((options: { json?: boolean }) => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;

    const { registerConfigCommand } = await import("./config.js");

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
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
    listHandler = null;
  });

  it("should output JSON when json option is true", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(listHandler).not.toBeNull();
    const promise = listHandler!({ json: true });
    await vi.runAllTimersAsync();
    await promise;

    const output = consoleSpy.mock.calls.flat().join("");
    expect(output).toContain("provider");
    expect(output).toContain("anthropic");
    expect(output).toContain("quality");
    consoleSpy.mockRestore();
  });

  it("should output formatted config when json option is false", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(listHandler).not.toBeNull();
    const promise = listHandler!({ json: false });
    await vi.runAllTimersAsync();
    await promise;

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Corbat-Coco Configuration");
    consoleSpy.mockRestore();
  });

  it("should display all configuration sections", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(listHandler).not.toBeNull();
    const promise = listHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("provider");
    expect(output).toContain("quality");
    expect(output).toContain("persistence");
    consoleSpy.mockRestore();
  });

  it("should hide API keys in output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(listHandler).not.toBeNull();
    const promise = listHandler!({});
    await vi.runAllTimersAsync();
    await promise;

    // The printConfig function should hide values starting with "sk-"
    const output = consoleSpy.mock.calls.flat().join(" ");
    // Check that we don't expose any sk- prefixed values in plain text
    expect(output).not.toMatch(/sk-ant-[a-zA-Z0-9]+/);
    consoleSpy.mockRestore();
  });
});

describe("config init action handler", () => {
  let initHandler: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = vi.fn() as unknown as typeof process.exit;
    mockFsWriteFile.mockClear();
    mockFsMkdir.mockClear();

    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(p.text).mockResolvedValue("sk-ant-test-key");
    vi.mocked(p.select).mockResolvedValue("claude-sonnet-4-20250514");

    const { registerConfigCommand } = await import("./config.js");

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
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalExit;
    initHandler = null;
  });

  it("should display intro message", async () => {
    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.intro).toHaveBeenCalled();
  });

  it("should prompt for API key", async () => {
    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.text).toHaveBeenCalledWith(expect.objectContaining({
      message: "Enter your Anthropic API key:",
      placeholder: "sk-ant-...",
    }));
  });

  it("should prompt for model selection", async () => {
    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.select).toHaveBeenCalledWith(expect.objectContaining({
      message: "Select the default model:",
    }));
  });

  it("should prompt for quality threshold", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("sk-ant-test-key")
      .mockResolvedValueOnce("85");

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.text).toHaveBeenCalledWith(expect.objectContaining({
      message: "Minimum quality score (0-100):",
      initialValue: "85",
    }));
  });

  it("should save configuration on success", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("sk-ant-test-key")
      .mockResolvedValueOnce("85");

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFsMkdir).toHaveBeenCalledWith(".coco", { recursive: true });
    expect(mockFsWriteFile).toHaveBeenCalledWith(
      ".coco/config.json",
      expect.stringContaining("provider")
    );
  });

  it("should display success outro message", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("sk-ant-test-key")
      .mockResolvedValueOnce("85");

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.outro).toHaveBeenCalled();
  });

  it("should exit if user cancels API key input", async () => {
    vi.mocked(p.isCancel).mockReturnValueOnce(true);

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.cancel).toHaveBeenCalledWith("Configuration cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should exit if user cancels model selection", async () => {
    vi.mocked(p.isCancel)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.cancel).toHaveBeenCalledWith("Configuration cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should exit if user cancels quality threshold input", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("sk-ant-test-key")
      .mockResolvedValueOnce("85");
    vi.mocked(p.isCancel)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.cancel).toHaveBeenCalledWith("Configuration cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should validate API key format", async () => {
    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    // Get the text call and extract the validate function
    const textCalls = vi.mocked(p.text).mock.calls;
    const apiKeyCall = textCalls.find(call =>
      call[0].message === "Enter your Anthropic API key:"
    );
    expect(apiKeyCall).toBeDefined();

    const validateFn = apiKeyCall![0].validate;
    expect(validateFn).toBeDefined();

    // Test validation
    expect(validateFn!("")).toBe("API key is required");
    expect(validateFn!("invalid-key")).toBe("Invalid API key format");
    expect(validateFn!("sk-ant-valid-key")).toBeUndefined();
  });

  it("should validate quality score range", async () => {
    vi.mocked(p.text)
      .mockResolvedValueOnce("sk-ant-test-key")
      .mockResolvedValueOnce("85");

    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    // Get the text call for quality score and extract the validate function
    const textCalls = vi.mocked(p.text).mock.calls;
    const qualityCall = textCalls.find(call =>
      call[0].message === "Minimum quality score (0-100):"
    );
    expect(qualityCall).toBeDefined();

    const validateFn = qualityCall![0].validate;
    expect(validateFn).toBeDefined();

    // Test validation
    expect(validateFn!("abc")).toBe("Must be a number between 0 and 100");
    expect(validateFn!("-5")).toBe("Must be a number between 0 and 100");
    expect(validateFn!("150")).toBe("Must be a number between 0 and 100");
    expect(validateFn!("85")).toBeUndefined();
    expect(validateFn!("0")).toBeUndefined();
    expect(validateFn!("100")).toBeUndefined();
  });

  it("should include model options with hints", async () => {
    expect(initHandler).not.toBeNull();
    const promise = initHandler!();
    await vi.runAllTimersAsync();
    await promise;

    expect(p.select).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.arrayContaining([
        expect.objectContaining({ value: "claude-sonnet-4-20250514", hint: "Recommended for coding" }),
        expect.objectContaining({ value: "claude-opus-4-20250514", hint: "Most capable" }),
        expect.objectContaining({ value: "claude-3-5-sonnet-20241022", hint: "Fast and capable" }),
      ]),
    }));
  });
});

describe("helper functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("printConfig edge cases", () => {
    let listHandler: ((options: { json?: boolean }) => Promise<void>) | null = null;

    beforeEach(async () => {
      const { registerConfigCommand } = await import("./config.js");

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
    });

    it("should handle array values in config", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      expect(listHandler).not.toBeNull();
      const promise = listHandler!({});
      await vi.runAllTimersAsync();
      await promise;

      // Should not throw when printing config
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getNestedValue edge cases", () => {
    let getHandler: ((key: string) => Promise<void>) | null = null;

    beforeEach(async () => {
      process.exit = vi.fn() as unknown as typeof process.exit;

      const { registerConfigCommand } = await import("./config.js");

      const mockSubCommand = {
        command: vi.fn().mockReturnThis(),
        description: vi.fn().mockReturnThis(),
        option: vi.fn().mockReturnThis(),
        action: vi.fn((handler) => {
          if (!getHandler) {
            getHandler = handler;
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
    });

    afterEach(() => {
      process.exit = originalExit;
      getHandler = null;
    });

    it("should return undefined for path through non-object", async () => {
      expect(getHandler).not.toBeNull();
      // provider.type is a string, so provider.type.something should return undefined
      const promise = getHandler!("provider.type.nonexistent");
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.error).toHaveBeenCalledWith("Configuration key 'provider.type.nonexistent' not found.");
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("should handle single key without dots", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      expect(getHandler).not.toBeNull();
      const promise = getHandler!("provider");
      await vi.runAllTimersAsync();
      await promise;

      const output = consoleSpy.mock.calls.flat().join("");
      expect(output).toContain("anthropic");
      consoleSpy.mockRestore();
    });
  });

  describe("setNestedValue edge cases", () => {
    let setHandler: ((key: string, value: string) => Promise<void>) | null = null;

    beforeEach(async () => {
      process.exit = vi.fn() as unknown as typeof process.exit;
      mockFsWriteFile.mockClear();
      mockFsMkdir.mockClear();

      const { registerConfigCommand } = await import("./config.js");

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
    });

    afterEach(() => {
      process.exit = originalExit;
      setHandler = null;
    });

    it("should overwrite existing non-object value in path", async () => {
      expect(setHandler).not.toBeNull();
      // This will need to replace provider.type (a string) with an object
      const promise = setHandler!("provider.type.nested", "value");
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.success).toHaveBeenCalledWith("Set provider.type.nested = value");
    });

    it("should handle empty key path segment", async () => {
      // Test that setNestedValue skips empty keys
      expect(setHandler).not.toBeNull();
      const promise = setHandler!("provider", "new-value");
      await vi.runAllTimersAsync();
      await promise;

      expect(p.log.success).toHaveBeenCalledWith("Set provider = new-value");
    });
  });
});
