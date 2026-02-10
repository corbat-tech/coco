/**
 * Tests for version-check module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CACHE_KEY = "corbat-tech-coco-version-check";

// Mock chalk to avoid color codes in tests
vi.mock("chalk", () => ({
  default: {
    yellow: (s: string) => s,
    green: (s: string) => s,
    dim: (s: string) => s,
    white: (s: string) => s,
  },
}));

// Mock VERSION from ../../version.js
vi.mock("../../version.js", () => ({
  VERSION: "1.0.0",
}));

describe("version-check", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv1 = process.argv[1];

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
    // Reset process.argv[1] to default
    process.argv[1] = "/usr/local/bin/coco";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env[CACHE_KEY];
    process.argv[1] = originalArgv1;
    // Reset module cache so each test gets fresh state
    vi.resetModules();
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

    it("should use cache when available and recent", async () => {
      const cache = {
        latestVersion: "3.0.0",
        checkedAt: Date.now(), // just now, well within 24h
      };
      process.env[CACHE_KEY] = JSON.stringify(cache);

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
      process.env[CACHE_KEY] = JSON.stringify(cache);

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
      process.env[CACHE_KEY] = JSON.stringify(staleCache);

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
      process.env[CACHE_KEY] = "not-valid-json";

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

    it("should set cache after successful fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      await checkForUpdates();

      // Cache should be set in process.env
      const cached = JSON.parse(process.env[CACHE_KEY]!);
      expect(cached.latestVersion).toBe("1.0.0");
      expect(cached.checkedAt).toBeGreaterThan(0);
    });
  });

  describe("printUpdateNotification", () => {
    it("should log update info to console", async () => {
      const { printUpdateNotification } = await importModule();

      printUpdateNotification({
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

      // printUpdateNotification should have been called
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

    it("should call callback via catch path when printUpdateNotification throws", async () => {
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
      // Callback should still be called even though printUpdateNotification threw
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

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result!.updateCommand).toBe("pnpm add -g @corbat-tech/coco@latest");
    });

    it("should detect yarn from process.argv[1]", async () => {
      process.argv[1] = "/home/user/.yarn/bin/coco";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result!.updateCommand).toBe("yarn global add @corbat-tech/coco@latest");
    });

    it("should detect bun from process.argv[1]", async () => {
      process.argv[1] = "/home/user/.bun/bin/coco";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "dist-tags": { latest: "9.0.0" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { checkForUpdates } = await importModule();
      const result = await checkForUpdates();

      expect(result!.updateCommand).toBe("bun add -g @corbat-tech/coco@latest");
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
  });
});
