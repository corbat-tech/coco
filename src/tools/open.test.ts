import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execa
const mockExeca = vi.fn().mockResolvedValue({
  stdout: "",
  stderr: "",
  exitCode: 0,
});

vi.mock("execa", () => ({
  execa: mockExeca,
}));

// Mock fs
const mockAccess = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  default: {
    access: (...args: unknown[]) => mockAccess(...args),
    constants: { X_OK: 1 },
  },
}));

describe("openFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("should have correct metadata", async () => {
    const { openFileTool } = await import("./open.js");
    expect(openFileTool.name).toBe("open_file");
    expect(openFileTool.category).toBe("bash");
    expect(openFileTool.description).toContain("Open a file");
  });

  it("should validate required parameters", async () => {
    const { openFileTool } = await import("./open.js");
    const result = openFileTool.parameters.safeParse({});
    expect(result.success).toBe(false);

    const valid = openFileTool.parameters.safeParse({ path: "test.html" });
    expect(valid.success).toBe(true);
  });

  it("should default mode to open and args to empty", async () => {
    const { openFileTool } = await import("./open.js");
    const parsed = openFileTool.parameters.parse({ path: "test.html" });
    expect(parsed.mode).toBe("open");
    expect(parsed.args).toEqual([]);
  });

  describe("open mode", () => {
    it("should use 'open' on macOS", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({ path: "/tmp/test.html" });

      expect(result.action).toBe("opened");
      expect(result.resolvedCommand).toBe("open");
      expect(mockExeca).toHaveBeenCalledWith("open", ["/tmp/test.html"], expect.any(Object));

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should resolve relative paths", async () => {
      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({
        path: "docs/index.html",
        cwd: "/tmp/project",
      });

      expect(result.action).toBe("opened");
      expect(result.path).toBe("/tmp/project/docs/index.html");
    });

    it("should throw if file does not exist", async () => {
      mockAccess.mockRejectedValueOnce(new Error("ENOENT"));

      const { openFileTool } = await import("./open.js");
      await expect(openFileTool.execute({ path: "/tmp/nonexistent.html" })).rejects.toThrow(/not found/i);
    });

    it("should return duration", async () => {
      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({ path: "/tmp/test.html" });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("exec mode", () => {
    it("should detect .py files and use python3", async () => {
      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({
        path: "/tmp/script.py",
        mode: "exec",
      });

      expect(result.action).toBe("executed");
      expect(result.resolvedCommand).toBe("python3");
      expect(mockExeca).toHaveBeenCalledWith(
        "python3",
        ["/tmp/script.py"],
        expect.objectContaining({ reject: false }),
      );
    });

    it("should detect .sh files and use bash", async () => {
      const { openFileTool } = await import("./open.js");
      await openFileTool.execute({ path: "/tmp/setup.sh", mode: "exec" });

      expect(mockExeca).toHaveBeenCalledWith(
        "bash",
        expect.arrayContaining(["/tmp/setup.sh"]),
        expect.any(Object),
      );
    });

    it("should detect .js files and use node", async () => {
      const { openFileTool } = await import("./open.js");
      await openFileTool.execute({ path: "/tmp/app.js", mode: "exec" });

      expect(mockExeca).toHaveBeenCalledWith("node", ["/tmp/app.js"], expect.any(Object));
    });

    it("should detect .ts files and use npx tsx", async () => {
      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({ path: "/tmp/app.ts", mode: "exec" });

      expect(result.resolvedCommand).toBe("npx tsx");
      expect(mockExeca).toHaveBeenCalledWith("npx", ["tsx", "/tmp/app.ts"], expect.any(Object));
    });

    it("should pass args to the executed script", async () => {
      const { openFileTool } = await import("./open.js");
      await openFileTool.execute({
        path: "/tmp/deploy.py",
        mode: "exec",
        args: ["--env", "staging"],
      });

      expect(mockExeca).toHaveBeenCalledWith(
        "python3",
        ["/tmp/deploy.py", "--env", "staging"],
        expect.any(Object),
      );
    });

    it("should execute binaries with +x permissions directly", async () => {
      // File has no known extension but is executable
      mockAccess.mockImplementation((_path: unknown, mode?: unknown) => {
        // X_OK check succeeds
        if (mode === 1) return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({
        path: "/tmp/mybinary",
        mode: "exec",
      });

      expect(result.action).toBe("executed");
      expect(result.resolvedCommand).toBe("/tmp/mybinary");
    });

    it("should return stdout, stderr, and exitCode", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "Hello World",
        stderr: "Warning: deprecated",
        exitCode: 0,
      });

      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({
        path: "/tmp/script.py",
        mode: "exec",
      });

      expect(result.stdout).toBe("Hello World");
      expect(result.stderr).toBe("Warning: deprecated");
      expect(result.exitCode).toBe(0);
    });

    it("should handle non-zero exit codes", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: something failed",
        exitCode: 1,
      });

      const { openFileTool } = await import("./open.js");
      const result = await openFileTool.execute({
        path: "/tmp/script.sh",
        mode: "exec",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("Error: something failed");
    });

    it("should throw for files without interpreter and without +x", async () => {
      // Make X_OK check fail
      mockAccess.mockImplementation((_path: unknown, mode?: unknown) => {
        if (mode === 1) return Promise.reject(new Error("EACCES"));
        return Promise.resolve(undefined);
      });

      const { openFileTool } = await import("./open.js");
      await expect(
        openFileTool.execute({ path: "/tmp/data.xyz", mode: "exec" }),
      ).rejects.toThrow(/no known interpreter/i);
    });
  });

  describe("security", () => {
    it("should block system paths", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(openFileTool.execute({ path: "/etc/passwd" })).rejects.toThrow(/system path.*not allowed/i);
    });

    it("should block /proc path", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(openFileTool.execute({ path: "/proc/self/environ" })).rejects.toThrow(/not allowed/i);
    });

    it("should block null bytes in path", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(openFileTool.execute({ path: "/tmp/file\0.html" })).rejects.toThrow(/invalid/i);
    });

    it("should block execution of .env files", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(
        openFileTool.execute({ path: "/tmp/project/.env", mode: "exec" }),
      ).rejects.toThrow(/sensitive file.*blocked/i);
    });

    it("should block execution of .env.local files", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(
        openFileTool.execute({ path: "/tmp/.env.local", mode: "exec" }),
      ).rejects.toThrow(/sensitive file.*blocked/i);
    });

    it("should block execution of .pem files", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(
        openFileTool.execute({ path: "/tmp/cert.pem", mode: "exec" }),
      ).rejects.toThrow(/sensitive file.*blocked/i);
    });

    it("should block dangerous argument patterns", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(
        openFileTool.execute({
          path: "/tmp/script.sh",
          mode: "exec",
          args: ["$(rm -rf /)"],
        }),
      ).rejects.toThrow(/dangerous/i);
    });

    it("should block eval in arguments", async () => {
      const { openFileTool } = await import("./open.js");
      await expect(
        openFileTool.execute({
          path: "/tmp/script.sh",
          mode: "exec",
          args: ["eval bad-command"],
        }),
      ).rejects.toThrow(/dangerous/i);
    });
  });
});

describe("openTools", () => {
  it("should export the openFileTool in the array", async () => {
    const { openTools, openFileTool } = await import("./open.js");
    expect(openTools).toContain(openFileTool);
    expect(openTools).toHaveLength(1);
  });
});
