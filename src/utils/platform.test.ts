import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("isWSL", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock("node:fs");
  });

  it("returns true when WSL_DISTRO_NAME is set", async () => {
    process.env.WSL_DISTRO_NAME = "Ubuntu";
    delete process.env.WSLENV;
    const { isWSL } = await import("./platform.js");
    expect(isWSL).toBe(true);
  });

  it("returns true when WSLENV is set", async () => {
    delete process.env.WSL_DISTRO_NAME;
    process.env.WSLENV = "PATH/l";
    const { isWSL } = await import("./platform.js");
    expect(isWSL).toBe(true);
  });

  it("returns false when no env vars and /proc/version throws", async () => {
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.WSLENV;
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    }));
    const { isWSL } = await import("./platform.js");
    expect(isWSL).toBe(false);
  });

  it("returns true when /proc/version contains 'microsoft'", async () => {
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.WSLENV;
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => "Linux version 5.15.0 (Microsoft@Microsoft.com)"),
    }));
    const { isWSL } = await import("./platform.js");
    expect(isWSL).toBe(true);
  });

  it("returns false when /proc/version does not contain 'microsoft'", async () => {
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.WSLENV;
    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => "Linux version 6.1.0-debian (debian-kernel@lists.debian.org)"),
    }));
    const { isWSL } = await import("./platform.js");
    expect(isWSL).toBe(false);
  });
});
