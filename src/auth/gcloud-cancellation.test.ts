import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearADCCache, getADCAccessToken, getCachedADCToken, inspectADC } from "./gcloud.js";

type TokenCallback = (error: Error | null, stdout: string, stderr: string) => void;
const mocks = vi.hoisted(() => ({
  exec: vi.fn<
    (
      command: string,
      options: { timeout: number; signal?: AbortSignal },
      callback: TokenCallback,
    ) => void
  >(),
  execFile:
    vi.fn<
      (
        command: string,
        args: string[],
        options: { timeout: number; signal?: AbortSignal },
        callback: TokenCallback,
      ) => void
    >(),
}));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  // Match Node's execFile promisification contract (stdout + stderr), while
  // retaining a callback fake that never starts a process or reads credentials.
  Object.defineProperty(mocks.execFile, promisify.custom, {
    configurable: true,
    value: (command: string, args: string[], options: { timeout: number; signal?: AbortSignal }) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        mocks.execFile(command, args, options, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      }),
  });
  Object.defineProperty(mocks.exec, promisify.custom, {
    configurable: true,
    value: (command: string, options: { timeout: number; signal?: AbortSignal }) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        mocks.exec(command, options, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      }),
  });
  return { exec: mocks.exec, execFile: mocks.execFile };
});

beforeEach(() => {
  clearADCCache();
  vi.stubGlobal("process", { ...process, platform: "linux" });
  mocks.exec.mockReset().mockImplementation(() => {
    throw new Error("Unexpected shell invocation in POSIX ADC lookup");
  });
  mocks.execFile.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("ADC token lookup cancellation", () => {
  it.each([
    ["inspectADC", inspectADC],
    ["getADCAccessToken", getADCAccessToken],
    ["getCachedADCToken", getCachedADCToken],
  ] as const)("%s rejects a pre-aborted signal without invoking gcloud", async (_name, lookup) => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled ADC lookup");
    controller.abort(reason);
    await expect(lookup(controller.signal)).rejects.toBe(reason);
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("passes an argument vector, timeout and signal, then reuses a successful cached token", async () => {
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, "  fixture-access-token\n", "");
    });
    const controller = new AbortController();
    const token = await getCachedADCToken(controller.signal);
    expect(token?.accessToken).toBe("fixture-access-token");
    expect(token?.expiresAt).toBeGreaterThan(Date.now());
    expect(await getCachedADCToken(controller.signal)).toEqual(token);
    expect(mocks.execFile).toHaveBeenCalledExactlyOnceWith(
      "gcloud",
      ["auth", "application-default", "print-access-token"],
      expect.objectContaining({ timeout: 10000, signal: controller.signal }),
      expect.any(Function),
    );
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("rejects pre-abort even when a valid token is cached", async () => {
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, "cached-fixture-token", "");
    });
    await getCachedADCToken();
    const controller = new AbortController();
    const reason = new Error("cancelled before cache access");
    controller.abort(reason);
    await expect(getCachedADCToken(controller.signal)).rejects.toBe(reason);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it("preserves the caller reason when subprocess abort reports an ADC-shaped error", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped the request");
    mocks.execFile.mockImplementation((_command, _args, options, callback) => {
      options.signal?.addEventListener(
        "abort",
        () => callback(new Error("scope is required but not consented"), "", ""),
        { once: true },
      );
    });
    const pending = getADCAccessToken(controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it("does not cache a token returned after cancellation", async () => {
    let finish: TokenCallback | undefined;
    mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      finish = callback;
    });
    const controller = new AbortController();
    const reason = new Error("cancelled before token delivery");
    const pending = getCachedADCToken(controller.signal);
    controller.abort(reason);
    expect(finish).toBeDefined();
    finish!(null, "discard-this-fixture-token", "");
    await expect(pending).rejects.toBe(reason);

    mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, "fresh-fixture-token", "");
    });
    expect((await getCachedADCToken())?.accessToken).toBe("fresh-fixture-token");
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["scope is required but not consented", "scope_not_consented"],
    ["no application default credentials", "missing"],
    ["gcloud could not contact token service", "error"],
  ] as const)(
    "preserves ADC classification for non-cancellation failure: %s",
    async (message, status) => {
      mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
        callback(new Error(message), "", "");
      });
      const result = await inspectADC(new AbortController().signal);
      expect(result.status).toBe(status);
      expect(result.token).toBeNull();
      expect(result.suggestion).toBeTruthy();
    },
  );
});

describe("Windows ADC token lookup", () => {
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    mocks.exec.mockReset();
  });

  it("uses only the fixed shell command with timeout and signal for gcloud.cmd compatibility", async () => {
    mocks.exec.mockImplementation((_command, _options, callback) => {
      callback(null, "windows-fixture-token", "");
    });
    const controller = new AbortController();
    expect((await getCachedADCToken(controller.signal))?.accessToken).toBe("windows-fixture-token");
    expect((await getCachedADCToken(controller.signal))?.accessToken).toBe("windows-fixture-token");
    expect(mocks.exec).toHaveBeenCalledExactlyOnceWith(
      "gcloud auth application-default print-access-token",
      expect.objectContaining({ timeout: 10000, signal: controller.signal }),
      expect.any(Function),
    );
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("preserves cancellation reason instead of classifying a shell failure as missing ADC", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled Windows ADC lookup");
    mocks.exec.mockImplementation((_command, options, callback) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          callback(new Error("no application default credentials"), "", "");
        },
        { once: true },
      );
    });
    const pending = getADCAccessToken(controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("does not cache late shell success after cancellation", async () => {
    let finish: TokenCallback | undefined;
    mocks.exec.mockImplementationOnce((_command, _options, callback) => {
      finish = callback;
    });
    const controller = new AbortController();
    const reason = new Error("cancelled before Windows token delivery");
    const pending = getCachedADCToken(controller.signal);
    controller.abort(reason);
    expect(finish).toBeDefined();
    finish!(null, "discard-windows-token", "");
    await expect(pending).rejects.toBe(reason);
    mocks.exec.mockImplementationOnce((_command, _options, callback) => {
      callback(null, "fresh-windows-token", "");
    });
    expect((await getCachedADCToken())?.accessToken).toBe("fresh-windows-token");
    expect(mocks.exec).toHaveBeenCalledTimes(2);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

describe("interactive gcloud cancellation", () => {
  it.each(["isGcloudInstalled", "runGcloudADCLogin", "runGcloudADCRevoke"] as const)(
    "%s forwards cancellation to its command and does not fallback",
    async (name) => {
      const { [name]: operation } = await import("./gcloud.js");
      const controller = new AbortController();
      const reason = new Error("host stopped");
      mocks.exec.mockImplementation((_command, options, callback) => {
        expect(options.signal).toBe(controller.signal);
        expect(options.timeout).toBeGreaterThan(0);
        controller.abort(reason);
        callback(new Error("command aborted"), "", "");
      });
      await expect(operation(controller.signal)).rejects.toBe(reason);
      expect(mocks.exec).toHaveBeenCalledTimes(1);
    },
  );
});
