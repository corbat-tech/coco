/**
 * Tests for commands/index.ts — slash command registry
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the renderer to avoid terminal deps
vi.mock("../output/renderer.js", () => ({
  renderError: vi.fn(),
}));

// Mock clack prompts
vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  isCancel: vi.fn().mockReturnValue(false),
  note: vi.fn(),
}));

import { isSlashCommand, parseSlashCommand, executeSlashCommand, getAllCommands } from "./index.js";
import { renderError } from "../output/renderer.js";

describe("commands/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isSlashCommand", () => {
    it("should return true for commands starting with /", () => {
      expect(isSlashCommand("/help")).toBe(true);
      expect(isSlashCommand("/exit")).toBe(true);
      expect(isSlashCommand("/model gpt-4")).toBe(true);
    });

    it("should return false for non-commands", () => {
      expect(isSlashCommand("hello")).toBe(false);
      expect(isSlashCommand("")).toBe(false);
      expect(isSlashCommand("help")).toBe(false);
    });
  });

  describe("parseSlashCommand", () => {
    it("should parse command name", () => {
      const result = parseSlashCommand("/help");
      expect(result.command).toBe("help");
      expect(result.args).toEqual([]);
    });

    it("should parse command with args", () => {
      const result = parseSlashCommand("/model gpt-4o");
      expect(result.command).toBe("model");
      expect(result.args).toEqual(["gpt-4o"]);
    });

    it("should parse multiple args", () => {
      const result = parseSlashCommand("/task run test-suite");
      expect(result.command).toBe("task");
      expect(result.args).toEqual(["run", "test-suite"]);
    });

    it("should lowercase command name", () => {
      const result = parseSlashCommand("/HELP");
      expect(result.command).toBe("help");
    });

    it("should handle empty command", () => {
      const result = parseSlashCommand("/");
      expect(result.command).toBe("");
      expect(result.args).toEqual([]);
    });
  });

  describe("getAllCommands", () => {
    it("should return an array of commands", () => {
      const commands = getAllCommands();
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(10);
    });

    it("should include help command", () => {
      const commands = getAllCommands();
      const help = commands.find((c) => c.name === "help");
      expect(help).toBeDefined();
      expect(help!.description).toBeTruthy();
    });

    it("should include exit command", () => {
      const commands = getAllCommands();
      const exit = commands.find((c) => c.name === "exit");
      expect(exit).toBeDefined();
    });

    it("should include model command", () => {
      const commands = getAllCommands();
      const model = commands.find((c) => c.name === "model");
      expect(model).toBeDefined();
    });

    it("should include status command", () => {
      const commands = getAllCommands();
      const status = commands.find((c) => c.name === "status");
      expect(status).toBeDefined();
    });

    it("should include rewind command", () => {
      const commands = getAllCommands();
      const rewind = commands.find((c) => c.name === "rewind");
      expect(rewind).toBeDefined();
    });

    it("should include coco command", () => {
      const commands = getAllCommands();
      const coco = commands.find((c) => c.name === "coco");
      expect(coco).toBeDefined();
    });

    it("all commands should have required fields", () => {
      const commands = getAllCommands();
      for (const cmd of commands) {
        expect(cmd.name).toBeTruthy();
        expect(cmd.description).toBeTruthy();
        expect(Array.isArray(cmd.aliases)).toBe(true);
        expect(typeof cmd.execute).toBe("function");
      }
    });
  });

  describe("executeSlashCommand", () => {
    it("should call renderError for unknown commands", async () => {
      const session = {} as any;
      const result = await executeSlashCommand("nonexistent", [], session);
      expect(result).toEqual({ shouldExit: false });
      expect(renderError).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
    });

    it("should execute exit command", async () => {
      const session = {} as any;
      const result = await executeSlashCommand("exit", [], session);
      // exit command returns { shouldExit: true } to signal REPL exit
      expect(result).toEqual({ shouldExit: true });
    });

    it("should find commands by alias", async () => {
      const commands = getAllCommands();
      const exitCmd = commands.find((c) => c.name === "exit");
      if (exitCmd?.aliases.includes("quit")) {
        const result = await executeSlashCommand("quit", [], {} as any);
        expect(result).toEqual({ shouldExit: true });
      }
    });
  });
});
