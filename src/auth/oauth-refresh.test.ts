import path from "node:path";
import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getValidAccessToken, refreshAccessToken, saveTokens } from "./oauth.js";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
  rename: mocks.rename,
  unlink: mocks.unlink,
}));
const destination = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".coco",
  "tokens",
  "openai.json",
);
const old = {
  accessToken: "fixture-old-access",
  refreshToken: "fixture-old-refresh",
  expiresAt: 1,
  tokenType: "Bearer",
};
const rotated = {
  access_token: "fixture-new-access",
  refresh_token: "fixture-new-refresh",
  expires_in: 3600,
};
let disk: Map<string, string>;
const stored = () => JSON.parse(disk.get(destination)!) as Record<string, unknown>;
function success(data: unknown = rotated) {
  mocks.fetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(data) });
}
function expectOriginal() {
  expect(stored()).toEqual(old);
  expect(mocks.unlink).not.toHaveBeenCalledWith(destination);
}
beforeEach(() => {
  vi.useFakeTimers();
  disk = new Map([[destination, JSON.stringify(old)]]);
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.readFile.mockImplementation(async (file: string) => {
    if (!disk.has(file)) throw Object.assign(new Error("fixture missing"), { code: "ENOENT" });
    return disk.get(file);
  });
  mocks.writeFile.mockImplementation(async (file: string, content: string) => {
    disk.set(file, content);
  });
  mocks.rename.mockImplementation(async (from: string, to: string) => {
    disk.set(to, disk.get(from)!);
    disk.delete(from);
  });
  mocks.unlink.mockImplementation(async (file: string) => {
    disk.delete(file);
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OAuth refresh cancellation preserves stored credentials", () => {
  it("pre-aborted managed refresh does not load or request tokens", async () => {
    const controller = new AbortController();
    const reason = new Error("fixture canceled");
    controller.abort(reason);
    await expect(getValidAccessToken("openai", controller.signal)).rejects.toBe(reason);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expectOriginal();
  });

  it("pre-aborted refresh primitive never fetches", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(refreshAccessToken("openai", old.refreshToken, controller.signal)).rejects.toBe(
      controller.signal.reason,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("checks cancellation after a pending credential read", async () => {
    const controller = new AbortController();
    const reason = new Error("load canceled");
    mocks.readFile.mockImplementation(async () => {
      controller.abort(reason);
      return JSON.stringify(old);
    });
    await expect(getValidAccessToken("openai", controller.signal)).rejects.toBe(reason);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expectOriginal();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["headers", "body"] as const)(
    "canceling pending %s never retries or deletes credentials",
    async (stage) => {
      const controller = new AbortController();
      let owned!: AbortSignal;
      const bodyStarted = vi.fn();
      mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        expect(owned).not.toBe(controller.signal);
        const wait = () =>
          new Promise((_resolve, reject) => {
            owned.addEventListener("abort", () => reject(owned.reason), { once: true });
          });
        return stage === "headers"
          ? wait()
          : Promise.resolve({
              ok: true,
              json: () => {
                bodyStarted();
                return wait();
              },
            });
      });
      const outcome = getValidAccessToken("openai", controller.signal).catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      if (stage === "body") expect(bodyStarted).toHaveBeenCalledOnce();
      const reason = new Error("request canceled");
      controller.abort(reason);
      expect(await outcome).toBe(reason);
      expect(owned.reason).toBe(reason);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(mocks.writeFile).not.toHaveBeenCalled();
      expectOriginal();
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("managed refresh applies a total 30-second deadline", async () => {
    let owned!: AbortSignal;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        owned.addEventListener("abort", () => reject(owned.reason), { once: true }),
      );
    });
    const outcome = getValidAccessToken("openai").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29999);
    expect(owned.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe(owned.reason);
    expect(String(owned.reason)).toMatch(/timeout|timed out/i);
    expectOriginal();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("transient HTTP failure preserves credentials without retry", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "fixture temporary failure",
    });
    await getValidAccessToken("openai").catch(() => null);
    expectOriginal();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    null,
    {},
    { access_token: "" },
    { access_token: "   " },
    { access_token: 42 },
    { ...rotated, refresh_token: "" },
    { ...rotated, refresh_token: 3 },
    { ...rotated, expires_in: 0 },
    { ...rotated, expires_in: -1 },
    { ...rotated, expires_in: NaN },
    { ...rotated, expires_in: Infinity },
    { ...rotated, expires_in: Number.MAX_VALUE },
  ])("malformed response %# cannot overwrite or delete saved credentials", async (data) => {
    success(data);
    const result = await getValidAccessToken("openai").catch(() => null);
    expect(result).toBeNull();
    expectOriginal();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("refresh primitive forwards its signal and defaults token type while retaining refresh token", async () => {
    const controller = new AbortController();
    success({ access_token: "fixture-new-access" });
    await expect(
      refreshAccessToken("openai", old.refreshToken, controller.signal),
    ).resolves.toMatchObject({
      accessToken: "fixture-new-access",
      refreshToken: old.refreshToken,
      tokenType: "Bearer",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("persists a completed rotation before propagating abort during JSON completion", async () => {
    const controller = new AbortController();
    const reason = new Error("rotation completed during cancellation");
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        controller.abort(reason);
        return rotated;
      },
    });
    await expect(getValidAccessToken("openai", controller.signal)).rejects.toBe(reason);
    expect(stored()).toMatchObject({
      accessToken: rotated.access_token,
      refreshToken: rotated.refresh_token,
      tokenType: "Bearer",
    });
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes atomic persistence before propagating abort during write", async () => {
    success();
    const controller = new AbortController();
    const reason = new Error("write canceled after valid rotation");
    mocks.writeFile.mockImplementation(async (file: string, content: string) => {
      controller.abort(reason);
      disk.set(file, content);
    });
    await expect(getValidAccessToken("openai", controller.signal)).rejects.toBe(reason);
    expect(stored()).toMatchObject({
      accessToken: rotated.access_token,
      refreshToken: rotated.refresh_token,
    });
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(mocks.unlink).not.toHaveBeenCalledWith(destination);
  });

  it("returns a cached valid token without refresh or persistence", async () => {
    disk.set(destination, JSON.stringify({ ...old, expiresAt: Date.now() + 3600000 }));
    await expect(getValidAccessToken("openai")).resolves.toEqual({
      accessToken: old.accessToken,
      isNew: false,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps expired credentials without a refresh token for explicit recovery", async () => {
    const expired = { accessToken: old.accessToken, expiresAt: 1, tokenType: "Bearer" };
    disk.set(destination, JSON.stringify(expired));
    await expect(getValidAccessToken("openai")).resolves.toBeNull();
    expect(stored()).toEqual(expired);
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("OAuth token atomic persistence", () => {
  it("writes a private exclusive sibling then atomically renames it", async () => {
    await saveTokens("openai", old);
    const [temporary, content, options] = mocks.writeFile.mock.calls[0]!;
    expect(temporary).not.toBe(destination);
    expect(path.dirname(temporary as string)).toBe(path.dirname(destination));
    expect(options).toEqual(expect.objectContaining({ mode: 0o600, flag: "wx" }));
    expect(JSON.parse(content as string)).toEqual(old);
    expect(mocks.rename).toHaveBeenCalledWith(temporary, destination);
    expect(mocks.mkdir).toHaveBeenCalledWith(
      path.dirname(destination),
      expect.objectContaining({ mode: 0o700, recursive: true }),
    );
    expect([...disk.keys()]).toEqual([destination]);
  });

  it.each(["write", "rename"] as const)(
    "%s failure rejects, keeps previous credentials and cleans its temporary file",
    async (stage) => {
      success();
      const failure = new Error(`fixture ${stage} failure`);
      if (stage === "write")
        mocks.writeFile.mockImplementation(async (file: string) => {
          disk.set(file, "partial");
          throw failure;
        });
      else mocks.rename.mockRejectedValue(failure);
      await expect(getValidAccessToken("openai")).rejects.toMatchObject({ cause: failure });
      expectOriginal();
      const [temporary] = mocks.writeFile.mock.calls[0]!;
      expect(mocks.unlink).toHaveBeenCalledWith(temporary);
      expect([...disk.keys()]).toEqual([destination]);
      if (stage === "write") expect(mocks.rename).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("exclusive temporary-file collision never deletes an entry owned by another writer", async () => {
    const collision = Object.assign(new Error("fixture collision"), { code: "EEXIST" });
    mocks.writeFile.mockImplementation(async (file: string) => {
      disk.set(file, "other writer owns this entry");
      throw collision;
    });
    await expect(saveTokens("openai", old)).rejects.toBe(collision);
    const [temporary] = mocks.writeFile.mock.calls[0]!;
    expect(disk.get(temporary as string)).toBe("other writer owns this entry");
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
    expectOriginal();
  });
});
