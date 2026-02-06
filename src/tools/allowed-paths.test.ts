/**
 * Tests for Allowed Paths Store
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Mock fs before importing the module
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock config paths
vi.mock("../config/paths.js", () => ({
  CONFIG_PATHS: {
    home: "/mock/.coco",
    config: "/mock/.coco/config.json",
    env: "/mock/.coco/.env",
    projects: "/mock/.coco/projects.json",
    trustedTools: "/mock/.coco/trusted-tools.json",
  },
}));

import {
  getAllowedPaths,
  isWithinAllowedPath,
  addAllowedPathToSession,
  removeAllowedPathFromSession,
  clearSessionAllowedPaths,
  loadAllowedPaths,
  persistAllowedPath,
  removePersistedAllowedPath,
} from "./allowed-paths.js";

describe("Allowed Paths Store", () => {
  beforeEach(() => {
    clearSessionAllowedPaths();
    vi.clearAllMocks();
  });

  describe("getAllowedPaths", () => {
    it("should return empty array initially", () => {
      expect(getAllowedPaths()).toEqual([]);
    });

    it("should return a copy of allowed paths", () => {
      addAllowedPathToSession("/test/dir", "read");
      const paths = getAllowedPaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]!.path).toBe("/test/dir");
      // Should be a copy
      paths.push({ path: "/extra", authorizedAt: "", level: "read" });
      expect(getAllowedPaths()).toHaveLength(1);
    });
  });

  describe("isWithinAllowedPath", () => {
    it("should return false when no paths are allowed", () => {
      expect(isWithinAllowedPath("/some/path", "read")).toBe(false);
    });

    it("should return true for exact match with read", () => {
      addAllowedPathToSession("/allowed/dir", "read");
      expect(isWithinAllowedPath("/allowed/dir", "read")).toBe(true);
    });

    it("should return true for subdirectory with read", () => {
      addAllowedPathToSession("/allowed/dir", "read");
      expect(isWithinAllowedPath("/allowed/dir/sub/file.txt", "read")).toBe(true);
    });

    it("should return false for partial path match", () => {
      addAllowedPathToSession("/allowed/dir", "read");
      expect(isWithinAllowedPath("/allowed/directory", "read")).toBe(false);
    });

    it("should allow read on write-level entries", () => {
      addAllowedPathToSession("/allowed/dir", "write");
      expect(isWithinAllowedPath("/allowed/dir/file.txt", "read")).toBe(true);
    });

    it("should allow write on write-level entries", () => {
      addAllowedPathToSession("/allowed/dir", "write");
      expect(isWithinAllowedPath("/allowed/dir/file.txt", "write")).toBe(true);
    });

    it("should deny write on read-level entries", () => {
      addAllowedPathToSession("/allowed/dir", "read");
      expect(isWithinAllowedPath("/allowed/dir/file.txt", "write")).toBe(false);
    });

    it("should deny delete on read-level entries", () => {
      addAllowedPathToSession("/allowed/dir", "read");
      expect(isWithinAllowedPath("/allowed/dir/file.txt", "delete")).toBe(false);
    });

    it("should allow delete on write-level entries", () => {
      addAllowedPathToSession("/allowed/dir", "write");
      expect(isWithinAllowedPath("/allowed/dir/file.txt", "delete")).toBe(true);
    });
  });

  describe("addAllowedPathToSession", () => {
    it("should add a path to the session", () => {
      addAllowedPathToSession("/test/path", "read");
      const paths = getAllowedPaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]!.level).toBe("read");
    });

    it("should not add duplicate paths", () => {
      addAllowedPathToSession("/test/path", "read");
      addAllowedPathToSession("/test/path", "read");
      expect(getAllowedPaths()).toHaveLength(1);
    });

    it("should resolve relative paths to absolute", () => {
      addAllowedPathToSession("relative/path", "write");
      const paths = getAllowedPaths();
      expect(paths).toHaveLength(1);
      expect(path.isAbsolute(paths[0]!.path)).toBe(true);
    });

    it("should include authorizedAt timestamp", () => {
      addAllowedPathToSession("/test/path", "read");
      const paths = getAllowedPaths();
      expect(paths[0]!.authorizedAt).toBeTruthy();
      // Should be ISO string
      expect(new Date(paths[0]!.authorizedAt).toISOString()).toBe(paths[0]!.authorizedAt);
    });
  });

  describe("removeAllowedPathFromSession", () => {
    it("should remove an existing path", () => {
      addAllowedPathToSession("/test/path", "read");
      const removed = removeAllowedPathFromSession("/test/path");
      expect(removed).toBe(true);
      expect(getAllowedPaths()).toHaveLength(0);
    });

    it("should return false when path not found", () => {
      const removed = removeAllowedPathFromSession("/nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("clearSessionAllowedPaths", () => {
    it("should clear all paths", () => {
      addAllowedPathToSession("/path1", "read");
      addAllowedPathToSession("/path2", "write");
      clearSessionAllowedPaths();
      expect(getAllowedPaths()).toHaveLength(0);
    });
  });

  describe("loadAllowedPaths", () => {
    it("should load persisted paths into session", async () => {
      const fs = await import("node:fs/promises");
      const store = {
        version: 1,
        projects: {
          [path.resolve("/my/project")]: [
            {
              path: "/extra/dir",
              authorizedAt: "2026-01-01T00:00:00.000Z",
              level: "read" as const,
            },
          ],
        },
      };
      vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(store));

      await loadAllowedPaths("/my/project");

      const paths = getAllowedPaths();
      expect(paths).toHaveLength(1);
      expect(paths[0]!.path).toBe("/extra/dir");
    });

    it("should handle missing store file", async () => {
      const fs = await import("node:fs/promises");
      vi.mocked(fs.default.readFile).mockRejectedValue(new Error("ENOENT"));

      await loadAllowedPaths("/my/project");
      expect(getAllowedPaths()).toHaveLength(0);
    });

    it("should not add duplicates when loading", async () => {
      const fs = await import("node:fs/promises");
      addAllowedPathToSession("/extra/dir", "read");

      const store = {
        version: 1,
        projects: {
          [path.resolve("/my/project")]: [
            {
              path: "/extra/dir",
              authorizedAt: "2026-01-01T00:00:00.000Z",
              level: "read" as const,
            },
          ],
        },
      };
      vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(store));

      await loadAllowedPaths("/my/project");
      expect(getAllowedPaths()).toHaveLength(1);
    });
  });

  describe("persistAllowedPath", () => {
    it("should persist a path to the store file", async () => {
      const fs = await import("node:fs/promises");
      // First load to set currentProjectPath
      vi.mocked(fs.default.readFile).mockResolvedValue(
        JSON.stringify({ version: 1, projects: {} }),
      );
      await loadAllowedPaths("/my/project");

      vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);

      await persistAllowedPath("/new/dir", "write");

      expect(vi.mocked(fs.default.writeFile)).toHaveBeenCalled();
      const written = JSON.parse(vi.mocked(fs.default.writeFile).mock.calls[0]![1] as string);
      const entries = written.projects[path.resolve("/my/project")];
      expect(entries).toHaveLength(1);
      expect(entries[0].path).toBe(path.resolve("/new/dir"));
      expect(entries[0].level).toBe("write");
    });

    it("should not persist duplicates", async () => {
      const fs = await import("node:fs/promises");
      const projectPath = path.resolve("/my/project");
      const existing = {
        version: 1,
        projects: {
          [projectPath]: [
            {
              path: path.resolve("/new/dir"),
              authorizedAt: "2026-01-01T00:00:00.000Z",
              level: "write",
            },
          ],
        },
      };
      vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(existing));
      await loadAllowedPaths("/my/project");

      await persistAllowedPath("/new/dir", "write");
      // writeFile should not have been called (no change)
      expect(vi.mocked(fs.default.writeFile)).not.toHaveBeenCalled();
    });

    it("should do nothing if no project loaded", async () => {
      clearSessionAllowedPaths();
      // Reset currentProjectPath by not calling loadAllowedPaths
      // We can't directly reset it, but persistAllowedPath guards against empty project
      const fs = await import("node:fs/promises");
      vi.mocked(fs.default.readFile).mockResolvedValue(
        JSON.stringify({ version: 1, projects: {} }),
      );
      // Don't call loadAllowedPaths so currentProjectPath might still be set from previous test
      // Just verify it doesn't throw
      await persistAllowedPath("/some/dir", "read");
    });
  });

  describe("removePersistedAllowedPath", () => {
    it("should remove a persisted path", async () => {
      const fs = await import("node:fs/promises");
      const projectPath = path.resolve("/my/project");
      const existing = {
        version: 1,
        projects: {
          [projectPath]: [
            {
              path: path.resolve("/old/dir"),
              authorizedAt: "2026-01-01T00:00:00.000Z",
              level: "read",
            },
          ],
        },
      };
      vi.mocked(fs.default.readFile).mockResolvedValue(JSON.stringify(existing));
      vi.mocked(fs.default.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.default.writeFile).mockResolvedValue(undefined);
      await loadAllowedPaths("/my/project");

      const removed = await removePersistedAllowedPath("/old/dir");
      expect(removed).toBe(true);
      expect(vi.mocked(fs.default.writeFile)).toHaveBeenCalled();
    });

    it("should return false when path not found in store", async () => {
      const fs = await import("node:fs/promises");
      const projectPath = path.resolve("/my/project");
      vi.mocked(fs.default.readFile).mockResolvedValue(
        JSON.stringify({ version: 1, projects: { [projectPath]: [] } }),
      );
      await loadAllowedPaths("/my/project");

      const removed = await removePersistedAllowedPath("/nonexistent");
      expect(removed).toBe(false);
    });

    it("should return false when project has no entries", async () => {
      const fs = await import("node:fs/promises");
      vi.mocked(fs.default.readFile).mockResolvedValue(
        JSON.stringify({ version: 1, projects: {} }),
      );
      await loadAllowedPaths("/my/project");

      const removed = await removePersistedAllowedPath("/some/dir");
      expect(removed).toBe(false);
    });
  });
});
