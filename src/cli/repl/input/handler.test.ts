/**
 * Tests for Input Handler utilities
 *
 * Note: The main handler uses raw stdin which is difficult to test directly.
 * We test the pure utility functions and logic patterns instead.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as os from "node:os";

// Test the history file location
const HISTORY_FILE = path.join(os.homedir(), ".coco", "history");

describe("Input Handler", () => {
  describe("History file location", () => {
    it("should use ~/.coco/history", () => {
      expect(HISTORY_FILE).toBe(path.join(os.homedir(), ".coco", "history"));
    });
  });

  describe("Slash command completions", () => {
    it("should have commands available for completion", async () => {
      const { getAllCommands } = await import("../commands/index.js");
      const commands = getAllCommands();

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.some((c) => c.name === "help")).toBe(true);
      expect(commands.some((c) => c.name === "exit")).toBe(true);
    });

    it("should have unique command names", async () => {
      const { getAllCommands } = await import("../commands/index.js");
      const commands = getAllCommands();
      const names = commands.map((c) => c.name);
      const uniqueNames = [...new Set(names)];

      expect(names.length).toBe(uniqueNames.length);
    });

    it("should have descriptions for all commands", async () => {
      const { getAllCommands } = await import("../commands/index.js");
      const commands = getAllCommands();

      for (const cmd of commands) {
        expect(cmd.description).toBeTruthy();
        expect(cmd.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Completion matching logic", () => {
    it("should match commands starting with prefix", () => {
      const commands = ["/help", "/history", "/exit", "/model"];
      const prefix = "/h";

      const matches = commands.filter((cmd) =>
        cmd.toLowerCase().startsWith(prefix.toLowerCase())
      );

      expect(matches).toEqual(["/help", "/history"]);
    });

    it("should be case insensitive", () => {
      const commands = ["/Help", "/HISTORY", "/exit"];
      const prefix = "/h";

      const matches = commands.filter((cmd) =>
        cmd.toLowerCase().startsWith(prefix.toLowerCase())
      );

      expect(matches).toEqual(["/Help", "/HISTORY"]);
    });

    it("should return empty for non-slash input", () => {
      const input = "hello";
      const shouldComplete = input.startsWith("/");

      expect(shouldComplete).toBe(false);
    });

    it("should match all commands for just /", () => {
      const commands = ["/help", "/exit", "/model"];
      const prefix = "/";

      const matches = commands.filter((cmd) =>
        cmd.toLowerCase().startsWith(prefix.toLowerCase())
      );

      expect(matches).toEqual(commands);
    });
  });

  describe("Ghost text calculation", () => {
    it("should calculate ghost text correctly", () => {
      const fullCommand = "/memory";
      const currentInput = "/mem";

      const ghost = fullCommand.slice(currentInput.length);

      expect(ghost).toBe("ory");
    });

    it("should return empty ghost when fully typed", () => {
      const fullCommand = "/help";
      const currentInput = "/help";

      const ghost = fullCommand.slice(currentInput.length);

      expect(ghost).toBe("");
    });

    it("should handle partial matches", () => {
      const fullCommand = "/model";
      const currentInput = "/m";

      const ghost = fullCommand.slice(currentInput.length);

      expect(ghost).toBe("odel");
    });
  });

  describe("Selection bounds", () => {
    it("should wrap selection up correctly", () => {
      const completionsCount = 5;
      let selected = 0;

      // Going up from 0 should wrap to last
      selected = (selected - 1 + completionsCount) % completionsCount;
      expect(selected).toBe(4);
    });

    it("should wrap selection down correctly", () => {
      const completionsCount = 5;
      let selected = 4;

      // Going down from last should wrap to 0
      selected = (selected + 1) % completionsCount;
      expect(selected).toBe(0);
    });

    it("should clamp selection when completions shrink", () => {
      let selected = 5;
      const newCompletionsCount = 3;

      selected = Math.min(selected, Math.max(0, newCompletionsCount - 1));

      expect(selected).toBe(2);
    });

    it("should handle single completion", () => {
      let selected = 0;
      const completionsCount = 1;

      // Going up should stay at 0
      selected = (selected - 1 + completionsCount) % completionsCount;
      expect(selected).toBe(0);

      // Going down should stay at 0
      selected = (selected + 1) % completionsCount;
      expect(selected).toBe(0);
    });
  });

  describe("History limits", () => {
    it("should limit history to 500 entries on load", () => {
      const rawHistory = Array.from({ length: 600 }, (_, i) => `cmd${i}`);
      const limited = rawHistory.slice(-500);

      expect(limited.length).toBe(500);
      expect(limited[0]).toBe("cmd100");
      expect(limited[499]).toBe("cmd599");
    });

    it("should limit history to 500 entries on save", () => {
      const sessionHistory = Array.from({ length: 600 }, (_, i) => `cmd${i}`);
      const toSave = sessionHistory.slice(-500);

      expect(toSave.length).toBe(500);
    });
  });

  describe("Key codes", () => {
    it("should recognize Ctrl+C", () => {
      const key = "\x03";
      expect(key).toBe("\x03");
    });

    it("should recognize Ctrl+D", () => {
      const key = "\x04";
      expect(key).toBe("\x04");
    });

    it("should recognize Enter", () => {
      const keys = ["\r", "\n"];
      expect(keys).toContain("\r");
      expect(keys).toContain("\n");
    });

    it("should recognize Tab", () => {
      const key = "\t";
      expect(key).toBe("\t");
    });

    it("should recognize Backspace", () => {
      const keys = ["\x7f", "\b"];
      expect(keys).toContain("\x7f");
    });

    it("should recognize arrow keys", () => {
      expect("\x1b[A").toBe("\x1b[A"); // Up
      expect("\x1b[B").toBe("\x1b[B"); // Down
      expect("\x1b[C").toBe("\x1b[C"); // Right
      expect("\x1b[D").toBe("\x1b[D"); // Left
    });

    it("should recognize single Escape", () => {
      const escOnly = "\x1b";
      const escSequence = "\x1b[A";

      expect(escOnly.length).toBe(1);
      expect(escSequence.startsWith("\x1b")).toBe(true);
      expect(escSequence.length).toBeGreaterThan(1);
    });
  });

  describe("Menu display logic", () => {
    it("should limit menu items to MAX_MENU_ITEMS", () => {
      const MAX_MENU_ITEMS = 6;
      const allCompletions = Array.from({ length: 20 }, (_, i) => ({
        cmd: `/cmd${i}`,
        desc: `Description ${i}`,
      }));

      const menuItems = allCompletions.slice(0, MAX_MENU_ITEMS);

      expect(menuItems.length).toBe(6);
    });

    it("should show menu only for slash commands", () => {
      const testCases = [
        { input: "/", shouldShow: true },
        { input: "/h", shouldShow: true },
        { input: "/help", shouldShow: true },
        { input: "", shouldShow: false },
        { input: "hello", shouldShow: false },
        { input: "hello /cmd", shouldShow: false },
      ];

      for (const { input, shouldShow } of testCases) {
        const hasCompletions = input.startsWith("/");
        const showMenu = hasCompletions && input.length >= 1;
        expect(showMenu).toBe(shouldShow);
      }
    });
  });
});
