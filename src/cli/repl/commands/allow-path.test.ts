import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  select: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

vi.mock("chalk", () => ({
  default: {
    yellow: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    green: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

vi.mock("../../../tools/allowed-paths.js", () => ({
  getAllowedPaths: vi.fn().mockReturnValue([]),
  addAllowedPathToSession: vi.fn(),
  canonicalizeAllowedDirectory: vi.fn((input: string) => input),
  removeAllowedPathFromSession: vi.fn().mockReturnValue(true),
  persistAllowedPath: vi.fn().mockResolvedValue(undefined),
  removePersistedAllowedPath: vi.fn().mockResolvedValue(undefined),
}));

import * as p from "@clack/prompts";
import fs from "node:fs/promises";
import {
  getAllowedPaths,
  canonicalizeAllowedDirectory,
  addAllowedPathToSession,
  removeAllowedPathFromSession,
  persistAllowedPath,
  removePersistedAllowedPath,
} from "../../../tools/allowed-paths.js";
import { allowPathCommand } from "./allow-path.js";

const mockSession = { projectPath: "/home/user/project" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("allowPathCommand", () => {
  it("shows and grants the canonical destination resolved before confirmation", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(getAllowedPaths).mockReturnValue([]);
    vi.mocked(canonicalizeAllowedDirectory).mockReturnValueOnce("/resolved/destination");
    vi.mocked(p.select).mockResolvedValueOnce("session-read");
    await allowPathCommand.execute(["/alias"], mockSession);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("/resolved/destination"));
    expect(addAllowedPathToSession).toHaveBeenCalledExactlyOnceWith(
      "/resolved/destination",
      "read",
      "/resolved/destination",
    );
    expect(canonicalizeAllowedDirectory).toHaveBeenCalledTimes(1);
  });

  it("does not prompt or grant when the destination cannot be canonicalized", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(canonicalizeAllowedDirectory).mockImplementationOnce(() => {
      throw new Error("ELOOP");
    });
    await allowPathCommand.execute(["/alias"], mockSession);
    expect(p.select).not.toHaveBeenCalled();
    expect(addAllowedPathToSession).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalled();
  });

  it("has correct metadata", () => {
    expect(allowPathCommand.name).toBe("allow-path");
    expect(allowPathCommand.aliases).toContain("ap");
  });

  describe("list subcommand", () => {
    it("shows allowed paths with 'list' arg", async () => {
      vi.mocked(getAllowedPaths).mockReturnValue([]);
      const result = await allowPathCommand.execute(["list"], mockSession);
      expect(result).toBe(false);
    });

    it("shows allowed paths with 'ls' arg", async () => {
      vi.mocked(getAllowedPaths).mockReturnValue([]);
      const result = await allowPathCommand.execute(["ls"], mockSession);
      expect(result).toBe(false);
    });

    it("shows additional paths when present", async () => {
      vi.mocked(getAllowedPaths).mockReturnValue([
        { path: "/tmp/data", level: "write" },
        { path: "/var/logs", level: "read" },
      ] as any);
      const result = await allowPathCommand.execute(["list"], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("no args (usage)", () => {
    it("shows usage when no arguments", async () => {
      const result = await allowPathCommand.execute([], mockSession);
      expect(result).toBe(false);
      expect(p.log.info).toHaveBeenCalled();
    });
  });

  describe("add path", () => {
    it("rejects non-directory path", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);

      const result = await allowPathCommand.execute(["/tmp/file.txt"], mockSession);
      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
    });

    it("rejects non-existent path", async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));

      const result = await allowPathCommand.execute(["/nonexistent"], mockSession);
      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
    });

    it("rejects blocked system paths", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);

      const result = await allowPathCommand.execute(["/etc"], mockSession);
      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
    });

    it("rejects sub-path of blocked system paths", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);

      const result = await allowPathCommand.execute(["/etc/nginx"], mockSession);
      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
    });

    it("rejects path within project directory", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);

      const result = await allowPathCommand.execute(["/home/user/project/subdir"], mockSession);
      expect(result).toBe(false);
      expect(p.log.info).toHaveBeenCalled();
    });

    it("rejects already allowed path", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.mocked(getAllowedPaths).mockReturnValue([{ path: "/tmp/data", level: "write" }] as any);

      const result = await allowPathCommand.execute(["/tmp/data"], mockSession);
      expect(result).toBe(false);
      expect(p.log.info).toHaveBeenCalled();
    });

    it("adds session-write access after confirmation", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.mocked(getAllowedPaths).mockReturnValue([]);
      vi.mocked(p.select).mockResolvedValue("session-write");

      const result = await allowPathCommand.execute(["/tmp/newdir"], mockSession);
      expect(result).toBe(false);
      expect(addAllowedPathToSession).toHaveBeenCalled();
      expect(persistAllowedPath).not.toHaveBeenCalled();
    });

    it("adds persist-read access after confirmation", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.mocked(getAllowedPaths).mockReturnValue([]);
      vi.mocked(p.select).mockResolvedValue("persist-read");

      const result = await allowPathCommand.execute(["/tmp/newdir"], mockSession);
      expect(result).toBe(false);
      expect(addAllowedPathToSession).toHaveBeenCalled();
      expect(persistAllowedPath).toHaveBeenCalled();
    });

    it("cancels when user selects cancel", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.mocked(getAllowedPaths).mockReturnValue([]);
      vi.mocked(p.select).mockResolvedValue("no");

      const result = await allowPathCommand.execute(["/tmp/newdir"], mockSession);
      expect(result).toBe(false);
      expect(addAllowedPathToSession).not.toHaveBeenCalled();
    });

    it("cancels when user presses Ctrl+C", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      vi.mocked(getAllowedPaths).mockReturnValue([]);
      vi.mocked(p.select).mockResolvedValue(Symbol.for("cancel") as any);
      vi.mocked(p.isCancel).mockReturnValueOnce(true);

      const result = await allowPathCommand.execute(["/tmp/newdir"], mockSession);
      expect(result).toBe(false);
      expect(addAllowedPathToSession).not.toHaveBeenCalled();
    });
  });

  describe("revoke subcommand", () => {
    it("revokes with explicit path", async () => {
      vi.mocked(removeAllowedPathFromSession).mockReturnValue(true);

      const result = await allowPathCommand.execute(["revoke", "/tmp/data"], mockSession);
      expect(result).toBe(false);
      expect(removeAllowedPathFromSession).toHaveBeenCalled();
      expect(removePersistedAllowedPath).toHaveBeenCalled();
    });

    it("reports error when path not in allowed list", async () => {
      vi.mocked(removeAllowedPathFromSession).mockReturnValue(false);

      const result = await allowPathCommand.execute(["revoke", "/unknown"], mockSession);
      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
    });

    it("revoke with 'rm' alias", async () => {
      vi.mocked(removeAllowedPathFromSession).mockReturnValue(true);

      const result = await allowPathCommand.execute(["rm", "/tmp/data"], mockSession);
      expect(result).toBe(false);
      expect(removeAllowedPathFromSession).toHaveBeenCalled();
    });

    it("shows interactive revoke when no path provided", async () => {
      vi.mocked(getAllowedPaths).mockReturnValue([{ path: "/tmp/data", level: "write" }] as any);
      vi.mocked(p.select).mockResolvedValue("/tmp/data");
      vi.mocked(removeAllowedPathFromSession).mockReturnValue(true);

      const result = await allowPathCommand.execute(["revoke"], mockSession);
      expect(result).toBe(false);
      expect(p.select).toHaveBeenCalled();
      expect(removeAllowedPathFromSession).toHaveBeenCalled();
    });

    it("shows info when no paths to revoke", async () => {
      vi.mocked(getAllowedPaths).mockReturnValue([]);

      const result = await allowPathCommand.execute(["revoke"], mockSession);
      expect(result).toBe(false);
      expect(p.log.info).toHaveBeenCalled();
    });

    it("cancels interactive revoke", async () => {
      vi.mocked(getAllowedPaths).mockReturnValue([{ path: "/tmp/data", level: "write" }] as any);
      vi.mocked(p.select).mockResolvedValue("__cancel__");

      const result = await allowPathCommand.execute(["revoke"], mockSession);
      expect(result).toBe(false);
      expect(removeAllowedPathFromSession).not.toHaveBeenCalled();
    });
  });
});
