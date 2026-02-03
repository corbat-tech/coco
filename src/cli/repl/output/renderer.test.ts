/**
 * Tests for output renderer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderStreamChunk,
  renderToolStart,
  renderToolEnd,
  renderUsageStats,
  renderError,
  renderInfo,
  renderSuccess,
  renderWarning,
  highlightCode,
} from "./renderer.js";
import type { StreamChunk } from "../../../providers/types.js";
import type { ExecutedToolCall } from "../types.js";

// Mock chalk with nested methods (green.bold, yellow.bold, etc.)
vi.mock("chalk", () => ({
  default: {
    dim: (s: string) => `[dim]${s}[/dim]`,
    cyan: Object.assign((s: string) => `[cyan]${s}[/cyan]`, {
      bold: (s: string) => `[cyan.bold]${s}[/cyan.bold]`,
    }),
    green: Object.assign((s: string) => `[green]${s}[/green]`, {
      bold: (s: string) => `[green.bold]${s}[/green.bold]`,
    }),
    red: Object.assign((s: string) => `[red]${s}[/red]`, {
      bold: (s: string) => `[red.bold]${s}[/red.bold]`,
    }),
    yellow: Object.assign((s: string) => `[yellow]${s}[/yellow]`, {
      bold: (s: string) => `[yellow.bold]${s}[/yellow.bold]`,
    }),
    blue: (s: string) => `[blue]${s}[/blue]`,
    magenta: (s: string) => `[magenta]${s}[/magenta]`,
  },
}));

describe("renderStreamChunk", () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should write text chunks to stdout", () => {
    const chunk: StreamChunk = { type: "text", text: "Hello world" };

    renderStreamChunk(chunk);

    expect(stdoutWriteSpy).toHaveBeenCalledWith("Hello world");
  });

  it("should not write non-text chunks", () => {
    const chunk: StreamChunk = { type: "tool_use" as any };

    renderStreamChunk(chunk);

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it("should not write empty text", () => {
    const chunk: StreamChunk = { type: "text", text: "" };

    renderStreamChunk(chunk);

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});

describe("renderToolStart", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render tool name with icon", () => {
    renderToolStart("read_file", { path: "/test/file.ts" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("📄");
    expect(output).toContain("read_file");
  });

  it("should show file path for file tools", () => {
    renderToolStart("read_file", { path: "/test/file.ts" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("/test/file.ts");
  });

  it("should show bash command truncated", () => {
    renderToolStart("bash_exec", {
      command: "echo 'this is a very long command that should be truncated for display purposes'",
    });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("...");
    expect(output.length).toBeLessThan(200);
  });

  it("should show search pattern and path", () => {
    renderToolStart("search_files", { pattern: "TODO", path: "/src" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("TODO");
    expect(output).toContain("/src");
  });

  it("should use default icon for unknown tools", () => {
    renderToolStart("unknown_tool", {});

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("🔧");
  });
});

describe("renderToolEnd", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show success status", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: { path: "/test" },
      result: { success: true, output: '{"lines": 10}' },
      duration: 50,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("[green]✓[/green]");
  });

  it("should show failure status", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: { path: "/test" },
      result: { success: false, output: "", error: "File not found" },
      duration: 50,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("[red]✗[/red]");
  });

  it("should show duration", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "bash_exec",
      input: {},
      result: { success: true, output: '{"exitCode": 0, "stdout": "hello"}' },
      duration: 123.456,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("123ms");
  });

  it("should show error message on failure", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: {},
      result: { success: false, output: "", error: "Permission denied" },
      duration: 10,
    };

    renderToolEnd(result);

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    const errorOutput = consoleLogSpy.mock.calls[1][0];
    expect(errorOutput).toContain("Permission denied");
  });

  it("should show line count for read_file", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: {},
      result: { success: true, output: '{"lines": 42}' },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("42 lines");
  });

  it("should show matches for search_files", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "search_files",
      input: {},
      result: { success: true, output: '{"matches": [1, 2, 3, 4, 5]}' },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("5 matches");
  });

  it("should show file/dir count for list_directory", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "list_directory",
      input: {},
      result: {
        success: true,
        output: '{"entries": [{"type": "file"}, {"type": "file"}, {"type": "directory"}]}',
      },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("2 files");
    expect(output).toContain("1 dirs");
  });
});

describe("renderUsageStats", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should show total tokens", () => {
    renderUsageStats(1000, 500, 0);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("1,500 tokens");
  });

  it("should show tool count when greater than 0", () => {
    renderUsageStats(1000, 500, 3);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("3 tools");
  });

  it("should not show tool count when 0", () => {
    renderUsageStats(1000, 500, 0);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).not.toContain("tools");
  });
});

describe("message rendering functions", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("renderError", () => {
    it("should render error message in red", () => {
      renderError("Something went wrong");

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[red]"));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Something went wrong"));
    });
  });

  describe("renderInfo", () => {
    it("should render info message dimmed", () => {
      renderInfo("Some information");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[dim]"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Some information"));
    });
  });

  describe("renderSuccess", () => {
    it("should render success message in green", () => {
      renderSuccess("Operation completed");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[green]"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Operation completed"));
    });
  });

  describe("renderWarning", () => {
    it("should render warning message in yellow", () => {
      renderWarning("Be careful");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[yellow]"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Be careful"));
    });
  });
});

describe("renderToolEnd with formatResultPreview edge cases", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle invalid JSON output gracefully", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: {},
      result: { success: true, output: "not valid json" },
      duration: 10,
    };

    renderToolEnd(result);

    // Should still render without crashing
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("[green]✓[/green]");
  });

  it("should handle write_file success preview", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "write_file",
      input: { path: "/test.txt", content: "hello" },
      result: { success: true, output: '{"written": true}' },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("(saved)");
  });

  it("should handle edit_file success preview", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "edit_file",
      input: { path: "/test.txt" },
      result: { success: true, output: '{"edited": true}' },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("(saved)");
  });

  it("should handle bash_exec with exitCode 0", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "bash_exec",
      input: { command: "ls" },
      result: { success: true, output: '{"exitCode": 0, "stdout": "file1.txt\\nfile2.txt\\nfile3.txt"}' },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("lines");
  });

  it("should not show line count for bash_exec with non-zero exit code", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "bash_exec",
      input: { command: "failing-command" },
      result: { success: true, output: '{"exitCode": 1, "stderr": "error"}' },
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    // Should not contain lines count when exit code is not 0
    expect(output).not.toContain("lines)");
  });

  it("should return empty preview for failed result", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: { path: "/missing.txt" },
      result: { success: false, output: "", error: "File not found" },
      duration: 10,
    };

    renderToolEnd(result);

    // Should show error indicator
    const firstOutput = consoleLogSpy.mock.calls[0][0];
    expect(firstOutput).toContain("[red]✗[/red]");
  });

  it("should handle read_file without lines property", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "read_file",
      input: { path: "/test.txt" },
      result: { success: true, output: '{"content": "some text"}' }, // No lines property
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    // Should not crash and should show success
    expect(output).toContain("[green]✓[/green]");
  });

  it("should handle search_files without matches array", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "search_files",
      input: { pattern: "test" },
      result: { success: true, output: '{"found": false}' }, // No matches array
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("[green]✓[/green]");
  });

  it("should handle list_directory without entries array", () => {
    const result: ExecutedToolCall = {
      id: "1",
      name: "list_directory",
      input: { path: "/test" },
      result: { success: true, output: '{"path": "/test"}' }, // No entries array
      duration: 10,
    };

    renderToolEnd(result);

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("[green]✓[/green]");
  });
});

describe("renderToolStart with formatToolSummary edge cases", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle delete_file tool", () => {
    renderToolStart("delete_file", { path: "/test/file.txt" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("🗑️");
    expect(output).toContain("/test/file.txt");
  });

  it("should handle list_directory tool", () => {
    renderToolStart("list_directory", { path: "/test" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("📁");
    expect(output).toContain("/test");
  });

  it("should use default path for list_directory without path", () => {
    renderToolStart("list_directory", {});

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain(".");
  });

  it("should handle search_files without path", () => {
    renderToolStart("search_files", { pattern: "TODO" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain('"TODO"');
    expect(output).not.toContain(" in ");
  });

  it("should handle short bash command without truncation", () => {
    renderToolStart("bash_exec", { command: "ls -la" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("ls -la");
    expect(output).not.toContain("...");
  });

  it("should handle write_file tool with MODIFY label for existing file", () => {
    renderToolStart("write_file", { path: "/test/new-file.ts" });

    const output = consoleLogSpy.mock.calls[0][0];
    // Without isCreate metadata, defaults to MODIFY
    expect(output).toContain("MODIFY");
    expect(output).toContain("/test/new-file.ts");
  });

  it("should handle write_file tool with CREATE label for new file", () => {
    renderToolStart("write_file", { path: "/test/new-file.ts" }, { isCreate: true });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("CREATE");
    expect(output).toContain("/test/new-file.ts");
  });

  it("should handle edit_file tool", () => {
    renderToolStart("edit_file", { path: "/test/existing.ts" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("✏️");
    expect(output).toContain("/test/existing.ts");
  });

  it("should handle web_search tool", () => {
    renderToolStart("web_search", { query: "typescript tutorial" });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("🌐");
    // Uses formatToolInput for unknown tools
    expect(output).toContain("query=");
  });

  it("should format unknown tool with multiple inputs", () => {
    renderToolStart("custom_tool", {
      param1: "value1",
      param2: "value2",
      param3: 123,
    });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("🔧");
    expect(output).toContain("param1=value1");
    expect(output).toContain("param2=value2");
    expect(output).toContain("param3=123");
  });

  it("should format unknown tool with empty input", () => {
    renderToolStart("custom_tool", {});

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("🔧");
    expect(output).toContain("custom_tool");
  });

  it("should truncate long string values in input", () => {
    const longValue = "a".repeat(50);
    renderToolStart("custom_tool", { param: longValue });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("...");
    expect(output).not.toContain("a".repeat(50));
  });

  it("should handle null and undefined values in input", () => {
    renderToolStart("custom_tool", {
      nullVal: null,
      undefinedVal: undefined,
      normalVal: "test"
    });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("nullVal=null");
    expect(output).toContain("undefinedVal=undefined");
    expect(output).toContain("normalVal=test");
  });

  it("should handle object values in input", () => {
    renderToolStart("custom_tool", {
      nested: { key: "value" }
    });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain('nested={"key":"value"}');
  });

  it("should handle more than 3 input parameters", () => {
    renderToolStart("custom_tool", {
      param1: "a",
      param2: "b",
      param3: "c",
      param4: "d",
      param5: "e",
    });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("+2 more");
  });

  it("should handle exactly 3 input parameters without +more", () => {
    renderToolStart("custom_tool", {
      param1: "a",
      param2: "b",
      param3: "c",
    });

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).not.toContain("more");
  });
});

describe("highlightCode", () => {
  it("should highlight keywords in blue", () => {
    const result = highlightCode("const x = 1");

    expect(result).toContain("[blue]const[/blue]");
  });

  it("should highlight numbers in magenta", () => {
    const result = highlightCode("const x = 42");

    expect(result).toContain("[magenta]42[/magenta]");
  });

  it("should highlight strings in yellow", () => {
    const result = highlightCode('const x = "hello"');

    expect(result).toContain("[yellow]");
    expect(result).toContain("hello");
  });

  it("should highlight single-quoted strings", () => {
    const result = highlightCode("const x = 'world'");

    expect(result).toContain("[yellow]");
    expect(result).toContain("world");
  });

  it("should dim single-line comments", () => {
    const result = highlightCode("const x = 1 // comment");

    expect(result).toContain("[dim]// comment[/dim]");
  });

  it("should handle multiple keywords", () => {
    const result = highlightCode("async function test() { return await fetch() }");

    expect(result).toContain("[blue]async[/blue]");
    expect(result).toContain("[blue]function[/blue]");
    expect(result).toContain("[blue]return[/blue]");
    expect(result).toContain("[blue]await[/blue]");
  });

  it("should handle multiple lines", () => {
    const code = "const x = 1\nconst y = 2";
    const result = highlightCode(code);

    expect(result.split("\n")).toHaveLength(2);
  });

  it("should handle template literals", () => {
    const result = highlightCode("const x = `template`");

    expect(result).toContain("[yellow]");
    expect(result).toContain("template");
  });
});
