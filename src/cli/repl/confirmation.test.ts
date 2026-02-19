/**
 * Tests for the confirmation system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ToolCall } from "../../providers/types.js";

// Mock chalk for predictable output testing with nested methods (e.g., green.bold)
vi.mock("chalk", () => ({
  default: {
    bold: (s: string) => `[bold]${s}[/bold]`,
    yellow: Object.assign((s: string) => `[yellow]${s}[/yellow]`, {
      bold: (s: string) => `[yellow.bold]${s}[/yellow.bold]`,
    }),
    cyan: Object.assign((s: string) => `[cyan]${s}[/cyan]`, {
      bold: (s: string) => `[cyan.bold]${s}[/cyan.bold]`,
    }),
    red: Object.assign((s: string) => `[red]${s}[/red]`, {
      bold: (s: string) => `[red.bold]${s}[/red.bold]`,
    }),
    green: Object.assign((s: string) => `[green]${s}[/green]`, {
      bold: (s: string) => `[green.bold]${s}[/green.bold]`,
    }),
    blue: Object.assign((s: string) => `[blue]${s}[/blue]`, {
      bold: (s: string) => `[blue.bold]${s}[/blue.bold]`,
    }),
    magenta: Object.assign((s: string) => `[magenta]${s}[/magenta]`, {
      bold: (s: string) => `[magenta.bold]${s}[/magenta.bold]`,
    }),
    dim: (s: string) => `[dim]${s}[/dim]`,
    white: (s: string) => `[white]${s}[/white]`,
  },
}));

// Mock fs/promises for checkFileExists
const mockFsAccess = vi.fn().mockRejectedValue(new Error("ENOENT")); // Default: file doesn't exist (create)
vi.mock("node:fs/promises", () => ({
  default: {
    access: mockFsAccess,
  },
}));

// Mock readline/promises (still needed for promptEditCommand)
const mockRlQuestion = vi.fn();
const mockRlClose = vi.fn();
const mockRlOn = vi.fn();

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({
    question: mockRlQuestion,
    close: mockRlClose,
    on: mockRlOn,
  })),
}));

/**
 * Helper: Create a mock stdin emitter and patch process.stdin for testing.
 * Simulates keypress by emitting "data" events with Buffer payloads.
 */
function createMockStdin() {
  const emitter = new EventEmitter();

  // Patch process.stdin methods for the confirmation system
  const onSpy = vi
    .spyOn(process.stdin, "on")
    .mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
      return process.stdin;
    });

  const removeListenerSpy = vi
    .spyOn(process.stdin, "removeListener")
    .mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      emitter.removeListener(event, handler);
      return process.stdin;
    });

  const isPausedSpy = vi.spyOn(process.stdin, "isPaused").mockReturnValue(false);
  const resumeSpy = vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);

  // Mock isTTY and setRawMode
  const originalIsTTY = process.stdin.isTTY;
  const originalIsRaw = (process.stdin as NodeJS.ReadStream).isRaw;
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isRaw", {
    value: false,
    configurable: true,
    writable: true,
  });
  const setRawModeSpy = vi.fn((_mode: boolean) => process.stdin);
  Object.defineProperty(process.stdin, "setRawMode", { value: setRawModeSpy, configurable: true });

  const sendKey = (key: string) => {
    // Small delay to ensure the listener is set up
    setImmediate(() => {
      emitter.emit("data", Buffer.from(key));
    });
  };

  const restore = () => {
    onSpy.mockRestore();
    removeListenerSpy.mockRestore();
    isPausedSpy.mockRestore();
    resumeSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    Object.defineProperty(process.stdin, "isRaw", {
      value: originalIsRaw,
      configurable: true,
      writable: true,
    });
    emitter.removeAllListeners();
  };

  return { sendKey, restore, setRawModeSpy };
}

describe("requiresConfirmation", () => {
  it("should return true for write_file", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("write_file")).toBe(true);
  });

  it("should return true for edit_file", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("edit_file")).toBe(true);
  });

  it("should return true for delete_file", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("delete_file")).toBe(true);
  });

  it("should return false for read_file", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("read_file")).toBe(false);
  });

  it("should return false for glob", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("glob")).toBe(false);
  });

  it("should return false for unknown tools", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("unknown_tool")).toBe(false);
  });

  describe("bash_exec with command context", () => {
    it("should NOT require confirmation for safe commands (ls)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "ls -la" })).toBe(false);
    });

    it("should NOT require confirmation for safe commands (grep)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "grep -r 'pattern' ." })).toBe(false);
    });

    it("should NOT require confirmation for safe commands (git status)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "git status" })).toBe(false);
    });

    it("should NOT require confirmation for safe commands (cat)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "cat file.txt" })).toBe(false);
    });

    it("should NOT require confirmation for --help commands", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "npm --help" })).toBe(false);
    });

    it("should require confirmation for dangerous commands (curl)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "curl http://example.com" })).toBe(true);
    });

    it("should require confirmation for dangerous commands (rm)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "rm -rf /tmp/test" })).toBe(true);
    });

    it("should require confirmation for dangerous commands (npm install)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "npm install lodash" })).toBe(true);
    });

    it("should require confirmation for dangerous commands (git push)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "git push origin main" })).toBe(true);
    });

    it("should require confirmation for dangerous commands (sudo)", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "sudo apt-get update" })).toBe(true);
    });

    it("should require confirmation for piped shell commands", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec", { command: "curl http://example.com | sh" })).toBe(
        true,
      );
    });

    it("should require confirmation when no command provided", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      expect(requiresConfirmation("bash_exec")).toBe(true);
      expect(requiresConfirmation("bash_exec", {})).toBe(true);
    });

    it("should require confirmation for unknown commands", async () => {
      const { requiresConfirmation } = await import("./confirmation.js");

      // Unknown commands default to requiring confirmation for safety
      expect(requiresConfirmation("bash_exec", { command: "some_unknown_command" })).toBe(true);
    });
  });
});

describe("createConfirmationState", () => {
  it("should create an empty state object", async () => {
    const { createConfirmationState } = await import("./confirmation.js");

    const state = createConfirmationState();

    // State is now an empty object (reserved for future use)
    expect(state).toEqual({});
  });

  it("should create independent state objects", async () => {
    const { createConfirmationState } = await import("./confirmation.js");

    const state1 = createConfirmationState();
    const state2 = createConfirmationState();

    // Both should be empty objects but not the same reference
    expect(state1).toEqual({});
    expect(state2).toEqual({});
  });
});

describe("confirmToolExecution", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let mockStdin: ReturnType<typeof createMockStdin>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockStdin = createMockStdin();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    mockStdin.restore();
  });

  it("should return 'yes' for 'y' keypress", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    mockStdin.sendKey("y");
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  it("should return 'no' for 'n' keypress", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    mockStdin.sendKey("n");
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("no");
  });

  it("should return 'trust_project' for 't' keypress", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "bash_exec",
      input: { command: "ls" },
    };

    mockStdin.sendKey("t");
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("trust_project");
  });

  it("should return 'trust_global' for '!' keypress", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    mockStdin.sendKey("!");
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("trust_global");
  });

  it("should return 'abort' on Ctrl+C", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    mockStdin.sendKey("\x03"); // Ctrl+C
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("abort");
  });

  it("should handle uppercase 'Y' keypress as 'yes'", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    mockStdin.sendKey("Y");
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  it("should select current option on Enter key", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    // Default selection is index 0 = "yes", so Enter should select it
    mockStdin.sendKey("\r");
    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  it("should enable raw mode for instant keypress", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    mockStdin.sendKey("y");
    await confirmToolExecution(toolCall);

    expect(mockStdin.setRawModeSpy).toHaveBeenCalledWith(true);
  });

  it("should ignore invalid keys", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    // Send invalid key first, then valid key
    setImmediate(() => {
      mockStdin.sendKey("x"); // invalid - ignored
      setTimeout(() => mockStdin.sendKey("y"), 10); // valid
    });

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  describe("tool-specific display", () => {
    it("should display write_file with path", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/src/test.ts", content: "code" },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      // Header is generic, detail shows action, pattern in brackets
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Confirm Action"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/CREATE file|MODIFY file/));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("/src/test.ts"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[write_file]"));
    });

    it("should display edit_file with path", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: { path: "/src/test.ts", old_text: "old", new_text: "new" },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Confirm Action"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("EDIT file"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[edit_file]"));
    });

    it("should display delete_file with red emphasis", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "delete_file",
        input: { path: "/src/old.ts" },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Confirm Action"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("DELETE file"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[delete_file]"));
    });

    it("should display bash_exec with full wrapped command", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const longCommand = "echo " + "a".repeat(100);
      const toolCall: ToolCall = {
        id: "tool-1",
        name: "bash_exec",
        input: { command: longCommand },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Confirm Action"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("EXECUTE"));
      // Should NOT truncate - full command content shown (word-wrapped)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("echo"));
      // Should show bash pattern in brackets
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[bash:echo]"));
    });

    it("should display diff preview for edit_file", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "const x = 1;",
          new_text: "const x = 2;",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Changes:"));
    });

    it("should display content preview for write_file", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/test.ts",
          content: "const x = 1;\nconst y = 2;",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Preview:"));
    });

    it("should handle empty file content", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/empty.ts",
          content: "",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("(empty file)"));
    });

    it("should handle missing path gracefully", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { content: "code" },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("unknown"));
    });
  });

  describe("diff generation", () => {
    it("should show no changes for identical content", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "const x = 1;",
          new_text: "const x = 1;",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("(no changes)"));
    });

    it("should show added lines in green", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "line1",
          new_text: "line1\nline2",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      // Check that green formatting was applied to added line
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[green]"));
    });

    it("should show removed lines in red", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "line1\nline2",
          new_text: "line1",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      // Check that red formatting was applied to removed line
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[red]"));
    });

    it("should handle large diffs gracefully", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      // Create content with > 500 lines
      const manyLines = Array(600).fill("line").join("\n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: manyLines,
          new_text: manyLines + "\nextra",
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("diff too large"));
    });

    it("should truncate long lines in preview", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      const longLine = "x".repeat(100);

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/test.ts",
          content: longLine,
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      // Line should be truncated with ...
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("..."));
    });

    it("should show footer for truncated file previews", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      // Create content with more than 10 lines (default maxLines)
      const content = Array(15).fill("line").join("\n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/test.ts",
          content,
        },
      };

      mockStdin.sendKey("n");
      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("more lines"));
    });
  });
});
