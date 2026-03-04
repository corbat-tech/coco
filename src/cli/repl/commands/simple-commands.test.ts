/**
 * Tests for simple REPL commands: quality, compact, copy, clear, exit, image, allow-path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../quality-loop.js", () => ({
  isQualityLoop: vi.fn().mockReturnValue(false),
  setQualityLoop: vi.fn(),
  saveQualityLoopPreference: vi.fn().mockReturnValue(Promise.resolve(undefined)),
  toggleQualityLoop: vi.fn(),
}));

vi.mock("../session.js", () => ({
  clearSession: vi.fn(),
}));

vi.mock("../output/renderer.js", () => ({
  getRawMarkdown: vi.fn().mockReturnValue(""),
  renderError: vi.fn(),
}));

vi.mock("../output/clipboard.js", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  isClipboardAvailable: vi.fn().mockResolvedValue(true),
}));

import { qualityCommand } from "./quality.js";
import { compactCommand, isCompactMode } from "./compact.js";
import { copyCommand } from "./copy.js";
import { clearCommand } from "./clear.js";
import { exitCommand } from "./exit.js";
import { isQualityLoop, setQualityLoop, saveQualityLoopPreference } from "../quality-loop.js";
import { clearSession } from "../session.js";
import { getRawMarkdown } from "../output/renderer.js";
import { copyToClipboard, isClipboardAvailable } from "../output/clipboard.js";

const mockSession = {} as any;

describe("qualityCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveQualityLoopPreference).mockReturnValue(Promise.resolve(undefined));
    vi.mocked(isQualityLoop).mockReturnValue(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct metadata", () => {
    expect(qualityCommand.name).toBe("quality");
    expect(qualityCommand.description).toBeTruthy();
  });

  it("should turn on with 'on' arg", async () => {
    const result = await qualityCommand.execute(["on"], mockSession);
    expect(result).toBe(false);
    expect(setQualityLoop).toHaveBeenCalledWith(true);
    expect(saveQualityLoopPreference).toHaveBeenCalledWith(true);
  });

  it("should turn off with 'off' arg", async () => {
    const result = await qualityCommand.execute(["off"], mockSession);
    expect(result).toBe(false);
    expect(setQualityLoop).toHaveBeenCalledWith(false);
    expect(saveQualityLoopPreference).toHaveBeenCalledWith(false);
  });

  it("should show status when mode is on", async () => {
    vi.mocked(isQualityLoop).mockReturnValue(true);
    const result = await qualityCommand.execute(["status"], mockSession);
    expect(result).toBe(false);
    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0] ?? ""))
      .join("\n");
    expect(output).toContain("ON");
  });

  it("should show status when mode is off", async () => {
    vi.mocked(isQualityLoop).mockReturnValue(false);
    const result = await qualityCommand.execute(["status"], mockSession);
    expect(result).toBe(false);
    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0] ?? ""))
      .join("\n");
    expect(output).toContain("OFF");
  });

  it("should toggle when no args", async () => {
    vi.mocked(isQualityLoop).mockReturnValue(false);
    const result = await qualityCommand.execute([], mockSession);
    expect(result).toBe(false);
    expect(setQualityLoop).toHaveBeenCalledWith(true);
  });

  it("should toggle from on to off", async () => {
    vi.mocked(isQualityLoop).mockReturnValue(true);
    const result = await qualityCommand.execute([], mockSession);
    expect(result).toBe(false);
    expect(setQualityLoop).toHaveBeenCalledWith(false);
  });
});

describe("compactCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct metadata", () => {
    expect(compactCommand.name).toBe("compact");
    expect(compactCommand.description).toBeTruthy();
  });

  it("should toggle compact mode via /compact verbose", async () => {
    const initial = isCompactMode();
    await compactCommand.execute(["verbose"], mockSession);
    expect(isCompactMode()).toBe(!initial);
    // Toggle back
    await compactCommand.execute(["verbose"], mockSession);
    expect(isCompactMode()).toBe(initial);
  });

  it("should return false (don't exit)", async () => {
    const result = await compactCommand.execute(["verbose"], mockSession);
    expect(result).toBe(false);
  });
});

describe("copyCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct metadata", () => {
    expect(copyCommand.name).toBe("copy");
    expect(copyCommand.aliases).toContain("cp");
  });

  it("should copy raw markdown to clipboard", async () => {
    vi.mocked(getRawMarkdown).mockReturnValue("Hello world content");
    vi.mocked(copyToClipboard).mockResolvedValue(true);
    vi.mocked(isClipboardAvailable).mockResolvedValue(true);

    const result = await copyCommand.execute([], mockSession);
    expect(result).toBe(false);
    expect(copyToClipboard).toHaveBeenCalledWith("Hello world content");
  });

  it("should report error when clipboard not available", async () => {
    vi.mocked(isClipboardAvailable).mockResolvedValue(false);

    const result = await copyCommand.execute([], mockSession);
    expect(result).toBe(false);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("should report when no response to copy", async () => {
    vi.mocked(isClipboardAvailable).mockResolvedValue(true);
    vi.mocked(getRawMarkdown).mockReturnValue("  ");

    const result = await copyCommand.execute([], mockSession);
    expect(result).toBe(false);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("should extract markdown code block if present", async () => {
    vi.mocked(isClipboardAvailable).mockResolvedValue(true);
    vi.mocked(getRawMarkdown).mockReturnValue(
      "Some text\n```markdown\n# Title\nContent\n```\nMore",
    );
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    await copyCommand.execute([], mockSession);
    expect(copyToClipboard).toHaveBeenCalledWith("# Title\nContent");
  });

  it("should handle copy failure", async () => {
    vi.mocked(isClipboardAvailable).mockResolvedValue(true);
    vi.mocked(getRawMarkdown).mockReturnValue("content");
    vi.mocked(copyToClipboard).mockResolvedValue(false);

    const result = await copyCommand.execute([], mockSession);
    expect(result).toBe(false);
    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0] ?? ""))
      .join("\n");
    expect(output).toContain("Failed");
  });
});

describe("clearCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct metadata", () => {
    expect(clearCommand.name).toBe("clear");
    expect(clearCommand.aliases).toContain("c");
  });

  it("should clear session and return false", async () => {
    const result = await clearCommand.execute([], mockSession);
    expect(result).toBe(false);
    expect(clearSession).toHaveBeenCalledWith(mockSession);
  });
});

describe("exitCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct metadata", () => {
    expect(exitCommand.name).toBe("exit");
    expect(exitCommand.aliases).toContain("quit");
    expect(exitCommand.aliases).toContain("q");
  });

  it("should return true (signal exit)", async () => {
    const result = await exitCommand.execute([], mockSession);
    expect(result).toBe(true);
  });
});
