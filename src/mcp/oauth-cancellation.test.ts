import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateMcpOAuth } from "./oauth.js";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  callback: vi.fn(),
  close: vi.fn(),
  exec: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.read } }));
vi.mock("../config/paths.js", () => ({ CONFIG_PATHS: { tokens: "/fixture-only/tokens" } }));
vi.mock("../auth/credential-storage.js", () => ({ saveCredentialFile: mocks.save }));
vi.mock("../auth/callback-server.js", () => ({
  createCallbackServer: mocks.callback,
  OAUTH_CALLBACK_PORT: 1455,
}));
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("node:child_process", () => {
  Object.defineProperty(mocks.exec, Symbol.for("nodejs.util.promisify.custom"), {
    configurable: true,
    value: (...args: unknown[]) =>
      new Promise((resolve, reject) =>
        mocks.exec(...args, (error: Error | null) =>
          error ? reject(error) : resolve({ stdout: "", stderr: "" }),
        ),
      ),
  });
  return { execFile: mocks.exec };
});
const resource = "https://resource.fixture.invalid/mcp";
const issuer = "https://auth.fixture.invalid";
const params = { serverName: "fixture", resourceUrl: resource };
const metadata = {
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  registration_endpoint: `${issuer}/register`,
};
const old = {
  accessToken: "fixture-old",
  refreshToken: "fixture-refresh",
  expiresAt: 1,
  clientId: "fixture-client",
  authorizationServer: issuer,
};
const fresh = {
  access_token: "fixture-new",
  refresh_token: "fixture-rotated",
  expires_in: 3600,
  token_type: "Bearer",
};
type Store = {
  tokens: Record<string, Record<string, unknown>>;
  clients: Record<string, { clientId: string }>;
};
let store: Store;
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
function tty(value: boolean) {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}
function interactive() {
  tty(true);
  store.tokens = {};
  store.clients[`${issuer}|http://localhost:1455/auth/callback`] = { clientId: "fixture-client" };
}
function respond(data: unknown) {
  return {
    ok: true,
    json: async () => data,
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
  };
}
function route(url: string) {
  if (url.includes("oauth-protected-resource")) return respond({ authorization_servers: [issuer] });
  if (url.includes(".well-known")) return respond(metadata);
  if (url === metadata.token_endpoint) return respond(fresh);
  throw new Error("Unexpected fixture URL");
}
function tokenPosts() {
  return mocks.fetch.mock.calls.filter(
    ([url, options]) => url === metadata.token_endpoint && options?.method === "POST",
  );
}
function clean(signal: AbortSignal) {
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}
beforeEach(() => {
  vi.useFakeTimers();
  tty(false);
  for (const mock of Object.values(mocks)) mock.mockReset();
  store = { tokens: { [resource]: { ...old } }, clients: {} };
  mocks.read.mockImplementation(async () => JSON.stringify(store));
  mocks.save.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.callback.mockResolvedValue({
    port: 1455,
    resultPromise: Promise.resolve({ code: "fixture-code", state: "fixture-state" }),
    close: mocks.close,
  });
  mocks.exec.mockImplementation(
    (_cmd: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) =>
      callback(null),
  );
  mocks.fetch.mockImplementation(async (url: string) => route(url));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  if (ttyDescriptor) Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
  else Reflect.deleteProperty(process.stdout, "isTTY");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MCP OAuth canceled execution", () => {
  it("pre-abort bypasses filesystem and cached token", async () => {
    store.tokens[resource]!.expiresAt = Date.now() + 3600000;
    const controller = new AbortController();
    controller.abort(new Error("fixture preabort"));
    await expect(authenticateMcpOAuth({ ...params, signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it("cached valid token needs no discovery or browser", async () => {
    store.tokens[resource]!.expiresAt = Date.now() + 3600000;
    await expect(authenticateMcpOAuth(params)).resolves.toBe(old.accessToken);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("abort during discovery stops metadata fallback immediately", async () => {
    const controller = new AbortController();
    const reason = new Error("discovery canceled");
    mocks.fetch.mockImplementation(async () => {
      controller.abort(reason);
      throw new Error("wrapped discovery abort");
    });
    await expect(authenticateMcpOAuth({ ...params, signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it.each([undefined, 17])("discovery is bounded by timeout %s", async (timeout) => {
    let signal!: AbortSignal;
    mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    });
    const outcome = authenticateMcpOAuth({
      ...params,
      ...(timeout === undefined ? {} : { timeout }),
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(timeout ?? 300000);
    expect(await outcome).toBe(signal.reason);
    expect(String(signal.reason)).toMatch(/timeout|timed out/i);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refresh works without TTY and preserves an omitted refresh token", async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url === metadata.token_endpoint
        ? respond({ access_token: "fixture-new", expires_in: 3600 })
        : route(url),
    );
    await expect(authenticateMcpOAuth(params)).resolves.toBe("fixture-new");
    expect(tokenPosts()[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(tokenPosts()).toHaveLength(1);
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    const saved = mocks.save.mock.calls[0]![1] as Store;
    expect(saved.tokens[resource]).toMatchObject({
      accessToken: "fixture-new",
      refreshToken: old.refreshToken,
    });
  });

  it.each([401, 503])("refresh HTTP %s does not retry, log in or save", async (status) => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url === metadata.token_endpoint
        ? { ok: false, status, body: { cancel: vi.fn().mockResolvedValue(undefined) } }
        : route(url),
    );
    await expect(authenticateMcpOAuth(params)).rejects.toThrow(/refresh/i);
    expect(tokenPosts()).toHaveLength(1);
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("canceled refresh body preserves reason and does not start interactive login", async () => {
    const controller = new AbortController();
    const reason = new Error("refresh body canceled");
    mocks.fetch.mockImplementation(async (url: string) =>
      url === metadata.token_endpoint
        ? {
            ok: true,
            json: async () => {
              controller.abort(reason);
              throw reason;
            },
          }
        : route(url),
    );
    await expect(authenticateMcpOAuth({ ...params, signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(tokenPosts()).toHaveLength(1);
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it("completed rotation is saved before propagating cancellation after JSON", async () => {
    const controller = new AbortController();
    const reason = new Error("rotation completed canceled");
    mocks.fetch.mockImplementation(async (url: string) =>
      url === metadata.token_endpoint
        ? {
            ok: true,
            json: async () => {
              controller.abort(reason);
              return fresh;
            },
          }
        : route(url),
    );
    await expect(authenticateMcpOAuth({ ...params, signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(mocks.save).toHaveBeenCalledOnce();
    expect((mocks.save.mock.calls[0]![1] as Store).tokens[resource]).toMatchObject({
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token,
    });
    clean(controller.signal);
  });

  it("disk failure takes priority over cancellation and never falls through to login", async () => {
    const controller = new AbortController();
    const diskError = Object.assign(new Error("fixture disk failure"), { code: "ENOSPC" });
    mocks.save.mockImplementation(async () => {
      controller.abort(new Error("canceled during save"));
      throw diskError;
    });
    await expect(
      authenticateMcpOAuth({ ...params, signal: controller.signal }),
    ).rejects.toMatchObject({ cause: diskError });
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    clean(controller.signal);
  });

  it("browser cancellation stops launcher fallbacks and closes callback", async () => {
    interactive();
    const controller = new AbortController();
    const reason = new Error("browser canceled");
    mocks.exec.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        options: { signal: AbortSignal },
        callback: (error: Error) => void,
      ) => {
        controller.abort(reason);
        expect(options.signal.aborted).toBe(true);
        callback(new Error("wrapped launcher abort"));
      },
    );
    await expect(authenticateMcpOAuth({ ...params, signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(mocks.exec).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(tokenPosts()).toHaveLength(0);
    clean(controller.signal);
  });

  it("successful interactive exchange always closes callback", async () => {
    interactive();
    await expect(authenticateMcpOAuth(params)).resolves.toBe(fresh.access_token);
    expect(tokenPosts()[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(mocks.callback).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("callback failure closes callback without token exchange", async () => {
    interactive();
    const failure = new Error("fixture callback failure");
    mocks.callback.mockImplementation(async () => ({
      port: 1455,
      resultPromise: Promise.reject(failure),
      close: mocks.close,
    }));
    await expect(authenticateMcpOAuth(params)).rejects.toBe(failure);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(tokenPosts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ENOENT means no stored credentials and does not initiate login without TTY", async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error("fixture absent"), { code: "ENOENT" }));
    await expect(authenticateMcpOAuth(params)).rejects.toThrow(/TTY/);
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("MCP OAuth mutation redirect policy", () => {
  it("registration and code exchange both reject redirects instead of replaying POST", async () => {
    interactive();
    store.clients = {};
    mocks.fetch.mockImplementation(async (url: string) =>
      url === metadata.registration_endpoint
        ? respond({ client_id: "fixture-registered-client" })
        : route(url),
    );
    await expect(authenticateMcpOAuth(params)).resolves.toBe(fresh.access_token);
    const posts = mocks.fetch.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(posts.map(([url]) => url)).toEqual([
      metadata.registration_endpoint,
      metadata.token_endpoint,
    ]);
    for (const [, options] of posts) expect(options).toMatchObject({ redirect: "error" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
