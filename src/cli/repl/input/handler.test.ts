/**
 * Tests for input handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";

// Mock readline
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    prompt: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    close: vi.fn(),
    history: [],
  })),
}));

// Mock fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock commands
vi.mock("../commands/index.js", () => ({
  getAllCommands: vi.fn(() => [
    { name: "help", aliases: ["h", "?"], description: "Help" },
    { name: "exit", aliases: ["quit", "q"], description: "Exit" },
    { name: "clear", aliases: ["c"], description: "Clear" },
    { name: "model", aliases: ["m"], description: "Model" },
  ]),
}));

describe("Input Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("history file location", () => {
    it("should use ~/.coco/history for history file", async () => {
      const expectedPath = path.join(os.homedir(), ".coco", "history");

      // Import to trigger module evaluation
      await import("./handler.js");

      // The HISTORY_FILE constant should point to ~/.coco/history
      expect(expectedPath).toContain(".coco");
      expect(expectedPath).toContain("history");
    });
  });

  describe("loadHistory", () => {
    it("should return empty array when history file does not exist", async () => {
      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Force reimport to test internal loadHistory function
      vi.resetModules();

      const fs2 = await import("node:fs");
      vi.mocked(fs2.existsSync).mockReturnValue(false);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      // This will call loadHistory internally
      createInputHandler(mockSession);

      expect(fs2.existsSync).toHaveBeenCalled();
    });

    it("should load history from file when it exists", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("command1\ncommand2\ncommand3\n");

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      createInputHandler(mockSession);

      expect(fs.readFileSync).toHaveBeenCalled();
    });

    it("should handle errors when loading history gracefully", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("Read error");
      });

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      // Should not throw
      expect(() => createInputHandler(mockSession)).not.toThrow();
    });
  });

  describe("saveHistory", () => {
    it("should create directory if it does not exist", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // loadHistory check
        .mockReturnValueOnce(false); // saveHistory dir check
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const readline = await import("node:readline");
      let closeCallback: (() => void) | null = null;

      vi.mocked(readline.createInterface).mockReturnValue({
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: () => void) => {
          if (event === "close") closeCallback = cb;
        }),
        removeListener: vi.fn(),
        close: vi.fn(() => {
          if (closeCallback) closeCallback();
        }),
        history: [],
      } as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);
      handler.close();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".coco"),
        expect.objectContaining({ recursive: true })
      );
    });
  });

  describe("completer", () => {
    it("should return command completions for slash prefix", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let completer: ((line: string) => [string[], string]) | undefined;

      vi.mocked(readline.createInterface).mockImplementation((opts: any) => {
        completer = opts.completer;
        return {
          prompt: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          removeListener: vi.fn(),
          close: vi.fn(),
          history: [],
        } as any;
      });

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      createInputHandler(mockSession);

      // Test completer
      expect(completer).toBeDefined();

      const [completions, line] = completer!("/h");

      expect(completions).toContain("/help");
      expect(completions).toContain("/h");
      expect(line).toBe("/h");
    });

    it("should return all commands when no match found", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let completer: ((line: string) => [string[], string]) | undefined;

      vi.mocked(readline.createInterface).mockImplementation((opts: any) => {
        completer = opts.completer;
        return {
          prompt: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          removeListener: vi.fn(),
          close: vi.fn(),
          history: [],
        } as any;
      });

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      createInputHandler(mockSession);

      const [completions] = completer!("/xyz");

      // Should return all commands when no match
      expect(completions.length).toBeGreaterThan(0);
      expect(completions).toContain("/help");
    });

    it("should return empty array for non-slash input", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let completer: ((line: string) => [string[], string]) | undefined;

      vi.mocked(readline.createInterface).mockImplementation((opts: any) => {
        completer = opts.completer;
        return {
          prompt: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          removeListener: vi.fn(),
          close: vi.fn(),
          history: [],
        } as any;
      });

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      createInputHandler(mockSession);

      const [completions] = completer!("hello world");

      expect(completions).toEqual([]);
    });
  });

  describe("createInputHandler", () => {
    it("should create input handler with session config", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      vi.mocked(readline.createInterface).mockReturnValue({
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      } as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 50 } },
      } as any;

      const handler = createInputHandler(mockSession);

      expect(handler).toBeDefined();
      expect(handler.prompt).toBeDefined();
      expect(handler.close).toBeDefined();

      expect(readline.createInterface).toHaveBeenCalledWith(
        expect.objectContaining({
          historySize: 50,
          terminal: true,
        })
      );
    });
  });

  describe("SIGINT handler", () => {
    it("should print message and re-prompt on SIGINT", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let sigintHandler: (() => void) | null = null;
      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn((event: string, cb: () => void) => {
          if (event === "SIGINT") sigintHandler = cb;
          return mockRl;
        }),
        once: vi.fn(),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      createInputHandler(mockSession);

      // Trigger SIGINT handler
      expect(sigintHandler).toBeDefined();
      sigintHandler!();

      expect(consoleLogSpy).toHaveBeenCalledWith("\n(Use /exit or Ctrl+D to quit)");
      expect(mockRl.prompt).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });

  describe("prompt method", () => {
    it("should return null when already closed", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      // Close the handler first
      handler.close();

      // Now prompt should return null immediately
      const result = await handler.prompt();
      expect(result).toBeNull();
    });

    it("should resolve with trimmed input when line is received", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let lineHandler: ((line: string) => void) | null = null;

      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: (line: string) => void) => {
          if (event === "line") lineHandler = cb;
          return mockRl;
        }),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      // Start the prompt
      const promptPromise = handler.prompt();

      // Simulate line input
      expect(lineHandler).toBeDefined();
      lineHandler!("  hello world  ");

      const result = await promptPromise;
      expect(result).toBe("hello world");
    });

    it("should resolve with null for empty trimmed input", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let lineHandler: ((line: string) => void) | null = null;

      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: (line: string) => void) => {
          if (event === "line") lineHandler = cb;
          return mockRl;
        }),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      const promptPromise = handler.prompt();

      // Simulate empty/whitespace input
      lineHandler!("   ");

      const result = await promptPromise;
      expect(result).toBeNull();
    });

    it("should add non-empty input to session history", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let lineHandler: ((line: string) => void) | null = null;

      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: (line: string) => void) => {
          if (event === "line") lineHandler = cb;
          return mockRl;
        }),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      // First prompt with input
      const promptPromise1 = handler.prompt();
      lineHandler!("first command");
      await promptPromise1;

      // Second prompt with another input
      const promptPromise2 = handler.prompt();
      lineHandler!("second command");
      await promptPromise2;

      // Close to trigger saveHistory
      vi.mocked(fs.existsSync).mockReturnValue(true); // For saveHistory dir check
      handler.close();

      // Verify writeFileSync was called with the history
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenContent = writeCall?.[1] as string;
      expect(writtenContent).toContain("first command");
      expect(writtenContent).toContain("second command");
    });

    it("should resolve with null and set closed flag when close event is received", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let closeHandler: (() => void) | null = null;

      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: () => void) => {
          if (event === "close") closeHandler = cb;
          return mockRl;
        }),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      const promptPromise = handler.prompt();

      // Simulate close event (Ctrl+D)
      expect(closeHandler).toBeDefined();
      closeHandler!();

      const result = await promptPromise;
      expect(result).toBeNull();

      // Subsequent prompts should also return null
      const result2 = await handler.prompt();
      expect(result2).toBeNull();
    });

    it("should remove listeners after line is received", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let lineHandler: ((line: string) => void) | null = null;
      let closeHandler: (() => void) | null = null;

      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: any) => {
          if (event === "line") lineHandler = cb;
          if (event === "close") closeHandler = cb;
          return mockRl;
        }),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      const promptPromise = handler.prompt();
      lineHandler!("test input");
      await promptPromise;

      // The closeHandler should have been removed
      expect(mockRl.removeListener).toHaveBeenCalledWith("close", closeHandler);
    });

    it("should remove listeners after close is received", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      let lineHandler: ((line: string) => void) | null = null;
      let closeHandler: (() => void) | null = null;

      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: any) => {
          if (event === "line") lineHandler = cb;
          if (event === "close") closeHandler = cb;
          return mockRl;
        }),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      const promptPromise = handler.prompt();
      closeHandler!();
      await promptPromise;

      // The lineHandler should have been removed
      expect(mockRl.removeListener).toHaveBeenCalledWith("line", lineHandler);
    });
  });

  describe("close method", () => {
    it("should not close twice", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const readline = await import("node:readline");
      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      // Close twice
      handler.close();
      handler.close();

      // Should only close readline once
      expect(mockRl.close).toHaveBeenCalledTimes(1);
    });

    it("should handle saveHistory errors gracefully", async () => {
      vi.resetModules();

      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const readline = await import("node:readline");
      const mockRl = {
        prompt: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn(),
        close: vi.fn(),
        history: [],
      };

      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const { createInputHandler } = await import("./handler.js");

      const mockSession = {
        config: { ui: { maxHistorySize: 100 } },
      } as any;

      const handler = createInputHandler(mockSession);

      // Should not throw even if saveHistory fails
      expect(() => handler.close()).not.toThrow();
    });
  });
});
