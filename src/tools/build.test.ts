/**
 * Tests for build tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BuildResult } from "./build.js";

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// Mock fs
vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
  },
}));

import { runScriptTool, installDepsTool, makeTool, tscTool, buildTools } from "./build.js";
import { execa } from "execa";
import fs from "node:fs/promises";

function mockExecaResult(
  overrides: Partial<{ stdout: string; stderr: string; exitCode: number }> = {},
) {
  return {
    stdout: overrides.stdout ?? "",
    stderr: overrides.stderr ?? "",
    exitCode: overrides.exitCode ?? 0,
    ...overrides,
  };
}

/**
 * Mock streaming subprocess for execa with buffer: false
 */
function mockStreamingSubprocess(
  stdout: string = "",
  stderr: string = "",
  exitCode: number = 0,
) {
  const mockStdout = {
    on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
      if (event === "data" && stdout) {
        setTimeout(() => handler(Buffer.from(stdout)), 0);
      }
    }),
  };

  const mockStderr = {
    on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
      if (event === "data" && stderr) {
        setTimeout(() => handler(Buffer.from(stderr)), 0);
      }
    }),
  };

  const subprocess = {
    stdout: mockStdout,
    stderr: mockStderr,
    then: (resolve: any) => {
      setTimeout(() => resolve({ exitCode }), 10);
      return subprocess;
    },
    catch: () => subprocess,
  };

  return subprocess;
}

describe("Build Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pnpm-lock.yaml exists (detect pnpm)
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
  });

  describe("buildTools export", () => {
    it("should export all 4 build tools", () => {
      expect(buildTools).toHaveLength(4);
    });
  });

  describe("runScriptTool", () => {
    it("should have correct metadata", () => {
      expect(runScriptTool.name).toBe("run_script");
      expect(runScriptTool.category).toBe("build");
    });

    it("should run a script successfully", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess("Build complete") as any);

      const result = (await runScriptTool.execute({ script: "build" })) as BuildResult;

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Build complete");
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should detect package manager from lockfile", async () => {
      // Make pnpm-lock.yaml accessible
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).includes("pnpm-lock.yaml")) return;
        throw new Error("ENOENT");
      });
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await runScriptTool.execute({ script: "build" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("pnpm", ["run", "build"], expect.any(Object));
    });

    it("should use provided package manager", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await runScriptTool.execute({ script: "test", packageManager: "yarn" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("yarn", ["run", "test"], expect.any(Object));
    });

    it("should pass additional args", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await runScriptTool.execute({ script: "test", packageManager: "npm", args: ["--coverage"] });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "npm",
        ["run", "test", "--", "--coverage"],
        expect.any(Object),
      );
    });

    it("should handle failed scripts", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess("", "Error", 1) as any);

      const result = (await runScriptTool.execute({
        script: "build",
        packageManager: "npm",
      })) as BuildResult;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should handle timeout", async () => {
      vi.mocked(execa).mockRejectedValue(Object.assign(new Error("timeout"), { timedOut: true }));

      await expect(
        runScriptTool.execute({ script: "build", packageManager: "npm" }),
      ).rejects.toThrow("timed out");
    });

    it("should handle execution errors", async () => {
      vi.mocked(execa).mockRejectedValue(new Error("Command not found"));

      await expect(
        runScriptTool.execute({ script: "build", packageManager: "npm" }),
      ).rejects.toThrow("Failed to run script");
    });

    it("should handle non-Error thrown values", async () => {
      vi.mocked(execa).mockRejectedValue("string error");

      await expect(
        runScriptTool.execute({ script: "build", packageManager: "npm" }),
      ).rejects.toThrow("Failed to run script");
    });

    it("should default to npm when no lockfile found", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await runScriptTool.execute({ script: "build" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("npm", expect.any(Array), expect.any(Object));
    });

    it("should detect yarn from lockfile", async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).includes("yarn.lock")) return;
        throw new Error("ENOENT");
      });
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await runScriptTool.execute({ script: "build" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("yarn", expect.any(Array), expect.any(Object));
    });

    it("should detect bun from lockfile", async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).includes("bun.lockb")) return;
        throw new Error("ENOENT");
      });
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await runScriptTool.execute({ script: "build" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("bun", expect.any(Array), expect.any(Object));
    });

    it("should truncate long output", async () => {
      const longOutput = "x".repeat(100000);

      // Mock streaming subprocess
      const mockStdout = {
        on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
          if (event === "data") {
            // Emit the long output as a chunk
            setTimeout(() => handler(Buffer.from(longOutput)), 0);
          }
        }),
      };

      const mockStderr = {
        on: vi.fn(),
      };

      const mockSubprocess = {
        stdout: mockStdout,
        stderr: mockStderr,
        then: (resolve: any) => {
          setTimeout(() => resolve({ exitCode: 0 }), 10);
          return mockSubprocess;
        },
        catch: () => mockSubprocess,
      };

      vi.mocked(execa).mockReturnValue(mockSubprocess as any);

      const result = (await runScriptTool.execute({
        script: "build",
        packageManager: "npm",
      })) as BuildResult;

      expect(result.stdout.length).toBeLessThan(longOutput.length);
      expect(result.stdout).toContain("[Output truncated");
    });
  });

  describe("installDepsTool", () => {
    it("should have correct metadata", () => {
      expect(installDepsTool.name).toBe("install_deps");
      expect(installDepsTool.category).toBe("build");
    });

    it("should install all dependencies", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess("Installed") as any);

      const result = (await installDepsTool.execute({ packageManager: "npm" })) as BuildResult;

      expect(result.success).toBe(true);
      expect(vi.mocked(execa)).toHaveBeenCalledWith("npm", ["install"], expect.any(Object));
    });

    it("should install specific packages with pnpm", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "pnpm", packages: ["lodash", "zod"] });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "pnpm",
        ["add", "lodash", "zod"],
        expect.any(Object),
      );
    });

    it("should install dev dependencies with pnpm", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "pnpm", packages: ["vitest"], dev: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "pnpm",
        ["add", "vitest", "-D"],
        expect.any(Object),
      );
    });

    it("should install with yarn", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "yarn", packages: ["lodash"], dev: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "yarn",
        ["add", "lodash", "--dev"],
        expect.any(Object),
      );
    });

    it("should install with bun", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "bun", packages: ["lodash"], dev: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "bun",
        ["add", "lodash", "--dev"],
        expect.any(Object),
      );
    });

    it("should install with npm and --save-dev", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "npm", packages: ["vitest"], dev: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "npm",
        ["install", "vitest", "--save-dev"],
        expect.any(Object),
      );
    });

    it("should use frozen lockfile with pnpm", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "pnpm", frozen: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "pnpm",
        ["install", "--frozen-lockfile"],
        expect.any(Object),
      );
    });

    it("should use frozen lockfile with yarn", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "yarn", frozen: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "yarn",
        ["install", "--frozen-lockfile"],
        expect.any(Object),
      );
    });

    it("should use frozen lockfile with bun", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "bun", frozen: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "bun",
        ["install", "--frozen-lockfile"],
        expect.any(Object),
      );
    });

    it("should use ci for npm frozen", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await installDepsTool.execute({ packageManager: "npm", frozen: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("npm", ["ci"], expect.any(Object));
    });

    it("should handle timeout", async () => {
      vi.mocked(execa).mockRejectedValue(Object.assign(new Error("timeout"), { timedOut: true }));

      await expect(installDepsTool.execute({ packageManager: "npm" })).rejects.toThrow("timed out");
    });

    it("should handle errors", async () => {
      vi.mocked(execa).mockRejectedValue(new Error("Network error"));

      await expect(installDepsTool.execute({ packageManager: "npm" })).rejects.toThrow(
        "Failed to install",
      );
    });
  });

  describe("makeTool", () => {
    it("should have correct metadata", () => {
      expect(makeTool.name).toBe("make");
      expect(makeTool.category).toBe("build");
    });

    it("should run default target", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess("Built") as any);

      const result = (await makeTool.execute({})) as BuildResult;

      expect(result.success).toBe(true);
      expect(vi.mocked(execa)).toHaveBeenCalledWith("make", [], expect.any(Object));
    });

    it("should run specific target", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await makeTool.execute({ target: "build" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("make", ["build"], expect.any(Object));
    });

    it("should split multiple targets", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await makeTool.execute({ target: "clean build" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("make", ["clean", "build"], expect.any(Object));
    });

    it("should pass additional args", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await makeTool.execute({ target: "test", args: ["VERBOSE=1"] });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "make",
        ["test", "VERBOSE=1"],
        expect.any(Object),
      );
    });

    it("should throw when no Makefile found", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

      await expect(makeTool.execute({})).rejects.toThrow("No Makefile found");
    });

    it("should handle timeout", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockRejectedValue(Object.assign(new Error("timeout"), { timedOut: true }));

      await expect(makeTool.execute({})).rejects.toThrow("timed out");
    });

    it("should handle execution errors", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(execa).mockRejectedValue(new Error("make failed"));

      await expect(makeTool.execute({})).rejects.toThrow("Make failed");
    });
  });

  describe("tscTool", () => {
    it("should have correct metadata", () => {
      expect(tscTool.name).toBe("tsc");
      expect(tscTool.category).toBe("build");
    });

    it("should run tsc with no options", async () => {
      vi.mocked(execa).mockResolvedValue(mockExecaResult({ stdout: "No errors" }) as any);

      const result = (await tscTool.execute({})) as BuildResult;

      expect(result.success).toBe(true);
      expect(vi.mocked(execa)).toHaveBeenCalledWith("npx", ["tsc"], expect.any(Object));
    });

    it("should run with --noEmit", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await tscTool.execute({ noEmit: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("npx", ["tsc", "--noEmit"], expect.any(Object));
    });

    it("should run with custom project", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await tscTool.execute({ project: "tsconfig.build.json" });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "npx",
        ["tsc", "--project", "tsconfig.build.json"],
        expect.any(Object),
      );
    });

    it("should run in watch mode", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await tscTool.execute({ watch: true });

      expect(vi.mocked(execa)).toHaveBeenCalledWith("npx", ["tsc", "--watch"], expect.any(Object));
    });

    it("should pass additional args", async () => {
      vi.mocked(execa).mockReturnValue(mockStreamingSubprocess() as any);

      await tscTool.execute({ args: ["--declaration", "--emitDeclarationOnly"] });

      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        "npx",
        ["tsc", "--declaration", "--emitDeclarationOnly"],
        expect.any(Object),
      );
    });

    it("should handle timeout", async () => {
      vi.mocked(execa).mockRejectedValue(Object.assign(new Error("timeout"), { timedOut: true }));

      await expect(tscTool.execute({})).rejects.toThrow("timed out");
    });

    it("should handle errors", async () => {
      vi.mocked(execa).mockRejectedValue(new Error("tsc not found"));

      await expect(tscTool.execute({})).rejects.toThrow("TypeScript compile failed");
    });
  });
});
