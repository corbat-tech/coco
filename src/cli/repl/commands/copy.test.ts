/**
 * Tests for /copy command
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../output/clipboard.js", () => ({
  copyToClipboard: vi.fn(),
  isClipboardAvailable: vi.fn(),
}));

vi.mock("../output/block-store.js", () => ({
  getBlock: vi.fn(),
  getLastBlock: vi.fn(),
  getBlockCount: vi.fn(),
}));

vi.mock("chalk", () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
  },
}));

import { copyToClipboard, isClipboardAvailable } from "../output/clipboard.js";
import { getBlock, getLastBlock, getBlockCount } from "../output/block-store.js";
import { copyCommand } from "./copy.js";

const mockBlock = (id: number, lang: string, content: string) => ({ id, lang, content });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isClipboardAvailable).mockResolvedValue(true);
  vi.mocked(copyToClipboard).mockResolvedValue(true);
  vi.mocked(getBlockCount).mockReturnValue(0);
  vi.mocked(getLastBlock).mockReturnValue(undefined);
  vi.mocked(getBlock).mockReturnValue(undefined);
});

// ── Clipboard unavailable ─────────────────────────────────────────────────────

describe("clipboard unavailable", () => {
  it("prints error and returns false", async () => {
    vi.mocked(isClipboardAvailable).mockResolvedValue(false);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await copyCommand.execute([]);

    expect(result).toBe(false);
    expect(consoleSpy.mock.calls[0][0]).toContain("not available");
    expect(copyToClipboard).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── No blocks stored ──────────────────────────────────────────────────────────

describe("no blocks stored", () => {
  it("/copy with no arg prints warning", async () => {
    vi.mocked(getLastBlock).mockReturnValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await copyCommand.execute([]);

    expect(result).toBe(false);
    expect(consoleSpy.mock.calls[0][0]).toContain("No code blocks");
    expect(copyToClipboard).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("/copy N with no blocks stored prints warning", async () => {
    vi.mocked(getBlockCount).mockReturnValue(0);
    vi.mocked(getBlock).mockReturnValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await copyCommand.execute(["3"]);

    expect(result).toBe(false);
    expect(consoleSpy.mock.calls[0][0]).toContain("not found");
    expect(copyToClipboard).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── Copy last block ───────────────────────────────────────────────────────────

describe("copy last block", () => {
  it("copies last block content when no arg given", async () => {
    const block = mockBlock(3, "sql", "SELECT 1;");
    vi.mocked(getLastBlock).mockReturnValue(block);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await copyCommand.execute([]);

    expect(result).toBe(false);
    expect(copyToClipboard).toHaveBeenCalledWith("SELECT 1;");
    consoleSpy.mockRestore();
  });

  it("shows success confirmation with lang and block ID", async () => {
    const block = mockBlock(3, "sql", "SELECT 1;");
    vi.mocked(getLastBlock).mockReturnValue(block);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute([]);

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("sql");
    expect(output).toContain("#3");
    expect(output).toContain("copied");
    consoleSpy.mockRestore();
  });
});

// ── Copy block by ID ──────────────────────────────────────────────────────────

describe("copy block by ID", () => {
  it("copies block #N when numeric arg given", async () => {
    const block = mockBlock(2, "typescript", "const x = 1;");
    vi.mocked(getBlock).mockReturnValue(block);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await copyCommand.execute(["2"]);

    expect(result).toBe(false);
    expect(getBlock).toHaveBeenCalledWith(2);
    expect(copyToClipboard).toHaveBeenCalledWith("const x = 1;");
    consoleSpy.mockRestore();
  });

  it("shows success with language and block ID", async () => {
    const block = mockBlock(2, "typescript", "const x = 1;");
    vi.mocked(getBlock).mockReturnValue(block);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute(["2"]);

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("typescript");
    expect(output).toContain("#2");
    expect(output).toContain("copied");
    consoleSpy.mockRestore();
  });

  it("shows out-of-range warning for unknown block ID", async () => {
    vi.mocked(getBlock).mockReturnValue(undefined);
    vi.mocked(getBlockCount).mockReturnValue(3);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute(["99"]);

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("not found");
    expect(output).toContain("3 blocks");
    expect(copyToClipboard).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("shows invalid arg warning for ID 0 (not a positive integer)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute(["0"]);

    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("Invalid");
    expect(copyToClipboard).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ── Clipboard failure ─────────────────────────────────────────────────────────

describe("clipboard failure", () => {
  it("prints error when copyToClipboard returns false", async () => {
    const block = mockBlock(1, "bash", "echo hi");
    vi.mocked(getLastBlock).mockReturnValue(block);
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await copyCommand.execute([]);

    expect(result).toBe(false);
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("Failed");
    consoleSpy.mockRestore();
  });
});

// ── Invalid / malformed args ──────────────────────────────────────────────────

describe("invalid or malformed args", () => {
  it("/copy 1.5 shows invalid arg error — does NOT silently copy block #1", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute(["1.5"]);

    expect(copyToClipboard).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("Invalid");
    expect(output).toContain("1.5");
    consoleSpy.mockRestore();
  });

  it("/copy 2abc shows invalid arg error — does NOT silently copy block #2", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute(["2abc"]);

    expect(copyToClipboard).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("Invalid");
    consoleSpy.mockRestore();
  });

  it("/copy with empty string arg falls back to last block", async () => {
    const block = mockBlock(2, "sql", "SELECT 1;");
    vi.mocked(getLastBlock).mockReturnValue(block);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await copyCommand.execute([""]);

    expect(copyToClipboard).toHaveBeenCalledWith("SELECT 1;");
    consoleSpy.mockRestore();
  });
});

// ── Command metadata ──────────────────────────────────────────────────────────

describe("command metadata", () => {
  it("has correct name", () => {
    expect(copyCommand.name).toBe("copy");
  });

  it("has cp alias", () => {
    expect(copyCommand.aliases).toContain("cp");
  });

  it("does not have c alias (conflicts with /clear)", () => {
    expect(copyCommand.aliases).not.toContain("c");
  });

  it("usage reflects optional arg", () => {
    expect(copyCommand.usage).toContain("[N]");
  });
});
