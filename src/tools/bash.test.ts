/**
 * Tests for bash tools
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn().mockImplementation((cmd: string, options?: Record<string, unknown>) => {
    // For background execution (sync call with detached)
    if (typeof options === "object" && options?.detached) {
      const mockSubprocess = {
        pid: 12345,
        unref: vi.fn(),
      };
      return mockSubprocess;
    }

    // For async calls (returns promise)
    if (cmd === "which" || cmd === "where") {
      return Promise.resolve({ exitCode: 0, stdout: "/usr/bin/node", stderr: "" });
    }
    if (typeof options === "object" && options?.shell) {
      // Shell command via bash_exec
      return Promise.resolve({ exitCode: 0, stdout: "command output", stderr: "" });
    }
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }),
}));

describe("bashExecTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute command and return result", async () => {
    const { bashExecTool } = await import("./bash.js");

    const result = await bashExecTool.execute({
      command: "echo 'hello'",
    });

    expect(result.stdout).toBeDefined();
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it("should use custom working directory", async () => {
    const { execa } = await import("execa");
    const { bashExecTool } = await import("./bash.js");

    await bashExecTool.execute({
      command: "ls",
      cwd: "/tmp",
    });

    expect(execa).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: "/tmp" })
    );
  });

  it("should block dangerous commands - rm -rf /", async () => {
    const { bashExecTool } = await import("./bash.js");

    await expect(
      bashExecTool.execute({ command: "rm -rf /" })
    ).rejects.toThrow(/dangerous command/i);
  });

  it("should block dangerous commands - sudo rm -rf", async () => {
    const { bashExecTool } = await import("./bash.js");

    await expect(
      bashExecTool.execute({ command: "sudo rm -rf something" })
    ).rejects.toThrow(/dangerous command/i);
  });

  it("should block dangerous commands - dd to device", async () => {
    const { bashExecTool } = await import("./bash.js");

    await expect(
      bashExecTool.execute({ command: "dd if=/dev/zero of=/dev/sda" })
    ).rejects.toThrow(/dangerous command/i);
  });

  it("should pass custom environment variables", async () => {
    const { execa } = await import("execa");
    const { bashExecTool } = await import("./bash.js");

    await bashExecTool.execute({
      command: "echo $MY_VAR",
      env: { MY_VAR: "test-value" },
    });

    expect(execa).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        env: expect.objectContaining({ MY_VAR: "test-value" }),
      })
    );
  });

  it("should respect timeout setting", async () => {
    const { execa } = await import("execa");
    const { bashExecTool } = await import("./bash.js");

    await bashExecTool.execute({
      command: "sleep 1",
      timeout: 5000,
    });

    expect(execa).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 5000 })
    );
  });
});

describe("bashBackgroundTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute command in background", async () => {
    const { bashBackgroundTool } = await import("./bash.js");

    const result = await bashBackgroundTool.execute({
      command: "sleep 10",
    });

    expect(result.pid).toBeDefined();
    expect(result.command).toBe("sleep 10");
  });

  it("should block dangerous commands", async () => {
    const { bashBackgroundTool } = await import("./bash.js");

    await expect(
      bashBackgroundTool.execute({ command: "rm -rf /" })
    ).rejects.toThrow(/dangerous command/i);
  });
});

describe("commandExistsTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true for existing command", async () => {
    const { commandExistsTool } = await import("./bash.js");

    const result = await commandExistsTool.execute({ command: "node" });

    expect(result.exists).toBe(true);
    expect(result.path).toBeDefined();
  });

  it("should return false for non-existing command", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" } as any);

    const { commandExistsTool } = await import("./bash.js");

    const result = await commandExistsTool.execute({ command: "nonexistentcommand" });

    expect(result.exists).toBe(false);
  });
});

describe("getEnvTool", () => {
  it("should return environment variable value", async () => {
    const { getEnvTool } = await import("./bash.js");

    const result = await getEnvTool.execute({ name: "PATH" });

    expect(result.exists).toBe(true);
    expect(result.value).not.toBeNull();
  });

  it("should return null for non-existing variable", async () => {
    const { getEnvTool } = await import("./bash.js");

    const result = await getEnvTool.execute({ name: "NONEXISTENT_VAR_12345" });

    expect(result.exists).toBe(false);
    expect(result.value).toBeNull();
  });
});

describe("bashTools", () => {
  it("should export all bash tools", async () => {
    const { bashTools } = await import("./bash.js");

    expect(bashTools).toBeDefined();
    expect(bashTools.length).toBe(4);
    expect(bashTools.some((t) => t.name === "bash_exec")).toBe(true);
    expect(bashTools.some((t) => t.name === "bash_background")).toBe(true);
    expect(bashTools.some((t) => t.name === "command_exists")).toBe(true);
    expect(bashTools.some((t) => t.name === "get_env")).toBe(true);
  });
});
