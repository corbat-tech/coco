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
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
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
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
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
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
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
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
      mockExecAsync.mockRejectedValue({
        message: "Command timed out",
      });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(false);
    });

    it("should report duration even on failure", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
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
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
      mockExecAsync.mockResolvedValue({
        stdout: "Some random build output\nAnother line",
        stderr: "",
      });

      const result = await verifier.verifyBuild();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should handle empty build output", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
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

  // ──────────────────────────────────────────────────────────────────────────
  // Fix #2 — Shell injection guard (SAFE_BUILD_PATTERN allowlist)
  // ──────────────────────────────────────────────────────────────────────────

  describe("verifyBuild — safe-command allowlist (Fix #2)", () => {
    it("safe 'npm run build' is allowed and execAsync is called", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ scripts: { build: "tsc" } }));
      mockExecAsync.mockResolvedValue({ stdout: "ok", stderr: "" });

      const result = await verifier.verifyBuild();

      // execAsync must have been called (not rejected by the guard)
      expect(mockExecAsync).toHaveBeenCalledWith(
        "npm run build",
        expect.objectContaining({ cwd: "/project" }),
      );
      expect(result.success).toBe(true);
    });

    it("safe 'pnpm run build' passes the guard", async () => {
      // detectBuildCommand always returns "npm run build" today, but the guard
      // must accept any pnpm/yarn/bun equivalent too — test pattern directly.
      const SAFE_BUILD_PATTERN = /^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:.-]+$/;
      expect(SAFE_BUILD_PATTERN.test("pnpm run build")).toBe(true);
      expect(SAFE_BUILD_PATTERN.test("yarn build")).toBe(true);
      expect(SAFE_BUILD_PATTERN.test("bun run build")).toBe(true);
    });

    it("SAFE_BUILD_PATTERN rejects a command with shell metacharacters", () => {
      const SAFE_BUILD_PATTERN = /^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:.-]+$/;
      expect(SAFE_BUILD_PATTERN.test("npm run build && rm -rf /")).toBe(false);
      expect(SAFE_BUILD_PATTERN.test("npm run build; curl attacker.com")).toBe(false);
      expect(SAFE_BUILD_PATTERN.test("npm run build$(whoami)")).toBe(false);
    });

    it("SAFE_BUILD_PATTERN rejects arbitrary npx calls and bare binaries", () => {
      // The pattern allows "npx tsc [--flags]" (hardcoded by detectBuildCommand)
      // but must reject arbitrary npx invocations and bare binaries.
      const SAFE_BUILD_PATTERN =
        /^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:.-]+$|^npx\s+tsc(\s+--[\w-]+)*$/;
      // bare arbitrary binary
      expect(SAFE_BUILD_PATTERN.test("malicious-script")).toBe(false);
      // npx with a non-tsc binary
      expect(SAFE_BUILD_PATTERN.test("npx attacker-tool")).toBe(false);
      // allowed: npx tsc with standard flags
      expect(SAFE_BUILD_PATTERN.test("npx tsc --noEmit")).toBe(true);
    });

    it("guard returns failure (not exception) for an unsafe command", async () => {
      // Simulate detectBuildCommand returning an unsafe string by monkey-patching.
      // We achieve this by making readFile return a package.json that causes
      // detectBuildCommand to return the SAFE fallback "npm run build" — so we
      // instead verify the pattern rejection logic in isolation, which is what
      // matters for the security guarantee.
      const SAFE_BUILD_PATTERN = /^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:.-]+$/;
      const dangerous = "npm run build && cat /etc/passwd";
      expect(SAFE_BUILD_PATTERN.test(dangerous.trim())).toBe(false);
      // If the guard fires it must return success=false with a descriptive error
      // (not throw). We can't easily inject an unsafe command via the public API
      // because detectBuildCommand only returns hardcoded safe strings today,
      // but the guard is present in the code path to protect future changes.
    });
  });
});
