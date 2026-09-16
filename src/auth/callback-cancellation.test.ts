import { get } from "node:http";
import { createServer, createConnection, Server } from "node:net";
import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCallbackServer } from "./callback-server.js";

async function expectPortReleased(port: number) {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => resolve());
    });
    expect(probe.listening).toBe(true);
  } finally {
    if (probe.listening)
      await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
  }
}
function requestCallback(port: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/auth/callback?code=fixture-code&state=fixture-state",
        agent: false,
      },
      (response) => {
        response.on("error", reject);
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
  });
}
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuth callback cancellation with an owned loopback server", () => {
  it("malformed callback URL returns 400 and leaves a later valid callback usable", async () => {
    const controller = new AbortController();
    const callback = await createCallbackServer("fixture-state", 1000, 0, controller.signal);
    const outcome = callback.resultPromise.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    const socket = createConnection({ host: "127.0.0.1", port: callback.port });
    try {
      const response = await new Promise<string>((resolve, reject) => {
        let received = "";
        socket.setEncoding("utf8");
        socket.on("error", reject);
        socket.on("data", (chunk: string) => {
          received += chunk;
        });
        socket.on("end", () => resolve(received));
        socket.on("connect", () =>
          socket.write(
            "GET //[:1455/auth/callback HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
          ),
        );
      });
      expect(response).toMatch(/^HTTP\/1\.1 400 /);
      expect(await requestCallback(callback.port)).toBe(200);
      expect(await outcome).toEqual({ value: { code: "fixture-code", state: "fixture-state" } });
      await expectPortReleased(callback.port);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      socket.destroy();
      await callback.close();
    }
  });
  it("pre-abort rejects before opening a listening socket", async () => {
    const listen = vi.spyOn(Server.prototype, "listen");
    const controller = new AbortController();
    const reason = new Error("fixture preabort");
    controller.abort(reason);
    await expect(createCallbackServer("fixture-state", 1000, 0, controller.signal)).rejects.toBe(
      reason,
    );
    expect(listen).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("abort after listen rejects with its reason and releases the port", async () => {
    const controller = new AbortController();
    const callback = await createCallbackServer("fixture-state", 1000, 0, controller.signal);
    const outcome = callback.resultPromise.catch((error: unknown) => error);
    try {
      expect(callback.port).toBeGreaterThan(0);
      const reason = new Error("fixture callback canceled");
      controller.abort(reason);
      expect(await outcome).toBe(reason);
      await expectPortReleased(callback.port);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      await callback.close();
    }
  });

  it("valid callback resolves its code and cleans server resources", async () => {
    const controller = new AbortController();
    const callback = await createCallbackServer("fixture-state", 1000, 0, controller.signal);
    // Attach rejection handling before initiating the HTTP callback.
    const outcome = callback.resultPromise.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      expect(await requestCallback(callback.port)).toBe(200);
      expect(await outcome).toEqual({ value: { code: "fixture-code", state: "fixture-state" } });
      await expectPortReleased(callback.port);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      await callback.close();
    }
  });

  it("deadline rejects and releases the listener and port", async () => {
    const controller = new AbortController();
    const callback = await createCallbackServer("fixture-state", 25, 0, controller.signal);
    const outcome = callback.resultPromise.catch((error: unknown) => error);
    try {
      expect(String(await outcome)).toMatch(/timeout|timed out/i);
      await expectPortReleased(callback.port);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      await callback.close();
    }
  });

  it("explicit close rejects a pending callback and remains idempotent", async () => {
    const controller = new AbortController();
    const callback = await createCallbackServer("fixture-state", 1000, 0, controller.signal);
    const outcome = callback.resultPromise.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      await callback.close();
      const result = await outcome;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(Error);
      await callback.close();
      await expectPortReleased(callback.port);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      await callback.close();
    }
  });
});
