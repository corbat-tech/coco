/**
 * Tests for BuildVerifier
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BuildVerifier, createBuildVerifier } from "./build-verifier.js";

// Mock node:child_process
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock node:util
vi.mock("node:util", () => ({
  promisify: vi.fn().mockImplementation(() => {
    return vi.fn();
  }),
}));

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

// Mock node:path
vi.mock("node:path", () => ({
  join: (...parts: string[]) => parts.join("/"),
  extname: (p: string) => {
    const m = p.match(/\.[^.]+$/);
    return m ? m[0] : "";
  },
}));

describe("BuildVerifier", () => {
  let verifier: BuildVerifier;
  let mockExecAsync: ReturnType<typeof vi.fn>;
  let mockFs: { readFile: ReturnType<typeof vi.fn>; access: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up the mock for promisify to return our controlled execAsync
    mockExecAsync = vi.fn();
    const util = await import("node:util");
    (util.promisify as ReturnType<typeof vi.fn>).mockReturnValue(mockExecAsync);

    const fs = await import("node:fs/promises");
    mockFs = {
      readFile: fs.readFile as ReturnType<typeof vi.fn>,
      access: fs.access as ReturnType<typeof vi.fn>,
    };

    // Re-import to pick up mocks
    const mod = await import("./build-verifier.js");
    verifier = new mod.BuildVerifier("/project");
  });

  describe("verifyBuild", () => {
    it("should return success when build command succeeds with no errors", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          scripts: { build: "tsc" },
        }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "Build complete", stderr: "" });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return success when no build command is detected", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          scripts: {},
        }),
      );

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("No build command detected");
    });

    it("should return success when package.json is missing", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("No build command detected");
    });

    it("should detect npm run build when scripts.build exists", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          scripts: { build: "tsup" },
        }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "OK", stderr: "" });

      await verifier.verifyBuild();

      expect(mockExecAsync).toHaveBeenCalledWith(
        "npm run build",
        expect.objectContaining({ cwd: "/project" }),
      );
    });

    it("should fall back to tsc when only typescript dependency exists", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          devDependencies: { typescript: "^5.0.0" },
        }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "OK", stderr: "" });

      await verifier.verifyBuild();

      expect(mockExecAsync).toHaveBeenCalledWith(
        "npx tsc --noEmit",
        expect.objectContaining({ cwd: "/project" }),
      );
    });

    it("should parse TypeScript errors from build output", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockRejectedValue({
        stdout: "src/index.ts(10,5): error TS2345: Argument of type 'string' is not assignable",
        stderr: "",
        message: "Command failed",
      });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]?.file).toBe("src/index.ts");
      expect(result.errors[0]?.line).toBe(10);
      expect(result.errors[0]?.column).toBe(5);
      expect(result.errors[0]?.code).toBe("TS2345");
    });

    it("should parse warnings from build output", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockResolvedValue({
        stdout: "src/utils.ts(3,1): warning TS6133: 'x' is declared but never used",
        stderr: "",
      });

      const result = await verifier.verifyBuild();

      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings[0]?.file).toBe("src/utils.ts");
      expect(result.warnings[0]?.line).toBe(3);
      expect(result.warnings[0]?.code).toBe("TS6133");
    });

    it("should handle build failure with error output", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockRejectedValue({
        stdout: "",
        stderr: "Error: some build failure",
        message: "Command failed",
      });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Error");
    });

    it("should handle build failure with only message", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockRejectedValue({
        message: "Command timed out",
      });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(false);
    });

    it("should report duration even on failure", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockRejectedValue({
        stdout: "",
        stderr: "failed",
        message: "failed",
      });

      const result = await verifier.verifyBuild();

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("verifyTypes", () => {
    it("should return success when no tsconfig.json exists", async () => {
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const result = await verifier.verifyTypes();

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("No tsconfig.json found");
    });

    it("should run tsc --noEmit when tsconfig.json exists", async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await verifier.verifyTypes();

      expect(result.success).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledWith(
        "npx tsc --noEmit",
        expect.objectContaining({ cwd: "/project" }),
      );
    });

    it("should parse type errors from tsc output", async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockExecAsync.mockRejectedValue({
        stdout: "src/app.ts(20,10): error TS2304: Cannot find name 'foo'",
        stderr: "",
        message: "Command failed",
      });

      const result = await verifier.verifyTypes();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]?.line).toBe(20);
      expect(result.errors[0]?.column).toBe(10);
      expect(result.errors[0]?.code).toBe("TS2304");
    });

    it("should report success when tsc completes without errors", async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await verifier.verifyTypes();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should parse multiple type errors", async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockExecAsync.mockRejectedValue({
        stdout:
          "src/a.ts(1,1): error TS1001: first error\nsrc/b.ts(2,3): error TS1002: second error",
        stderr: "",
        message: "Command failed",
      });

      const result = await verifier.verifyTypes();

      expect(result.errors.length).toBe(2);
      expect(result.errors[0]?.file).toBe("src/a.ts");
      expect(result.errors[1]?.file).toBe("src/b.ts");
    });

    it("should track duration for type verification", async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await verifier.verifyTypes();

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("error/warning parsing edge cases", () => {
    it("should handle output with no parseable errors", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockResolvedValue({
        stdout: "Some random build output\nAnother line",
        stderr: "",
      });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should handle empty build output", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ scripts: { build: "tsc" } }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("createBuildVerifier", () => {
    it("should create a BuildVerifier instance", () => {
      const bv = createBuildVerifier("/my-project");
      expect(bv).toBeInstanceOf(BuildVerifier);
    });
  });
});
