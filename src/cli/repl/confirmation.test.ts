/**
 * Tests for the confirmation system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { ToolCall } from "../../providers/types.js";

// Mock chalk for predictable output testing with nested methods (e.g., green.bold)
vi.mock("chalk", () => ({
  default: {
    bold: (s: string) => `[bold]${s}[/bold]`,
    yellow: Object.assign((s: string) => `[yellow]${s}[/yellow]`, {
      bold: (s: string) => `[yellow.bold]${s}[/yellow.bold]`,
    }),
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
    red: Object.assign((s: string) => `[red]${s}[/red]`, {
      bold: (s: string) => `[red.bold]${s}[/red.bold]`,
    }),
    green: Object.assign((s: string) => `[green]${s}[/green]`, {
      bold: (s: string) => `[green.bold]${s}[/green.bold]`,
    }),
    dim: (s: string) => `[dim]${s}[/dim]`,
  },
}));

// Mock fs/promises for checkFileExists
const mockFsAccess = vi.fn().mockRejectedValue(new Error("ENOENT")); // Default: file doesn't exist (create)
vi.mock("node:fs/promises", () => ({
  default: {
    access: mockFsAccess,
  },
}));

// Mock readline/promises
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

  it("should return true for bash_exec", async () => {
    const { requiresConfirmation } = await import("./confirmation.js");

    expect(requiresConfirmation("bash_exec")).toBe(true);
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
});

describe("createConfirmationState", () => {
  it("should create state with allowAll false", async () => {
    const { createConfirmationState } = await import("./confirmation.js");

    const state = createConfirmationState();

    expect(state.allowAll).toBe(false);
  });

  it("should create independent state objects", async () => {
    const { createConfirmationState } = await import("./confirmation.js");

    const state1 = createConfirmationState();
    const state2 = createConfirmationState();

    state1.allowAll = true;

    expect(state1.allowAll).toBe(true);
    expect(state2.allowAll).toBe(false);
  });
});

describe("confirmToolExecution", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRlOn.mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should return 'yes' for 'y' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("y");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
    expect(mockRlClose).toHaveBeenCalled();
  });

  it("should return 'yes' for 'yes' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("yes");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  it("should return 'no' for 'n' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("n");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("no");
  });

  it("should return 'no' for 'no' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("no");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("no");
  });

  it("should return 'yes_all' for 'a' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("a");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes_all");
  });

  it("should return 'yes_all' for 'all' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("all");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes_all");
  });

  it("should return 'trust_session' for 't' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("t");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "bash_exec",
      input: { command: "ls" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("trust_session");
  });

  it("should return 'trust_session' for 'trust' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("trust");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "bash_exec",
      input: { command: "ls" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("trust_session");
  });

  it("should return 'abort' for 'c' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("c");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("abort");
  });

  it("should return 'abort' for 'cancel' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("cancel");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("abort");
  });

  it("should return 'abort' for 'abort' input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("abort");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("abort");
  });

  it("should return 'no' for unknown input (safety default)", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("maybe");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("no");
  });

  it("should return 'no' for empty input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("no");
  });

  it("should handle uppercase input", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("YES");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  it("should handle input with whitespace", async () => {
    const { confirmToolExecution } = await import("./confirmation.js");

    mockRlQuestion.mockResolvedValue("  yes  ");

    const toolCall: ToolCall = {
      id: "tool-1",
      name: "write_file",
      input: { path: "/test.ts", content: "code" },
    };

    const result = await confirmToolExecution(toolCall);

    expect(result).toBe("yes");
  });

  describe("tool-specific display", () => {
    it("should display write_file with path", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/src/test.ts", content: "code" },
      };

      await confirmToolExecution(toolCall);

      // Now uses CREATE or MODIFY labels
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CREATE file|MODIFY file/)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("/src/test.ts")
      );
    });

    it("should display edit_file with path", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: { path: "/src/test.ts", old_text: "old", new_text: "new" },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("EDIT file")
      );
    });

    it("should display delete_file with red emphasis", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "delete_file",
        input: { path: "/src/old.ts" },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[red.bold]DELETE file[/red.bold]")
      );
    });

    it("should display bash_exec with truncated command", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const longCommand = "echo " + "a".repeat(100);
      const toolCall: ToolCall = {
        id: "tool-1",
        name: "bash_exec",
        input: { command: longCommand },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("EXECUTE")
      );
      // Should be truncated with ...
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("...")
      );
    });

    it("should display diff preview for edit_file", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "const x = 1;",
          new_text: "const x = 2;",
        },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Changes:")
      );
    });

    it("should display content preview for write_file", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/test.ts",
          content: "const x = 1;\nconst y = 2;",
        },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Content:")
      );
    });

    it("should handle empty file content", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/empty.ts",
          content: "",
        },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("(empty file)")
      );
    });

    it("should handle missing path gracefully", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { content: "code" },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("unknown")
      );
    });
  });

  describe("SIGINT handling", () => {
    it("should return abort on SIGINT", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      // Capture the SIGINT handler
      let sigintHandler: (() => void) | null = null;
      mockRlOn.mockImplementation((event: string, handler: () => void) => {
        if (event === "SIGINT") {
          sigintHandler = handler;
        }
      });

      // Don't resolve the question - simulate pending input
      mockRlQuestion.mockImplementation(() => new Promise(() => {}));

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      const resultPromise = confirmToolExecution(toolCall);

      // Wait for fs.access() mock to resolve/reject before handler is set up
      await new Promise(resolve => setTimeout(resolve, 10));

      // Trigger SIGINT
      if (sigintHandler) {
        sigintHandler();
      }

      const result = await resultPromise;

      expect(result).toBe("abort");
    });

    it("should return abort on close event", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      // Capture the close handler
      let closeHandler: (() => void) | null = null;
      mockRlOn.mockImplementation((event: string, handler: () => void) => {
        if (event === "close") {
          closeHandler = handler;
        }
      });

      // Don't resolve the question - simulate pending input
      mockRlQuestion.mockImplementation(() => new Promise(() => {}));

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: { path: "/test.ts", content: "code" },
      };

      const resultPromise = confirmToolExecution(toolCall);

      // Wait for fs.access() mock to resolve/reject before handler is set up
      await new Promise(resolve => setTimeout(resolve, 10));

      // Trigger close
      if (closeHandler) {
        closeHandler();
      }

      const result = await resultPromise;

      expect(result).toBe("abort");
    });
  });

  describe("diff generation", () => {
    it("should show no changes for identical content", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "const x = 1;",
          new_text: "const x = 1;",
        },
      };

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("(no changes)")
      );
    });

    it("should show added lines in green", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "line1",
          new_text: "line1\nline2",
        },
      };

      await confirmToolExecution(toolCall);

      // Check that green formatting was applied to added line
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[green]")
      );
    });

    it("should show removed lines in red", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "edit_file",
        input: {
          path: "/src/test.ts",
          old_text: "line1\nline2",
          new_text: "line1",
        },
      };

      await confirmToolExecution(toolCall);

      // Check that red formatting was applied to removed line
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[red]")
      );
    });

    it("should handle large diffs gracefully", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

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

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("diff too large")
      );
    });

    it("should truncate long lines in preview", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

      const longLine = "x".repeat(100);

      const toolCall: ToolCall = {
        id: "tool-1",
        name: "write_file",
        input: {
          path: "/src/test.ts",
          content: longLine,
        },
      };

      await confirmToolExecution(toolCall);

      // Line should be truncated with ...
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("...")
      );
    });

    it("should show footer for truncated file previews", async () => {
      const { confirmToolExecution } = await import("./confirmation.js");

      mockRlQuestion.mockResolvedValue("n");

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

      await confirmToolExecution(toolCall);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("more lines")
      );
    });
  });
});
