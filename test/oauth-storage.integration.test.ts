import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";
import type * as FileSystem from "node:fs/promises";
import { saveTokens, type OAuthTokens } from "../src/auth/oauth.js";

const fixture = vi.hoisted(() => ({
  directory: "",
  failPartialWrite: false,
  failRename: false,
}));

vi.mock("node:fs/promises", async (importActual) => {
  const fs = await importActual<typeof FileSystem>();
  const path = await import("node:path");
  // The production path is only compared as text. No operation reaches HOME.
  const expectedDirectory = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".coco",
    "tokens",
  );
  function redirect(source: unknown): string {
    if (!fixture.directory || typeof source !== "string") {
      throw new Error("OAuth storage test received an unexpected filesystem path");
    }
    if (source === expectedDirectory) return fixture.directory;
    const relative = path.relative(expectedDirectory, source);
    if (
      relative !== "storage-fixture.json" &&
      !/^storage-fixture\.json\.[0-9a-f-]{36}\.tmp$/.test(relative)
    ) {
      throw new Error("OAuth storage test rejected a path outside its credential fixture");
    }
    return path.join(fixture.directory, relative);
  }
  return {
    mkdir: (source: string, options: Parameters<typeof fs.mkdir>[1]) =>
      fs.mkdir(redirect(source), options),
    writeFile: async (
      source: string,
      data: string,
      options: Parameters<typeof fs.writeFile>[2],
    ) => {
      const destination = redirect(source);
      if (fixture.failPartialWrite) {
        await fs.writeFile(destination, data.slice(0, 8), options);
        throw Object.assign(new Error("Injected partial write failure"), { code: "ENOSPC" });
      }
      await fs.writeFile(destination, data, options);
    },
    rename: async (source: string, destination: string) => {
      const from = redirect(source);
      const to = redirect(destination);
      if (fixture.failRename) {
        throw Object.assign(new Error("Injected rename failure"), { code: "EACCES" });
      }
      await fs.rename(from, to);
    },
    unlink: (source: string) => fs.unlink(redirect(source)),
  };
});

const realFs = await vi.importActual<typeof FileSystem>("node:fs/promises");
let temporaryRoot: string;
const oldTokens: OAuthTokens = {
  accessToken: "old-fixture-access",
  refreshToken: "old-fixture-refresh",
  tokenType: "Bearer",
};
const rotatedTokens: OAuthTokens = {
  accessToken: "rotated-fixture-access",
  refreshToken: "rotated-fixture-refresh",
  tokenType: "Bearer",
  expiresAt: 1234567890000,
};

beforeEach(async () => {
  temporaryRoot = await realFs.mkdtemp(path.join(tmpdir(), "coco-oauth-storage-"));
  fixture.directory = path.join(temporaryRoot, "tokens");
  fixture.failPartialWrite = false;
  fixture.failRename = false;
});

afterEach(async () => {
  fixture.directory = "";
  await realFs.rm(temporaryRoot, { recursive: true, force: true });
});

async function seedExistingTokens(): Promise<string> {
  await realFs.mkdir(fixture.directory, { mode: 0o700 });
  const original = JSON.stringify(oldTokens);
  await realFs.writeFile(path.join(fixture.directory, "storage-fixture.json"), original, {
    mode: 0o600,
  });
  return original;
}

async function expectOnlyCredentialFile(): Promise<void> {
  expect(await realFs.readdir(fixture.directory)).toEqual(["storage-fixture.json"]);
}

describe("OAuth token storage on a real temporary filesystem", () => {
  it("persists token data with private POSIX permissions and no temporary remnants", async () => {
    await saveTokens("storage-fixture", rotatedTokens);
    const filename = path.join(fixture.directory, "storage-fixture.json");
    expect(JSON.parse(await realFs.readFile(filename, "utf8"))).toEqual(rotatedTokens);
    await expectOnlyCredentialFile();
    if (process.platform !== "win32") {
      expect((await realFs.stat(filename)).mode & 0o777).toBe(0o600);
      expect((await realFs.stat(fixture.directory)).mode & 0o777).toBe(0o700);
    }
  });

  it("replaces an existing credential file with the complete rotated token", async () => {
    await seedExistingTokens();
    await saveTokens("storage-fixture", rotatedTokens);
    expect(
      JSON.parse(
        await realFs.readFile(path.join(fixture.directory, "storage-fixture.json"), "utf8"),
      ),
    ).toEqual(rotatedTokens);
    await expectOnlyCredentialFile();
  });

  it("preserves existing credentials and removes partial output when writing fails", async () => {
    const original = await seedExistingTokens();
    fixture.failPartialWrite = true;
    await expect(saveTokens("storage-fixture", rotatedTokens)).rejects.toMatchObject({
      code: "ENOSPC",
    });
    expect(
      await realFs.readFile(path.join(fixture.directory, "storage-fixture.json"), "utf8"),
    ).toBe(original);
    await expectOnlyCredentialFile();
  });

  it("preserves existing credentials and removes staged output when rename fails", async () => {
    const original = await seedExistingTokens();
    fixture.failRename = true;
    await expect(saveTokens("storage-fixture", rotatedTokens)).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(
      await realFs.readFile(path.join(fixture.directory, "storage-fixture.json"), "utf8"),
    ).toBe(original);
    await expectOnlyCredentialFile();
  });
});
