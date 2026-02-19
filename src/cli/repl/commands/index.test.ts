/**
 * Tests for slash command registry
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the command modules
vi.mock("./help.js", () => ({
  helpCommand: {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available commands",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("./clear.js", () => ({
  clearCommand: {
    name: "clear",
    aliases: ["cls"],
    description: "Clear the screen",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("./exit.js", () => ({
  exitCommand: {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Exit the REPL",
    execute: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("./model.js", () => ({
  modelCommand: {
    name: "model",
    aliases: ["m"],
    description: "Change model",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("./status.js", () => ({
  statusCommand: {
    name: "status",
    aliases: ["s"],
    description: "Show status",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("./diff.js", () => ({
  diffCommand: {
    name: "diff",
    aliases: ["d"],
    description: "Show diff",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("./commit.js", () => ({
  commitCommand: {
    name: "commit",
    aliases: ["c"],
    description: "Commit changes",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("./compact.js", () => ({
  compactCommand: {
    name: "compact",
    aliases: [],
    description: "Toggle compact mode",
    execute: vi.fn().mockResolvedValue(false),
  },
  isCompactMode: vi.fn().mockReturnValue(false),
}));

vi.mock("./cost.js", () => ({
  costCommand: {
    name: "cost",
    aliases: ["$"],
    description: "Show token usage",
    execute: vi.fn().mockResolvedValue(false),
  },
  addTokenUsage: vi.fn(),
  resetTokenUsage: vi.fn(),
  getTokenUsage: vi.fn().mockReturnValue({ input: 0, output: 0, cost: 0 }),
}));

vi.mock("./undo.js", () => ({
  undoCommand: {
    name: "undo",
    aliases: ["u"],
    description: "Undo last action",
    execute: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("../output/renderer.js", () => ({
  renderError: vi.fn(),
}));

describe("isSlashCommand", () => {
  it("should return true for slash commands", async () => {
    const { isSlashCommand } = await import("./index.js");

    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("/exit")).toBe(true);
    expect(isSlashCommand("/status")).toBe(true);
  });

  it("should return false for non-slash commands", async () => {
    const { isSlashCommand } = await import("./index.js");

    expect(isSlashCommand("help")).toBe(false);
    expect(isSlashCommand("Hello world")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
  });
});

describe("parseSlashCommand", () => {
  it("should parse command without arguments", async () => {
    const { parseSlashCommand } = await import("./index.js");

    const result = parseSlashCommand("/help");

    expect(result.command).toBe("help");
    expect(result.args).toEqual([]);
  });

  it("should parse command with arguments", async () => {
    const { parseSlashCommand } = await import("./index.js");

    const result = parseSlashCommand("/model claude-sonnet");

    expect(result.command).toBe("model");
    expect(result.args).toEqual(["claude-sonnet"]);
  });

  it("should parse command with multiple arguments", async () => {
    const { parseSlashCommand } = await import("./index.js");

    const result = parseSlashCommand("/commit -m 'message here'");

    expect(result.command).toBe("commit");
    expect(result.args).toEqual(["-m", "'message", "here'"]);
  });

  it("should handle empty input after slash", async () => {
    const { parseSlashCommand } = await import("./index.js");

    const result = parseSlashCommand("/");

    expect(result.command).toBe("");
    expect(result.args).toEqual([]);
  });

  it("should lowercase command name", async () => {
    const { parseSlashCommand } = await import("./index.js");

    const result = parseSlashCommand("/HELP");

    expect(result.command).toBe("help");
  });
});

describe("executeSlashCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute known command", async () => {
    const { executeSlashCommand } = await import("./index.js");
    const { helpCommand } = await import("./help.js");

    const mockSession = { id: "test", messages: [] } as any;
    const result = await executeSlashCommand("help", [], mockSession);

    expect(helpCommand.execute).toHaveBeenCalledWith([], mockSession);
    expect(result).toEqual({ shouldExit: false });
  });

  it("should execute command by alias", async () => {
    const { executeSlashCommand } = await import("./index.js");
    const { exitCommand } = await import("./exit.js");

    const mockSession = { id: "test", messages: [] } as any;
    const result = await executeSlashCommand("q", [], mockSession);

    expect(exitCommand.execute).toHaveBeenCalledWith([], mockSession);
    expect(result).toEqual({ shouldExit: true });
  });

  it("should show error for unknown command", async () => {
    const { executeSlashCommand } = await import("./index.js");
    const { renderError } = await import("../output/renderer.js");

    const mockSession = { id: "test", messages: [] } as any;
    const result = await executeSlashCommand("unknown", [], mockSession);

    expect(renderError).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
    expect(result).toEqual({ shouldExit: false });
  });
});

describe("getAllCommands", () => {
  it("should return all registered commands", async () => {
    const { getAllCommands } = await import("./index.js");

    const commands = getAllCommands();

    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some((c) => c.name === "help")).toBe(true);
    expect(commands.some((c) => c.name === "exit")).toBe(true);
    expect(commands.some((c) => c.name === "model")).toBe(true);
  });
});

describe("re-exports", () => {
  it("should export token usage utilities", async () => {
    const { addTokenUsage, resetTokenUsage, getTokenUsage } = await import("./index.js");

    expect(addTokenUsage).toBeDefined();
    expect(resetTokenUsage).toBeDefined();
    expect(getTokenUsage).toBeDefined();
  });

  it("should export compact mode utility", async () => {
    const { isCompactMode } = await import("./index.js");

    expect(isCompactMode).toBeDefined();
  });
});
