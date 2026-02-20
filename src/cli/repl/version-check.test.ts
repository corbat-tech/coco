/**
 * Tests for version-check module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk to avoid color codes in tests
// chalk.green is made callable with a .bold property to support chalk.green.bold(...)
function makeChalkFn() {
  const fn = vi.fn((s: string) => s);
  fn.bold = vi.fn((s: string) => s);
  return fn;
}

const chalkYellowSpy = vi.fn((s: string) => s);

vi.mock("chalk", () => ({
  default: {
    yellow: (s: string) => chalkYellowSpy(s),
    green: makeChalkFn(),
    dim: (s: string) => s,
    white: (s: string) => s,
    red: (s: string) => s,
  },
}));

// Mock VERSION from ../../version.js
vi.mock("../../version.js", () => ({
  VERSION: "1.0.0",
}));

// Mock node:fs/promises for file-based cache tests
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
  },
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

describe("version-check", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv1 = process.argv[1];

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
    // Reset process.argv[1] to default
    process.argv[1] = "/usr/local/bin/coco";
    // Default fs mocks to resolve successfully
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    chalkYellowSpy.mockClear();
    // Ensure the env guard is not set between tests
    delete process.env["COCO_NO_UPDATE_CHECK"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.argv[1] = originalArgv1;
    delete process.env["COCO_NO_UPDATE_CHECK"];
    // Reset module cache so each test gets fresh state
    vi.resetModules();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
  });

  async function importModule() {
    return await import("./version-check.js");
  }

  describe("checkForUpdates", () => {
    it("should return update info when newer version is available", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).not.toBeNull();
      expect(result!.currentVersion).toBe("1.0.0");
      expect(result!.latestVersion).toBe("2.0.0");
      expect(result!.updateCommand).toContain("@corbat-tech/coco@latest");
    });

    it("should return null when current version is latest", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
    });

    it("should return null when current version is newer than registry", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "0.9.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
    });

    it("should use file cache when available and recent", async () => {
      const cache = {
        latestVersion: "3.0.0",
        checkedAt: Date.now(), // just now, well within 24h
      };
      mockReadFile.mockResolvedValue(JSON.stringify(cache));

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("3.0.0");
    });

    it("should return null from cache when cached version is not newer", async () => {
      const cache = {
        latestVersion: "1.0.0",
        checkedAt: Date.now(),
      };
      mockReadFile.mockResolvedValue(JSON.stringify(cache));

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("should fetch new version when cache is stale", async () => {
      const staleCache = {
        latestVersion: "1.5.0",
        checkedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      };
      mockReadFile.mockResolvedValue(JSON.stringify(staleCache));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(mockFetch).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("2.0.0");
    });

    it("should return null on fetch failure (network error)", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
    });

    it("should return null on non-ok HTTP response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
    });

    it("should return null when registry response lacks dist-tags", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
    });

    it("should handle malformed cache gracefully", async () => {
      mockReadFile.mockResolvedValue("not-valid-json");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      // Should fall through to fetch since cache parse failed
      expect(mockFetch).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("2.0.0");
    });

    it("should write cache file after successful fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      await checkForUpdates();

      expect(mockWriteFile).toHaveBeenCalled();
      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(writtenContent.latestVersion).toBe("1.0.0");
      expect(writtenContent.checkedAt).toBeGreaterThan(0);
    });
  });

  describe("getCachedVersion / setCachedVersion (file-based cache)", () => {
    it("getCachedVersion returns null when cache file does not exist", async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      // Drive via checkForUpdates which internally calls getCachedVersion
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      await checkForUpdates();

      // fetch should have been called because no cache was available
      expect(mockFetch).toHaveBeenCalled();
    });

    it("getCachedVersion returns cached data when file is readable and fresh", async () => {
      const cache = { latestVersion: "5.0.0", checkedAt: Date.now() };
      mockReadFile.mockResolvedValue(JSON.stringify(cache));

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      // Fresh cache hit — fetch must NOT be called
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result!.latestVersion).toBe("5.0.0");
    });

    it("setCachedVersion creates ~/.coco/ directory and writes the cache file", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "3.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      await checkForUpdates();

      // mkdir should have been called with { recursive: true }
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining(".coco"), { recursive: true });
      // writeFile should have been called with the cache file path
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("version-check-cache.json"),
        expect.any(String),
        "utf-8",
      );
    });

    it("getCachedVersion returns null (cache miss) when cache file contains valid JSON but wrong shape", async () => {
      // Valid JSON but latestVersion is a number and checkedAt is a string — shape is wrong.
      mockReadFile.mockResolvedValue(
        JSON.stringify({ latestVersion: 42, checkedAt: "not-a-number" }),
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      // Shape validation failed → treated as cache miss → falls through to fetch
      expect(mockFetch).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("2.0.0");
    });

    it("setCachedVersion silently ignores write errors", async () => {
      mockWriteFile.mockRejectedValue(new Error("EROFS: read-only file system"));
      mockMkdir.mockRejectedValue(new Error("EROFS: read-only file system"));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "3.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      // Should not throw even if file write fails
      await expect(checkForUpdates()).resolves.not.toThrow();
    });
  });

  describe("printUpdateBanner", () => {
    it("should log update info to console", async () => {
      const { printUpdateBanner } = await importModule();

      printUpdateBanner({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        updateCommand: "npm install -g @corbat-tech/coco@latest",
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      // Should have multiple console.log calls (blank lines + message lines)
      expect(consoleLogSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
      expect(allOutput).toContain("1.0.0");
      expect(allOutput).toContain("2.0.0");
      expect(allOutput).toContain("npm install -g @corbat-tech/coco@latest");

      // chalk.yellow must have been called and its argument must contain the latest version
      expect(chalkYellowSpy).toHaveBeenCalled();
      const yellowArgs = chalkYellowSpy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(yellowArgs).toContain("2.0.0");
    });
  });

  describe("checkForUpdatesInBackground", () => {
    it("should call callback with update when update is available", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "5.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdatesInBackground } = await importModule();

      const callbackDone = new Promise<void>((resolve) => {
        checkForUpdatesInBackground(() => {
          resolve();
        });
      });

      await callbackDone;

      // printUpdateBanner should have been called
      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
      expect(allOutput).toContain("5.0.0");
    });

    it("should call callback even when no update is available", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdatesInBackground } = await importModule();

      const callbackDone = new Promise<void>((resolve) => {
        checkForUpdatesInBackground(() => {
          resolve();
        });
      });

      await callbackDone;
      // No update notification should be printed (only possible blank lines from other sources)
    });

    it("should call callback on fetch error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network down"));
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdatesInBackground } = await importModule();

      const callbackDone = new Promise<void>((resolve) => {
        checkForUpdatesInBackground(() => {
          resolve();
        });
      });

      await callbackDone;
      // Should not throw, callback should still fire
    });

    it("should call callback via catch path when printUpdateBanner throws", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      // Make console.log throw to trigger the .catch() path
      consoleLogSpy.mockImplementation(() => {
        throw new Error("console broken");
      });

      const { checkForUpdatesInBackground } = await importModule();

      const callbackDone = new Promise<void>((resolve) => {
        checkForUpdatesInBackground(() => {
          resolve();
        });
      });

      await callbackDone;
      // Callback should still be called even though printUpdateBanner threw
    });

    it("should work without a callback", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdatesInBackground } = await importModule();

      // Should not throw when no callback is provided
      checkForUpdatesInBackground();

      // Give the promise time to settle
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  describe("update command detection", () => {
    it("should return npm command by default", async () => {
      process.argv[1] = "/usr/local/bin/coco";
      // Clear user-agent so detection falls through to argv check
      delete process.env["npm_config_user_agent"];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result!.updateCommand).toBe("npm install -g @corbat-tech/coco@latest");
    });

    it("should detect pnpm from process.argv[1]", async () => {
      process.argv[1] = "/usr/local/share/pnpm/coco";
      // Clear user-agent so detection falls through to argv check
      delete process.env["npm_config_user_agent"];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result!.updateCommand).toBe("pnpm add -g @corbat-tech/coco@latest");
    });

    it("should detect yarn from process.argv[1] and return npm fallback (yarn global unsupported in v2+)", async () => {
      process.argv[1] = "/home/user/.yarn/bin/coco";
      // Clear user-agent so detection falls through to argv check
      delete process.env["npm_config_user_agent"];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      // yarn global is not supported in Yarn v2+ (Berry); npm is the reliable fallback
      expect(result!.updateCommand).toBe("npm install -g @corbat-tech/coco@latest");
    });

    it("should detect bun from process.argv[1]", async () => {
      process.argv[1] = "/home/user/.bun/bin/coco";
      // Clear user-agent so detection falls through to argv check
      delete process.env["npm_config_user_agent"];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result!.updateCommand).toBe("bun add -g @corbat-tech/coco@latest");
    });

    it("should detect pnpm from npm_config_user_agent (takes priority over argv)", async () => {
      // argv has no PM name, but user-agent env var says pnpm
      process.argv[1] = "/usr/local/bin/coco";
      process.env["npm_config_user_agent"] = "pnpm/8.6.0 npm/? node/v20.0.0 linux x64";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      delete process.env["npm_config_user_agent"];
      expect(result!.updateCommand).toBe("pnpm add -g @corbat-tech/coco@latest");
    });

    it("should detect yarn from npm_config_user_agent and return npm fallback (yarn global unsupported in v2+)", async () => {
      process.argv[1] = "/usr/local/bin/coco";
      process.env["npm_config_user_agent"] = "yarn/3.6.0 npm/? node/v20.0.0 linux x64";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      delete process.env["npm_config_user_agent"];
      // yarn global is not supported in Yarn v2+ (Berry); npm is the reliable fallback
      expect(result!.updateCommand).toBe("npm install -g @corbat-tech/coco@latest");
    });

    it("should detect bun from npm_config_user_agent (takes priority over argv)", async () => {
      process.argv[1] = "/usr/local/bin/coco";
      process.env["npm_config_user_agent"] = "bun/1.0.0 node/v20.0.0 linux x64";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      delete process.env["npm_config_user_agent"];
      expect(result!.updateCommand).toBe("bun add -g @corbat-tech/coco@latest");
    });

    it("should prefer npm_config_user_agent over argv when they disagree (user-agent wins)", async () => {
      // argv says yarn path but user-agent says pnpm — user-agent takes priority
      process.argv[1] = "/home/user/.yarn/bin/coco";
      process.env["npm_config_user_agent"] = "pnpm/8.6.0 npm/? node/v20.0.0 linux x64";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      delete process.env["npm_config_user_agent"];
      expect(result!.updateCommand).toBe("pnpm add -g @corbat-tech/coco@latest");
    });
  });

  describe("checkForUpdatesInteractive", () => {
    const UPDATE_COMMAND = "npm install -g @corbat-tech/coco@latest";

    function mockFetchWithUpdate() {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);
    }

    it("should return without prompting when no update is available", async () => {
      // checkForUpdates returns null (latest == current)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const confirmSpy = vi.fn();
      vi.doMock("@clack/prompts", () => ({
        confirm: confirmSpy,
        isCancel: vi.fn(),
      }));

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should not call execa or exit when user answers No", async () => {
      mockFetchWithUpdate();

      const execaSpy = vi.fn();
      vi.doMock("execa", () => ({ execa: execaSpy }));
      vi.doMock("@clack/prompts", () => ({
        confirm: vi.fn().mockResolvedValue(false),
        isCancel: vi.fn().mockReturnValue(false),
      }));

      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as () => never);

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      expect(execaSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();

      processExitSpy.mockRestore();
    });

    it("should not call execa or exit when user cancels the prompt", async () => {
      mockFetchWithUpdate();

      const execaSpy = vi.fn();
      vi.doMock("execa", () => ({ execa: execaSpy }));
      vi.doMock("@clack/prompts", () => ({
        confirm: vi.fn().mockResolvedValue(Symbol("cancel")),
        isCancel: vi.fn().mockReturnValue(true),
      }));

      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as () => never);

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      expect(execaSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();

      processExitSpy.mockRestore();
    });

    it("should call execa with correct command and exit(0) on successful update", async () => {
      mockFetchWithUpdate();

      const execaSpy = vi.fn().mockResolvedValue({});
      vi.doMock("execa", () => ({ execa: execaSpy }));
      vi.doMock("@clack/prompts", () => ({
        confirm: vi.fn().mockResolvedValue(true),
        isCancel: vi.fn().mockReturnValue(false),
      }));

      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as () => never);

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      expect(execaSpy).toHaveBeenCalledWith("npm", ["install", "-g", "@corbat-tech/coco@latest"], {
        stdio: "inherit",
        timeout: 120_000,
      });
      expect(processExitSpy).toHaveBeenCalledWith(0);

      processExitSpy.mockRestore();
    });

    it("should print sudo hint and return (no exit) when execa fails with EACCES", async () => {
      mockFetchWithUpdate();

      vi.doMock("execa", () => ({
        execa: vi.fn().mockRejectedValue(new Error("EACCES: permission denied")),
      }));
      vi.doMock("@clack/prompts", () => ({
        confirm: vi.fn().mockResolvedValue(true),
        isCancel: vi.fn().mockReturnValue(false),
      }));

      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as () => never);

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
      expect(allOutput).toContain("Permission denied");
      expect(allOutput).toContain(`sudo ${UPDATE_COMMAND}`);
      expect(processExitSpy).not.toHaveBeenCalled();

      processExitSpy.mockRestore();
    });

    it("should print error message and return (no exit) when execa fails with generic error", async () => {
      mockFetchWithUpdate();

      vi.doMock("execa", () => ({
        execa: vi.fn().mockRejectedValue(new Error("command not found")),
      }));
      vi.doMock("@clack/prompts", () => ({
        confirm: vi.fn().mockResolvedValue(true),
        isCancel: vi.fn().mockReturnValue(false),
      }));

      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as () => never);

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      const allOutput = consoleLogSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
      expect(allOutput).toContain("Update failed");
      expect(allOutput).toContain("command not found");
      expect(processExitSpy).not.toHaveBeenCalled();

      processExitSpy.mockRestore();
    });

    it("should return without prompting when COCO_NO_UPDATE_CHECK is set (guard owned by checkForUpdates)", async () => {
      // The COCO_NO_UPDATE_CHECK guard lives inside checkForUpdates, not checkForUpdatesInteractive.
      // checkForUpdatesInteractive delegates to checkForUpdates, which returns null immediately,
      // so no fetch and no prompt should occur.
      process.env["COCO_NO_UPDATE_CHECK"] = "1";

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const confirmSpy = vi.fn();
      vi.doMock("@clack/prompts", () => ({
        confirm: confirmSpy,
        isCancel: vi.fn(),
      }));

      const { checkForUpdatesInteractive } = await importModule();
      await checkForUpdatesInteractive();

      // checkForUpdates returns null early → no fetch, no prompt, no banner
      expect(mockFetch).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("checkForUpdates — COCO_NO_UPDATE_CHECK guard", () => {
    it("should return without checking when COCO_NO_UPDATE_CHECK is set", async () => {
      process.env["COCO_NO_UPDATE_CHECK"] = "1";

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("semver comparison via checkForUpdates", () => {
    it("should detect minor version update", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.1.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("1.1.0");
    });

    it("should detect patch version update", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.1" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("1.0.1");
    });

    it("should NOT show update when pre-release latest (1.0.0-rc.1) strips to same as current (1.0.0)", async () => {
      // VERSION is mocked as "1.0.0". The registry returns "1.0.0-rc.1".
      // After stripping pre-release both become "1.0.0" → equal → no update shown.
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.0-rc.1" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      // 1.0.0-rc.1 stripped → 1.0.0, current is 1.0.0 → no update
      expect(result).toBeNull();
    });

    it("pre-release registry version (2.0.0-rc.1) should show update when current is 1.0.0", async () => {
      // VERSION mocked as "1.0.0". Registry returns "2.0.0-rc.1".
      // After stripping: 2.0.0 > 1.0.0 → update available.
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "2.0.0-rc.1" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("2.0.0-rc.1");
    });

    it("pre-release in cache (3.0.0-alpha) should show update when current is 1.0.0", async () => {
      // Cached version includes a pre-release tag; after stripping 3.0.0 > 1.0.0.
      const cache = {
        latestVersion: "3.0.0-alpha",
        checkedAt: Date.now(),
      };
      mockReadFile.mockResolvedValue(JSON.stringify(cache));

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe("3.0.0-alpha");
    });

    it("should return null (no update shown) when registry returns a garbage version string (NaN path)", async () => {
      // compareVersions produces NaN when parsing "not-a-version"; the comparison
      // NaN > number is always false, so no update must be reported and null is returned.
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "not-a-version" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result).toBeNull();
    });
  });

  describe("fetch timeout / abort path", () => {
    it("should return null when fetch never resolves (AbortController timeout)", async () => {
      vi.useFakeTimers();

      // Simulate a hanging fetch: once the AbortSignal fires, reject with an AbortError.
      // This matches what real browsers/Node do when an AbortController aborts a fetch.
      const hangingFetch = vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              const err = new DOMException("The operation was aborted.", "AbortError");
              reject(err);
            });
          }),
      );
      vi.stubGlobal("fetch", hangingFetch);

      const { checkForUpdates } = await importModule();

      // Start the check — fetch is pending, waiting for the AbortController to fire
      const checkPromise = checkForUpdates();

      // Advance past FETCH_TIMEOUT_MS (3000 ms) so the setTimeout inside
      // fetchLatestVersion fires and calls controller.abort()
      await vi.advanceTimersByTimeAsync(3100);

      const result = await checkPromise;

      vi.useRealTimers();

      // The AbortError is caught by the catch block in fetchLatestVersion → returns null
      expect(result).toBeNull();
    });
  });
});
