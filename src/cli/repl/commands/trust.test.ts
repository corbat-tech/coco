import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  log: {
    message: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

vi.mock("../trust-store.js", () => ({
  createTrustStore: vi.fn(),
}));

import * as p from "@clack/prompts";
import { createTrustStore } from "../trust-store.js";
import { trustCommand } from "./trust.js";

const mockTrustStore = {
  init: vi.fn().mockResolvedValue(undefined),
  isTrusted: vi.fn().mockReturnValue(false),
  getLevel: vi.fn().mockReturnValue("read"),
  list: vi.fn().mockReturnValue([]),
  can: vi.fn().mockReturnValue(false),
  addTrust: vi.fn().mockResolvedValue(undefined),
  removeTrust: vi.fn().mockResolvedValue(true),
};

const mockSession = { projectPath: "/test/project" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createTrustStore).mockReturnValue(mockTrustStore as any);
  mockTrustStore.init.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trustCommand", () => {
  it("has correct metadata", () => {
    expect(trustCommand.name).toBe("trust");
    expect(trustCommand.description).toBeTruthy();
  });

  describe("status subcommand", () => {
    it("shows untrusted status when project is not trusted", async () => {
      mockTrustStore.isTrusted.mockReturnValue(false);

      const result = await trustCommand.execute(["status"], mockSession);

      expect(result).toBe(false);
      expect(mockTrustStore.isTrusted).toHaveBeenCalledWith("/test/project");
    });

    it("defaults to status when no args", async () => {
      mockTrustStore.isTrusted.mockReturnValue(false);

      const result = await trustCommand.execute([], mockSession);

      expect(result).toBe(false);
      expect(mockTrustStore.isTrusted).toHaveBeenCalled();
    });

    it("shows trusted status with full details", async () => {
      mockTrustStore.isTrusted.mockReturnValue(true);
      mockTrustStore.getLevel.mockReturnValue("full");
      mockTrustStore.list.mockReturnValue([
        {
          path: "/test/project",
          approvalLevel: "full",
          approvedAt: Date.now(),
          lastAccessed: Date.now(),
          toolsTrusted: ["bash", "file"],
        },
      ]);
      mockTrustStore.can.mockReturnValue(true);

      const result = await trustCommand.execute(["status"], mockSession);

      expect(result).toBe(false);
      expect(mockTrustStore.getLevel).toHaveBeenCalledWith("/test/project");
    });

    it("shows trusted status without tools trusted", async () => {
      mockTrustStore.isTrusted.mockReturnValue(true);
      mockTrustStore.getLevel.mockReturnValue("write");
      mockTrustStore.list.mockReturnValue([
        {
          path: "/test/project",
          approvalLevel: "write",
          approvedAt: Date.now(),
          lastAccessed: Date.now(),
          toolsTrusted: [],
        },
      ]);
      mockTrustStore.can
        .mockReturnValueOnce(true) // read
        .mockReturnValueOnce(true) // write
        .mockReturnValueOnce(false); // execute

      const result = await trustCommand.execute(["status"], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("level subcommand", () => {
    it("changes trust level with explicit level arg", async () => {
      const result = await trustCommand.execute(["level", "write"], mockSession);

      expect(result).toBe(false);
      expect(mockTrustStore.addTrust).toHaveBeenCalledWith("/test/project", "write");
    });

    it("prompts for level when none provided", async () => {
      vi.mocked(p.select).mockResolvedValue("full");

      const result = await trustCommand.execute(["level"], mockSession);

      expect(result).toBe(false);
      expect(p.select).toHaveBeenCalled();
      expect(mockTrustStore.addTrust).toHaveBeenCalledWith("/test/project", "full");
    });

    it("cancels when user cancels level selection", async () => {
      vi.mocked(p.select).mockResolvedValue(Symbol.for("cancel") as any);
      vi.mocked(p.isCancel).mockReturnValue(true);

      const result = await trustCommand.execute(["level"], mockSession);

      expect(result).toBe(false);
      expect(p.outro).toHaveBeenCalledWith("Cancelled");
      expect(mockTrustStore.addTrust).not.toHaveBeenCalled();
    });

    it("rejects invalid trust level", async () => {
      const result = await trustCommand.execute(["level", "superadmin"], mockSession);

      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
      expect(mockTrustStore.addTrust).not.toHaveBeenCalled();
    });

    it("handles addTrust error", async () => {
      mockTrustStore.addTrust.mockRejectedValueOnce(new Error("DB error"));

      const result = await trustCommand.execute(["level", "read"], mockSession);

      expect(result).toBe(false);
    });
  });

  describe("revoke subcommand", () => {
    it("revokes trust when confirmed", async () => {
      mockTrustStore.isTrusted.mockReturnValue(true);
      vi.mocked(p.confirm).mockResolvedValue(true);

      const result = await trustCommand.execute(["revoke"], mockSession);

      expect(result).toBe(false);
      expect(mockTrustStore.removeTrust).toHaveBeenCalledWith("/test/project");
    });

    it("shows info when project not trusted", async () => {
      mockTrustStore.isTrusted.mockReturnValue(false);

      const result = await trustCommand.execute(["revoke"], mockSession);

      expect(result).toBe(false);
      expect(p.log.info).toHaveBeenCalled();
      expect(mockTrustStore.removeTrust).not.toHaveBeenCalled();
    });

    it("cancels when user declines confirmation", async () => {
      mockTrustStore.isTrusted.mockReturnValue(true);
      vi.mocked(p.confirm).mockResolvedValue(false);

      const result = await trustCommand.execute(["revoke"], mockSession);

      expect(result).toBe(false);
      expect(mockTrustStore.removeTrust).not.toHaveBeenCalled();
    });

    it("handles removeTrust returning false", async () => {
      mockTrustStore.isTrusted.mockReturnValue(true);
      vi.mocked(p.confirm).mockResolvedValue(true);
      mockTrustStore.removeTrust.mockResolvedValue(false);

      const result = await trustCommand.execute(["revoke"], mockSession);
      expect(result).toBe(false);
    });

    it("handles removeTrust error", async () => {
      mockTrustStore.isTrusted.mockReturnValue(true);
      vi.mocked(p.confirm).mockResolvedValue(true);
      mockTrustStore.removeTrust.mockRejectedValueOnce(new Error("Remove failed"));

      const result = await trustCommand.execute(["revoke"], mockSession);
      expect(result).toBe(false);
    });
  });

  describe("list subcommand", () => {
    it("shows message when no trusted projects", async () => {
      mockTrustStore.list.mockReturnValue([]);

      const result = await trustCommand.execute(["list"], mockSession);

      expect(result).toBe(false);
      expect(p.outro).toHaveBeenCalledWith("No trusted projects");
    });

    it("lists trusted projects", async () => {
      mockTrustStore.list.mockReturnValue([
        {
          path: "/project/a",
          approvalLevel: "full",
          approvedAt: Date.now(),
          lastAccessed: Date.now(),
          toolsTrusted: [],
        },
        {
          path: "/very/long/path/that/exceeds/fifty/characters/in/total/to/test/truncation",
          approvalLevel: "read",
          approvedAt: Date.now(),
          lastAccessed: Date.now(),
          toolsTrusted: [],
        },
      ]);

      const result = await trustCommand.execute(["list"], mockSession);

      expect(result).toBe(false);
    });
  });

  describe("unknown subcommand", () => {
    it("shows error for unknown subcommand", async () => {
      const result = await trustCommand.execute(["foobar"], mockSession);

      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("catches non-Error thrown from subcommand", async () => {
      mockTrustStore.init.mockResolvedValue(undefined);
      mockTrustStore.isTrusted.mockImplementation(() => {
        throw "string error";
      });

      const result = await trustCommand.execute(["status"], mockSession);

      expect(result).toBe(false);
      expect(p.log.error).toHaveBeenCalledWith("Unknown error");
    });
  });
});
