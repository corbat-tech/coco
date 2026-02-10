import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import {
  copyToClipboard,
  isClipboardAvailable,
  readClipboardImage,
  isClipboardImageAvailable,
} from "./clipboard.js";

// ── Helpers ──────────────────────────────────────────────────────────

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function setPlatform(p: string) {
  Object.defineProperty(process, "platform", { value: p });
}

/**
 * Creates a mock child process with an EventEmitter-like interface.
 */
function createMockProc(exitCode: number | null = 0) {
  const events = new Map<string, ((...args: unknown[]) => void)[]>();
  const stdin = {
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  };
  const proc = {
    stdin,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(cb);
      return proc;
    }),
    emit(event: string, ...args: unknown[]) {
      events.get(event)?.forEach((cb) => cb(...args));
    },
  };
  if (exitCode !== null) {
    setTimeout(() => proc.emit("close", exitCode), 0);
  }
  return proc;
}

// ── isClipboardImageAvailable ────────────────────────────────────────

describe("isClipboardImageAvailable", () => {
  it("returns true for darwin", () => {
    setPlatform("darwin");
    expect(isClipboardImageAvailable()).toBe(true);
  });

  it("returns true for linux", () => {
    setPlatform("linux");
    expect(isClipboardImageAvailable()).toBe(true);
  });

  it("returns true for win32", () => {
    setPlatform("win32");
    expect(isClipboardImageAvailable()).toBe(true);
  });

  it("returns false for unsupported platform", () => {
    setPlatform("freebsd");
    expect(isClipboardImageAvailable()).toBe(false);
  });
});

// ── copyToClipboard ──────────────────────────────────────────────────

describe("copyToClipboard", () => {
  it("macOS: succeeds with exit code 0", async () => {
    setPlatform("darwin");
    const proc = createMockProc(0);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await copyToClipboard("hello");

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith("pbcopy", [], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    expect(proc.stdin.write).toHaveBeenCalledWith("hello");
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it("macOS: fails with non-zero exit code", async () => {
    setPlatform("darwin");
    const proc = createMockProc(1);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await copyToClipboard("hello");

    expect(result).toBe(false);
  });

  it("win32: uses clip command", async () => {
    setPlatform("win32");
    const proc = createMockProc(0);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await copyToClipboard("text");

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith("clip", [], {
      stdio: ["pipe", "ignore", "ignore"],
    });
  });

  it("linux: succeeds with xclip", async () => {
    setPlatform("linux");
    const proc = createMockProc(0);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await copyToClipboard("linux text");

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
  });

  it("linux: falls back to xsel when xclip errors", async () => {
    setPlatform("linux");

    const xclipProc = createMockProc(null);
    const xselProc = createMockProc(null); // don't auto-close

    vi.mocked(spawn)
      .mockReturnValueOnce(xclipProc as never)
      .mockReturnValueOnce(xselProc as never);

    const promise = copyToClipboard("fallback text");

    // Fire xclip error — this triggers the fallback spawn("xsel", ...)
    // After the error handler registers .on("close") on xselProc, emit close
    setTimeout(() => {
      xclipProc.emit("error", new Error("xclip not found"));
      // xsel close fires after the handler has been registered
      setTimeout(() => xselProc.emit("close", 0), 0);
    }, 0);

    const result = await promise;

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(2, "xsel", ["--clipboard", "--input"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    expect(xselProc.stdin.write).toHaveBeenCalledWith("fallback text");
    expect(xselProc.stdin.end).toHaveBeenCalled();
  });

  it("linux: returns false when both xclip and xsel fail via error", async () => {
    setPlatform("linux");

    const xclipProc = createMockProc(null);
    const xselProc = createMockProc(null);

    vi.mocked(spawn)
      .mockReturnValueOnce(xclipProc as never)
      .mockReturnValueOnce(xselProc as never);

    const promise = copyToClipboard("text");

    setTimeout(() => xclipProc.emit("error", new Error("xclip not found")), 0);
    setTimeout(() => xselProc.emit("error", new Error("xsel not found")), 5);

    const result = await promise;
    expect(result).toBe(false);
  });

  it("linux: xsel fallback returns false on non-zero exit", async () => {
    setPlatform("linux");

    const xclipProc = createMockProc(null);
    const xselProc = createMockProc(null);

    vi.mocked(spawn)
      .mockReturnValueOnce(xclipProc as never)
      .mockReturnValueOnce(xselProc as never);

    const promise = copyToClipboard("text");

    setTimeout(() => xclipProc.emit("error", new Error("xclip not found")), 0);
    setTimeout(() => xselProc.emit("close", 1), 5);

    const result = await promise;
    expect(result).toBe(false);
  });

  it("linux: xsel fallback catches spawn throw", async () => {
    setPlatform("linux");

    const xclipProc = createMockProc(null);

    let callCount = 0;
    vi.mocked(spawn).mockImplementation((() => {
      callCount++;
      if (callCount === 1) return xclipProc as never;
      throw new Error("xsel spawn failed");
    }) as never);

    const promise = copyToClipboard("text");

    setTimeout(() => xclipProc.emit("error", new Error("xclip not found")), 0);

    const result = await promise;
    expect(result).toBe(false);
  });

  it("unsupported platform: returns false immediately", async () => {
    setPlatform("freebsd");

    const result = await copyToClipboard("text");

    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("macOS: handles spawn error on non-linux platform", async () => {
    setPlatform("darwin");

    const proc = createMockProc(null);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const promise = copyToClipboard("text");
    setTimeout(() => proc.emit("error", new Error("spawn ENOENT")), 0);

    const result = await promise;
    expect(result).toBe(false);
  });

  it("handles spawn throwing synchronously", async () => {
    setPlatform("darwin");
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const result = await copyToClipboard("text");
    expect(result).toBe(false);
  });

  it("ignores duplicate resolution from close after error", async () => {
    setPlatform("darwin");

    const proc = createMockProc(null);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const promise = copyToClipboard("text");

    setTimeout(() => {
      proc.emit("error", new Error("oops"));
      proc.emit("close", 0);
    }, 0);

    const result = await promise;
    expect(result).toBe(false);
  });
});

// ── isClipboardAvailable ─────────────────────────────────────────────

describe("isClipboardAvailable", () => {
  it("macOS: returns true when pbcopy exists", async () => {
    setPlatform("darwin");
    const proc = createMockProc(0);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await isClipboardAvailable();

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith("which", ["pbcopy"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  });

  it("macOS: returns false when pbcopy not found", async () => {
    setPlatform("darwin");
    const proc = createMockProc(1);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await isClipboardAvailable();
    expect(result).toBe(false);
  });

  it("win32: uses 'where' to check for clip", async () => {
    setPlatform("win32");
    const proc = createMockProc(0);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const result = await isClipboardAvailable();

    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith("where", ["clip"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  });

  it("linux: falls back to xsel when xclip check errors", async () => {
    setPlatform("linux");

    const xclipCheckProc = createMockProc(null);
    const xselCheckProc = createMockProc(null); // don't auto-close

    vi.mocked(spawn)
      .mockReturnValueOnce(xclipCheckProc as never)
      .mockReturnValueOnce(xselCheckProc as never);

    const promise = isClipboardAvailable();
    setTimeout(() => {
      xclipCheckProc.emit("error", new Error("not found"));
      // After the error handler registers .on("close") on xselCheckProc
      setTimeout(() => xselCheckProc.emit("close", 0), 0);
    }, 0);

    const result = await promise;
    expect(result).toBe(true);
    expect(spawn).toHaveBeenNthCalledWith(2, "which", ["xsel"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  });

  it("linux: returns false when both xclip and xsel checks fail", async () => {
    setPlatform("linux");

    const xclipCheckProc = createMockProc(null);
    const xselCheckProc = createMockProc(null);

    vi.mocked(spawn)
      .mockReturnValueOnce(xclipCheckProc as never)
      .mockReturnValueOnce(xselCheckProc as never);

    const promise = isClipboardAvailable();
    setTimeout(() => xclipCheckProc.emit("error", new Error("not found")), 0);
    setTimeout(() => xselCheckProc.emit("error", new Error("not found")), 5);

    const result = await promise;
    expect(result).toBe(false);
  });

  it("unsupported platform: returns false immediately", async () => {
    setPlatform("freebsd");

    const result = await isClipboardAvailable();

    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("macOS: returns false on spawn error (non-linux)", async () => {
    setPlatform("darwin");

    const proc = createMockProc(null);
    vi.mocked(spawn).mockReturnValue(proc as never);

    const promise = isClipboardAvailable();
    setTimeout(() => proc.emit("error", new Error("spawn ENOENT")), 0);

    const result = await promise;
    expect(result).toBe(false);
  });
});

// ── readClipboardImage ───────────────────────────────────────────────

describe("readClipboardImage", () => {
  describe("macOS", () => {
    beforeEach(() => setPlatform("darwin"));

    it("reads image and returns base64 data", async () => {
      const pngBuffer = Buffer.from("fake-png-data");

      vi.mocked(execFileSync).mockReturnValue("ok\n");
      vi.mocked(fs.readFile).mockResolvedValue(pngBuffer);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();

      expect(result).toEqual({
        data: pngBuffer.toString("base64"),
        media_type: "image/png",
      });
      expect(execFileSync).toHaveBeenCalledWith(
        "osascript",
        ["-e", expect.stringContaining("class PNGf")],
        expect.objectContaining({ encoding: "utf-8", timeout: 10000 }),
      );
      expect(fs.unlink).toHaveBeenCalled();
    });

    it("returns null when osascript returns error result", async () => {
      vi.mocked(execFileSync).mockReturnValue("error: no image");
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();
      expect(result).toBeNull();
    });

    it("returns null when execFileSync throws", async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("osascript failed");
      });
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();
      expect(result).toBeNull();
    });

    it("cleans up temp file even on readFile error", async () => {
      vi.mocked(execFileSync).mockReturnValue("ok\n");
      vi.mocked(fs.readFile).mockRejectedValue(new Error("read error"));
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();

      expect(result).toBeNull();
      expect(fs.unlink).toHaveBeenCalled();
    });

    it("ignores unlink errors during cleanup", async () => {
      const pngBuffer = Buffer.from("png");

      vi.mocked(execFileSync).mockReturnValue("ok");
      vi.mocked(fs.readFile).mockResolvedValue(pngBuffer);
      vi.mocked(fs.unlink).mockRejectedValue(new Error("ENOENT"));

      const result = await readClipboardImage();

      expect(result).toEqual({
        data: pngBuffer.toString("base64"),
        media_type: "image/png",
      });
    });
  });

  describe("Linux", () => {
    beforeEach(() => setPlatform("linux"));

    it("reads xclip targets and returns png data", async () => {
      const pngBuffer = Buffer.from("linux-png-data");

      vi.mocked(execFileSync)
        .mockReturnValueOnce("TARGETS\nimage/png\ntext/plain")
        .mockReturnValueOnce(pngBuffer as never);

      const result = await readClipboardImage();

      expect(result).toEqual({
        data: pngBuffer.toString("base64"),
        media_type: "image/png",
      });
      expect(execFileSync).toHaveBeenCalledWith(
        "xclip",
        ["-selection", "clipboard", "-t", "TARGETS", "-o"],
        expect.objectContaining({ encoding: "utf-8", timeout: 5000 }),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "xclip",
        ["-selection", "clipboard", "-t", "image/png", "-o"],
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it("returns null when no image/png target available", async () => {
      vi.mocked(execFileSync).mockReturnValue("TARGETS\ntext/plain\ntext/html");

      const result = await readClipboardImage();
      expect(result).toBeNull();
      expect(execFileSync).toHaveBeenCalledTimes(1);
    });

    it("returns null when xclip throws", async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("xclip not found");
      });

      const result = await readClipboardImage();
      expect(result).toBeNull();
    });
  });

  describe("Windows", () => {
    beforeEach(() => setPlatform("win32"));

    it("reads image via PowerShell and returns base64 data", async () => {
      const pngBuffer = Buffer.from("win-png-data");

      vi.mocked(execFileSync).mockReturnValue("ok\n");
      vi.mocked(fs.readFile).mockResolvedValue(pngBuffer);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();

      expect(result).toEqual({
        data: pngBuffer.toString("base64"),
        media_type: "image/png",
      });
      expect(execFileSync).toHaveBeenCalledWith(
        "powershell",
        ["-Command", expect.stringContaining("Clipboard")],
        expect.objectContaining({ encoding: "utf-8", timeout: 10000 }),
      );
    });

    it("returns null when PowerShell reports no-image", async () => {
      vi.mocked(execFileSync).mockReturnValue("no-image");
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();
      expect(result).toBeNull();
    });

    it("returns null when PowerShell throws", async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("powershell error");
      });
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await readClipboardImage();
      expect(result).toBeNull();
    });

    it("cleans up temp file in finally block", async () => {
      vi.mocked(execFileSync).mockReturnValue("ok");
      vi.mocked(fs.readFile).mockRejectedValue(new Error("read error"));
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await readClipboardImage();
      expect(fs.unlink).toHaveBeenCalled();
    });

    it("ignores unlink errors during cleanup", async () => {
      const pngBuffer = Buffer.from("png");

      vi.mocked(execFileSync).mockReturnValue("ok");
      vi.mocked(fs.readFile).mockResolvedValue(pngBuffer);
      vi.mocked(fs.unlink).mockRejectedValue(new Error("ENOENT"));

      const result = await readClipboardImage();

      expect(result).toEqual({
        data: pngBuffer.toString("base64"),
        media_type: "image/png",
      });
    });
  });

  describe("unsupported platform", () => {
    it("returns null", async () => {
      setPlatform("freebsd");

      const result = await readClipboardImage();
      expect(result).toBeNull();
    });
  });
});
