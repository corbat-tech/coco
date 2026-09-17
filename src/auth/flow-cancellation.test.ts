import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  confirm: vi.fn(),
  callback: vi.fn(),
  close: vi.fn(),
  save: vi.fn(),
  exchange: vi.fn(),
  exec: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  select: mocks.select,
  confirm: mocks.confirm,
  isCancel: (value: unknown) => typeof value === "symbol",
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { error: vi.fn() },
}));
vi.mock("./oauth.js", () => ({
  OAUTH_CONFIGS: { openai: {} },
  saveTokens: mocks.save,
  loadTokens: vi.fn(),
  getValidAccessToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  pollForToken: vi.fn(),
  buildAuthorizationUrl: () => "https://example.test/authorize",
  exchangeCodeForTokens: mocks.exchange,
}));
vi.mock("./callback-server.js", () => ({ createCallbackServer: mocks.callback }));
vi.mock("node:net", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    createServer: () => {
      const server = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        listen: () => void;
        close: () => void;
      };
      server.listen = () => {
        queueMicrotask(() => server.emit("listening"));
      };
      server.close = vi.fn();
      return server;
    },
  };
});
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  Object.defineProperty(mocks.exec, promisify.custom, { value: mocks.exec, configurable: true });
  return { execFile: mocks.exec };
});
import { runOAuthFlow } from "./flow.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.select.mockResolvedValue("browser");
  mocks.confirm.mockResolvedValue(Symbol("cancel"));
  mocks.close.mockResolvedValue(undefined);
  mocks.callback.mockResolvedValue({
    port: 1455,
    resultPromise: new Promise(() => {}),
    close: mocks.close,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("interactive OAuth cancellation", () => {
  it("closes the callback server when the browser prompt is cancelled", async () => {
    await expect(runOAuthFlow("openai")).resolves.toBeNull();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("passes the signal into callback ownership and never saves or offers fallback after abort", async () => {
    const controller = new AbortController();
    const reason = new Error("host stopped");
    mocks.confirm.mockImplementationOnce(async ({ signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort(reason);
      return true;
    });
    await expect(runOAuthFlow("openai", controller.signal)).rejects.toBe(reason);
    expect(mocks.callback).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      undefined,
      controller.signal,
    );
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("cancels the browser launcher itself without trying another launcher", async () => {
    const controller = new AbortController();
    const reason = new Error("host stopped");
    mocks.confirm.mockResolvedValue(true);
    mocks.exec.mockImplementationOnce(async (_command, _args, options) => {
      expect(options.signal).toBe(controller.signal);
      expect(options.timeout).toBe(10000);
      controller.abort(reason);
      throw reason;
    });
    await expect(runOAuthFlow("openai", controller.signal)).rejects.toBe(reason);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
