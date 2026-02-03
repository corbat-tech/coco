/**
 * Tests for init command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as p from "@clack/prompts";
import { createProjectStructure } from "../../orchestrator/project.js";

// Store original process.exit to restore after tests
const originalExit = process.exit;

// Mock access function
const mockFsAccess = vi.fn();

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  isCancel: vi.fn(),
  cancel: vi.fn(),
}));

// Mock node:fs/promises - the source uses dynamic import and accesses fs.access
vi.mock("node:fs/promises", () => ({
  default: {
    access: mockFsAccess,
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
  access: mockFsAccess,
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

// Mock createProjectStructure
vi.mock("../../orchestrator/project.js", () => ({
  createProjectStructure: vi.fn(),
}));

describe("registerInitCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
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
});

describe("init action handler - runInit", () => {
  let actionHandler: ((path: string, options: { template?: string; yes?: boolean; skipDiscovery?: boolean }) => Promise<void>) | null = null;

  function setupDefaultMocks() {
    // Reset all mocks first
    mockFsAccess.mockReset();
    vi.mocked(createProjectStructure).mockReset();
    vi.mocked(p.spinner).mockReset();
    vi.mocked(p.isCancel).mockReset();
    vi.mocked(p.text).mockReset();
    vi.mocked(p.select).mockReset();
    vi.mocked(p.confirm).mockReset();
    vi.mocked(p.intro).mockReset();
    vi.mocked(p.outro).mockReset();
    vi.mocked(p.cancel).mockReset();

    // Setup default mock behaviors - no existing project, no cancels
    mockFsAccess.mockRejectedValue(new Error("ENOENT"));
    vi.mocked(createProjectStructure).mockResolvedValue(undefined);
    vi.mocked(p.spinner).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    });
    vi.mocked(p.isCancel).mockReturnValue(false);
    vi.mocked(p.text).mockResolvedValue("test-project");
    vi.mocked(p.select).mockResolvedValue("typescript");
    vi.mocked(p.confirm).mockResolvedValue(true);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
    setupDefaultMocks();

    const { registerInitCommand } = await import("./init.js");

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
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it("should display intro message", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(p.intro).toHaveBeenCalled();
  });

  it("should use default project info when --yes flag is provided", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(createProjectStructure).toHaveBeenCalledWith(".", {
      name: "my-project",
      description: "",
      language: "typescript",
    });
  });

  it("should use path as project name when not current directory", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!("my-awesome-app", { yes: true });

    expect(createProjectStructure).toHaveBeenCalledWith("my-awesome-app", {
      name: "my-awesome-app",
      description: "",
      language: "typescript",
    });
  });

  it("should handle nested path and extract last segment as name", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!("/some/path/to/my-project", { yes: true });

    expect(createProjectStructure).toHaveBeenCalledWith("/some/path/to/my-project", {
      name: "my-project",
      description: "",
      language: "typescript",
    });
  });

  it("should check for existing project", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(mockFsAccess).toHaveBeenCalledWith("./.coco");
  });

  it("should prompt to continue if project already exists", async () => {
    mockFsAccess.mockResolvedValue(undefined); // Project exists

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(p.confirm).toHaveBeenCalledWith({
      message: "A Corbat-Coco project already exists here. Continue anyway?",
    });
  });

  it("should exit if user cancels on existing project", async () => {
    mockFsAccess.mockResolvedValue(undefined); // Project exists
    vi.mocked(p.isCancel).mockReturnValue(true);

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(p.cancel).toHaveBeenCalledWith("Initialization cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should exit if user declines to continue on existing project", async () => {
    mockFsAccess.mockResolvedValue(undefined); // Project exists
    vi.mocked(p.confirm).mockResolvedValue(false);

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(p.cancel).toHaveBeenCalledWith("Initialization cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should gather project info interactively when --yes not provided", async () => {
    // Setup mocks for interactive flow
    let textCallCount = 0;
    vi.mocked(p.text).mockImplementation(async () => {
      textCallCount++;
      if (textCallCount === 1) return "my-interactive-project";
      return "A test project description";
    });
    vi.mocked(p.select).mockResolvedValue("python");
    vi.mocked(p.isCancel).mockReturnValue(false);

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    expect(p.text).toHaveBeenCalledTimes(2);
    expect(p.select).toHaveBeenCalledTimes(1);
    expect(createProjectStructure).toHaveBeenCalledWith(".", {
      name: "my-interactive-project",
      description: "A test project description",
      language: "python",
    });
  });

  it("should exit if user cancels during project name input", async () => {
    vi.mocked(p.text).mockResolvedValue(Symbol.for("cancel") as any);
    vi.mocked(p.isCancel).mockReturnValue(true);

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    expect(p.cancel).toHaveBeenCalledWith("Initialization cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should exit if user cancels during description input", async () => {
    let textCallCount = 0;
    vi.mocked(p.text).mockImplementation(async () => {
      textCallCount++;
      if (textCallCount === 1) return "my-project";
      return Symbol.for("cancel") as any;
    });

    let isCancelCallCount = 0;
    vi.mocked(p.isCancel).mockImplementation(() => {
      isCancelCallCount++;
      // First call is for name (not cancelled), second call is for description (cancelled)
      return isCancelCallCount >= 2;
    });

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    expect(p.cancel).toHaveBeenCalledWith("Initialization cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should exit if user cancels during language selection", async () => {
    let textCallCount = 0;
    vi.mocked(p.text).mockImplementation(async () => {
      textCallCount++;
      if (textCallCount === 1) return "my-project";
      return "A description";
    });
    vi.mocked(p.select).mockResolvedValue(Symbol.for("cancel") as any);

    let isCancelCallCount = 0;
    vi.mocked(p.isCancel).mockImplementation(() => {
      isCancelCallCount++;
      // First two calls for name and description (not cancelled), third for language (cancelled)
      return isCancelCallCount >= 3;
    });

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    expect(p.cancel).toHaveBeenCalledWith("Initialization cancelled.");
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("should use spinner while creating project structure", async () => {
    const mockSpinnerInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(mockSpinnerInstance.start).toHaveBeenCalledWith("Creating project structure...");
    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("Project structure created.");
  });

  it("should stop spinner and rethrow on createProjectStructure error", async () => {
    const mockSpinnerInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.mocked(p.spinner).mockReturnValue(mockSpinnerInstance);
    vi.mocked(createProjectStructure).mockRejectedValue(new Error("Create failed"));

    expect(actionHandler).not.toBeNull();
    await expect(actionHandler!(".", { yes: true })).rejects.toThrow("Create failed");

    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("Failed to create project structure.");
  });

  it("should display success outro message", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", { yes: true });

    expect(p.outro).toHaveBeenCalled();
  });

  it("should handle empty description gracefully", async () => {
    let textCallCount = 0;
    vi.mocked(p.text).mockImplementation(async () => {
      textCallCount++;
      if (textCallCount === 1) return "my-project";
      return "";  // Empty description
    });
    vi.mocked(p.select).mockResolvedValue("go");
    vi.mocked(p.isCancel).mockReturnValue(false);

    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    expect(createProjectStructure).toHaveBeenCalledWith(".", {
      name: "my-project",
      description: "",
      language: "go",
    });
  });

  it("should validate project name format", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    // Verify text was called with validation
    expect(p.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "What is your project name?",
        validate: expect.any(Function),
      })
    );

    // Get the validation function and test it
    const textCalls = vi.mocked(p.text).mock.calls;
    const projectNameCall = textCalls.find(call =>
      call[0].message === "What is your project name?"
    );
    expect(projectNameCall).toBeDefined();

    const validateFn = projectNameCall![0].validate;
    expect(validateFn).toBeDefined();

    // Test validation
    expect(validateFn!("")).toBe("Project name is required");
    expect(validateFn!("Invalid Name")).toBe("Use lowercase letters, numbers, and hyphens only");
    expect(validateFn!("valid-name")).toBeUndefined();
  });

  it("should show language options with TypeScript recommended", async () => {
    expect(actionHandler).not.toBeNull();
    await actionHandler!(".", {});

    expect(p.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "What programming language?",
        options: expect.arrayContaining([
          expect.objectContaining({ value: "typescript", hint: "Recommended" }),
        ]),
      })
    );
  });
});

describe("init command integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
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
