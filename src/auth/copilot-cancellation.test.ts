import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeForCopilotToken,
  exchangeForCopilotTokenViaGhCli,
  getGitHubCliToken,
  getValidCopilotToken,
  getCopilotCredentialsPath,
} from "./copilot.js";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  exec: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.read,
  writeFile: mocks.write,
  mkdir: mocks.mkdir,
  unlink: mocks.unlink,
  rename: mocks.rename,
}));
vi.mock("node:child_process", () => {
  Object.defineProperty(mocks.exec, Symbol.for("nodejs.util.promisify.custom"), {
    configurable: true,
    value: (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        mocks.exec(...args, (error: Error | null, stdout: string, stderr: string) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      }),
  });
  return { execFile: mocks.exec };
});
type Callback = (error: Error | null, stdout?: string, stderr?: string) => void;
type ExecOptions = { signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv };
const credentials = {
  githubToken: "fixture-github",
  copilotToken: "fixture-expired",
  copilotTokenExpiresAt: 1,
};
function token() {
  return { token: "fixture-new-copilot", refresh_in: 1200, expires_at: Date.now() / 1000 + 1800 };
}
function success() {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => token() });
}
function expectClean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  for (const name of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) vi.stubEnv(name, "");
  mocks.read.mockResolvedValue(JSON.stringify(credentials));
  mocks.write.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.rename.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
  mocks.exec.mockImplementation(
    (_cmd: string, _args: string[], _options: ExecOptions, callback: Callback) =>
      callback(Object.assign(new Error("fixture gh unavailable"), { code: "ENOENT" })),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Copilot auth cancellation primitives", () => {
  it("rejects an HTTP token expiry that overflows when converted to milliseconds", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...token(), expires_at: 1e308 }),
    });
    await expect(exchangeForCopilotToken("fixture-github")).rejects.toBeInstanceOf(Error);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rejects a gh token expiry that overflows when converted to milliseconds", async () => {
    mocks.exec.mockImplementation(
      (_command: string, _args: string[], _options: ExecOptions, callback: Callback) => {
        callback(null, JSON.stringify({ ...token(), expires_at: 1e308 }), "");
      },
    );
    await expect(exchangeForCopilotTokenViaGhCli()).resolves.toBeNull();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["managed", "exchange", "gh token", "gh exchange"] as const)(
    "pre-aborted %s starts no I/O",
    async (operation) => {
      const controller = new AbortController();
      const reason = new Error("fixture preabort");
      controller.abort(reason);
      const call = () =>
        operation === "managed"
          ? getValidCopilotToken(controller.signal)
          : operation === "exchange"
            ? exchangeForCopilotToken("fixture-github", controller.signal)
            : operation === "gh token"
              ? getGitHubCliToken(controller.signal)
              : exchangeForCopilotTokenViaGhCli(controller.signal);
      await expect(Promise.resolve().then(call)).rejects.toBe(reason);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.exec).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      expectClean(controller.signal);
    },
  );

  it("direct exchange forwards the caller signal", async () => {
    success();
    const controller = new AbortController();
    await expect(
      exchangeForCopilotToken("fixture-github", controller.signal),
    ).resolves.toMatchObject({ token: "fixture-new-copilot" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it.each(["gh token", "gh exchange"] as const)(
    "%s passes signal to execFile and preserves raw callback abort reason",
    async (operation) => {
      const controller = new AbortController();
      const reason = new Error("gh canceled");
      mocks.exec.mockImplementation(
        (_cmd: string, _args: string[], options: ExecOptions, callback: Callback) => {
          expect(options.signal).toBe(controller.signal);
          controller.abort(reason);
          callback(Object.assign(new Error("wrapped subprocess abort"), { name: "AbortError" }));
        },
      );
      const pending =
        operation === "gh token"
          ? getGitHubCliToken(controller.signal)
          : exchangeForCopilotTokenViaGhCli(controller.signal);
      await expect(pending).rejects.toBe(reason);
      expect(mocks.exec).toHaveBeenCalledOnce();
      expect(mocks.exec.mock.calls[0]?.[1]).toEqual(
        operation === "gh token"
          ? ["auth", "token", "--hostname", "github.com"]
          : ["api", "/copilot_internal/v2/token", "--hostname", "github.com"],
      );
    },
  );
});

describe("Copilot managed token lifetime", () => {
  it("uses cached valid credentials without probing gh or HTTP", async () => {
    mocks.read.mockResolvedValue(
      JSON.stringify({ ...credentials, copilotTokenExpiresAt: Date.now() + 3600000 }),
    );
    await expect(getValidCopilotToken()).resolves.toMatchObject({
      token: credentials.copilotToken,
      isNew: false,
    });
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["environment", "credentials"] as const)(
    "%s GitHub token avoids unnecessary gh auth token",
    async (source) => {
      if (source === "environment") vi.stubEnv("COPILOT_GITHUB_TOKEN", "fixture-env-github");
      success();
      await expect(getValidCopilotToken()).resolves.toMatchObject({
        token: "fixture-new-copilot",
        isNew: true,
      });
      expect(mocks.exec).not.toHaveBeenCalled();
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(mocks.fetch.mock.calls[0]?.[1].headers.Authorization).toBe(
        `token ${source === "environment" ? "fixture-env-github" : credentials.githubToken}`,
      );
      expect(mocks.write).toHaveBeenCalledOnce();
    },
  );

  it("checks cancellation after credential loading", async () => {
    const controller = new AbortController();
    const reason = new Error("load canceled");
    mocks.read.mockImplementation(async () => {
      controller.abort(reason);
      return JSON.stringify(credentials);
    });
    await expect(getValidCopilotToken(controller.signal)).rejects.toBe(reason);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it.each(["headers", "body"] as const)(
    "cancel during %s prevents fallback and preserves credentials",
    async (stage) => {
      const controller = new AbortController();
      let owned!: AbortSignal;
      mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
        owned = options.signal as AbortSignal;
        const wait = () =>
          new Promise((_resolve, reject) =>
            owned.addEventListener("abort", () => reject(owned.reason), { once: true }),
          );
        return stage === "headers" ? wait() : Promise.resolve({ ok: true, json: wait });
      });
      const outcome = getValidCopilotToken(controller.signal).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.fetch).toHaveBeenCalledOnce();
      expect(owned).not.toBe(controller.signal);
      const reason = new Error("managed exchange canceled");
      controller.abort(reason);
      expect(await outcome).toBe(reason);
      expect(mocks.exec).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.unlink).not.toHaveBeenCalled();
      expectClean(controller.signal);
    },
  );

  it("total deadline cancels exchange at 30 seconds without gh fallback", async () => {
    let owned!: AbortSignal;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      owned = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        owned.addEventListener("abort", () => reject(owned.reason), { once: true }),
      );
    });
    const outcome = getValidCopilotToken().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29999);
    expect(owned.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe(owned.reason);
    expect(String(owned.reason)).toMatch(/timeout|timed out/i);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("network failure remains an error when gh fallback is unavailable", async () => {
    const failure = new Error("fixture transport unavailable");
    mocks.fetch.mockRejectedValue(failure);
    await expect(getValidCopilotToken()).rejects.toBe(failure);
    expect(mocks.exec).toHaveBeenCalledWith(
      "gh",
      ["api", "/copilot_internal/v2/token", "--hostname", "github.com"],
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["environment", "credentials"] as const)(
    "%s identity remains bound to github.com in gh fallback without token arguments",
    async (source) => {
      vi.stubEnv("GH_HOST", "unrelated.enterprise.invalid");
      const selectedToken =
        source === "environment" ? "fixture-selected-env-token" : credentials.githubToken;
      if (source === "environment") vi.stubEnv("COPILOT_GITHUB_TOKEN", selectedToken);
      mocks.fetch.mockRejectedValue(new Error("fixture direct exchange unavailable"));
      mocks.exec.mockImplementation(
        (command: string, args: string[], options: ExecOptions, callback: Callback) => {
          expect(command).toBe("gh");
          expect(args).toEqual(["api", "/copilot_internal/v2/token", "--hostname", "github.com"]);
          expect(args.join(" ")).not.toContain(selectedToken);
          expect(options.env?.GH_TOKEN).toBe(selectedToken);
          callback(null, JSON.stringify(token()), "");
        },
      );
      await expect(getValidCopilotToken()).resolves.toMatchObject({
        token: "fixture-new-copilot",
        isNew: true,
      });
      expect(mocks.fetch.mock.calls[0]?.[1].headers.Authorization).toBe(`token ${selectedToken}`);
      expect(mocks.exec).toHaveBeenCalledOnce();
    },
  );

  it("cancellation during gh fallback preserves the managed reason and stored credentials", async () => {
    const controller = new AbortController();
    mocks.fetch.mockRejectedValue(new Error("fixture direct exchange unavailable"));
    mocks.exec.mockImplementation(
      (_cmd: string, _args: string[], options: ExecOptions, callback: Callback) => {
        options.signal!.addEventListener("abort", () => callback(new Error("wrapped gh error")), {
          once: true,
        });
      },
    );
    const outcome = getValidCopilotToken(controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.exec).toHaveBeenCalledOnce();
    const reason = new Error("gh fallback canceled");
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });

  it.each([401, 403, 503])(
    "HTTP %s with unsuccessful gh fallback never deletes credentials or returns null",
    async (status) => {
      mocks.fetch.mockResolvedValue({
        ok: false,
        status,
        text: async () => "fixture failure",
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      });
      await expect(getValidCopilotToken()).rejects.toBeInstanceOf(Error);
      expect(mocks.unlink).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.fetch).toHaveBeenCalledOnce();
    },
  );

  it("disk failure after successful exchange does not trigger gh fallback", async () => {
    success();
    const failure = new Error("fixture disk failure");
    mocks.write.mockRejectedValue(failure);
    await expect(getValidCopilotToken()).rejects.toBe(failure);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalledWith(getCopilotCredentialsPath());
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists completed success before reporting cancellation during persistence", async () => {
    success();
    const controller = new AbortController();
    const reason = new Error("canceled after exchange");
    let persisted: unknown;
    mocks.write.mockImplementation(async (_file: string, content: string) => {
      persisted = JSON.parse(content);
      controller.abort(reason);
    });
    await expect(getValidCopilotToken(controller.signal)).rejects.toBe(reason);
    expect(persisted).toMatchObject({
      githubToken: credentials.githubToken,
      copilotToken: "fixture-new-copilot",
    });
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(mocks.exec).not.toHaveBeenCalled();
    expectClean(controller.signal);
  });
});
