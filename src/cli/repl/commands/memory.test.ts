/**
 * Tests for /memory command improvements
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => `[dim]${s}[/dim]`,
    green: Object.assign((s: string) => `[green]${s}[/green]`, {
      bold: (s: string) => `[green.bold]${s}[/green.bold]`,
    }),
    red: Object.assign((s: string) => `[red]${s}[/red]`, {
      bold: (s: string) => `[red.bold]${s}[/red.bold]`,
    }),
    yellow: Object.assign((s: string) => `[yellow]${s}[/yellow]`, {
      bold: (s: string) => `[yellow.bold]${s}[/yellow.bold]`,
    }),
    cyan: Object.assign((s: string) => `[cyan]${s}[/cyan]`, {
      bold: (s: string) => `[cyan.bold]${s}[/cyan.bold]`,
    }),
    blue: Object.assign((s: string) => `[blue]${s}[/blue]`, {
      bold: (s: string) => `[blue.bold]${s}[/blue.bold]`,
    }),
    white: Object.assign((s: string) => `[white]${s}[/white]`, {
      bold: (s: string) => `[white.bold]${s}[/white.bold]`,
    }),
    bold: (s: string) => `[bold]${s}[/bold]`,
  },
}));

// Mock session.ts to avoid heavy import
vi.mock("../session.js", () => ({
  initializeSessionMemory: vi.fn().mockResolvedValue(undefined),
  getConversationContext: vi.fn().mockReturnValue([]),
  addMessage: vi.fn(),
}));

describe("memory command — createPlaceholderContext uses AGENTS.md", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display AGENTS.md in placeholder when no session memory", async () => {
    const { memoryCommand } = await import("./memory.js");

    // Execute with a session that has no memoryContext
    await memoryCommand.execute([], {} as never);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");

    // Should reference AGENTS.md, not COCO.md or CLAUDE.md
    expect(allOutput).toContain("AGENTS.md");
  });
});

describe("memory command — reload subcommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle reload subcommand without errors", async () => {
    const { memoryCommand } = await import("./memory.js");

    const session = {
      memoryContext: {
        files: [],
        combinedContent: "",
        totalSize: 0,
        errors: [],
      },
    } as never;

    // Should not throw
    await expect(memoryCommand.execute(["reload"], session)).resolves.toBe(false);
  });

  it("should show 'no files found' message when no files loaded after reload", async () => {
    const { memoryCommand } = await import("./memory.js");

    const session = {
      memoryContext: {
        files: [],
        combinedContent: "",
        totalSize: 0,
        errors: [],
      },
    } as never;

    await memoryCommand.execute(["reload"], session);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    // Should mention AGENTS.md, COCO.md, or CLAUDE.md
    expect(allOutput).toContain("AGENTS.md");
  });

  it("should show loaded file info after reload when files exist", async () => {
    const { memoryCommand } = await import("./memory.js");

    const session = {
      memoryContext: {
        files: [
          {
            path: "/project/AGENTS.md",
            level: "project",
            content: "# Project\nSome content here",
            sections: [],
            imports: [],
            modifiedAt: new Date(),
            exists: true,
          },
        ],
        combinedContent: "# Project\nSome content",
        totalSize: 24,
        errors: [],
      },
    } as never;

    await memoryCommand.execute(["reload"], session);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    // Should show success with file count
    expect(allOutput).toContain("1");
  });
});

describe("memory command — directory level support", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display directory-level memory files", async () => {
    const { memoryCommand } = await import("./memory.js");

    const session = {
      memoryContext: {
        files: [
          {
            path: "/project/src/AGENTS.md",
            level: "directory",
            content: "# Directory Memory",
            sections: [],
            imports: [],
            modifiedAt: new Date(),
            exists: true,
          },
        ],
        combinedContent: "# Directory Memory",
        totalSize: 17,
        errors: [],
      },
    } as never;

    await memoryCommand.execute([], session);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    // Should show "Directory" level label
    expect(allOutput).toContain("Directory");
  });
});

describe("memory command — filename shown in header", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show basename of file in header", async () => {
    const { memoryCommand } = await import("./memory.js");

    const session = {
      memoryContext: {
        files: [
          {
            path: "/very/long/path/to/AGENTS.md",
            level: "project",
            content: "# Project",
            sections: [],
            imports: [],
            modifiedAt: new Date(),
            exists: true,
          },
        ],
        combinedContent: "# Project",
        totalSize: 9,
        errors: [],
      },
    } as never;

    await memoryCommand.execute([], session);

    const allOutput = consoleLogSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    // Should show the basename (AGENTS.md) prominently
    expect(allOutput).toContain("AGENTS.md");
  });
});
