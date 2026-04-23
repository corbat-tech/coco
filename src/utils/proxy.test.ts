import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetProxyDispatcher,
  describeFetchError,
  getProxyFromEnv,
  installProxyDispatcher,
  maskProxyUrl,
} from "./proxy.js";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

function clearProxyEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of PROXY_VARS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  return snapshot;
}

function restoreProxyEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of PROXY_VARS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

describe("getProxyFromEnv", () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = clearProxyEnv();
  });

  afterEach(() => {
    restoreProxyEnv(snapshot);
  });

  it("returns null when no proxy env var is set", () => {
    expect(getProxyFromEnv()).toBeNull();
  });

  it("prefers HTTPS_PROXY over HTTP_PROXY", () => {
    process.env.HTTP_PROXY = "http://http-proxy.example:80";
    process.env.HTTPS_PROXY = "http://https-proxy.example:443";
    expect(getProxyFromEnv()).toBe("http://https-proxy.example:443");
  });

  it("falls back to lowercase variants", () => {
    process.env.http_proxy = "http://lower.example:8080";
    expect(getProxyFromEnv()).toBe("http://lower.example:8080");
  });

  it("ignores empty strings", () => {
    process.env.HTTPS_PROXY = "   ";
    expect(getProxyFromEnv()).toBeNull();
  });
});

describe("maskProxyUrl", () => {
  it("masks password while keeping user visible", () => {
    expect(maskProxyUrl("http://alice:secret@proxy.corp:8080")).toMatch(
      /^http:\/\/alice:\*\*\*@proxy\.corp:8080\/?$/,
    );
  });

  it("leaves credential-less URLs intact", () => {
    expect(maskProxyUrl("http://proxy.corp:8080/")).toBe("http://proxy.corp:8080/");
  });

  it("returns sentinel for invalid URLs", () => {
    expect(maskProxyUrl("not a url")).toBe("[invalid proxy URL]");
  });
});

describe("installProxyDispatcher", () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = clearProxyEnv();
    __resetProxyDispatcher();
  });

  afterEach(() => {
    restoreProxyEnv(snapshot);
    __resetProxyDispatcher();
  });

  it("returns null when no proxy is configured", () => {
    expect(installProxyDispatcher()).toBeNull();
  });

  it("returns masked proxy URL when configured", () => {
    process.env.HTTPS_PROXY = "http://user:pw@proxy.corp:8080";
    const result = installProxyDispatcher();
    expect(result).toMatch(/^http:\/\/user:\*\*\*@proxy\.corp:8080\/?$/);
  });

  it("is idempotent on repeated calls", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp:8080";
    const first = installProxyDispatcher();
    const second = installProxyDispatcher();
    expect(first).toMatch(/^http:\/\/proxy\.corp:8080\/?$/);
    expect(second).toBe(first);
  });
});

describe("describeFetchError", () => {
  it("unwraps cause and returns code + hostname", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), {
      code: "ENOTFOUND",
      hostname: "github.com",
    });
    const error = new TypeError("fetch failed", { cause });

    const result = describeFetchError(error);
    expect(result.code).toBe("ENOTFOUND");
    expect(result.hostname).toBe("github.com");
    expect(result.summary).toContain("DNS lookup failed");
    expect(result.summary).toContain("github.com");
  });

  it("handles ECONNREFUSED with a human message", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const error = new TypeError("fetch failed", { cause });
    expect(describeFetchError(error).summary).toMatch(/Connection refused/);
  });

  it("flags self-signed cert as TLS interceptor hint", () => {
    const cause = Object.assign(new Error("cert"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    const error = new TypeError("fetch failed", { cause });
    expect(describeFetchError(error).summary).toMatch(/corporate TLS interceptor/);
  });

  it("returns a static fallback when no code is present (never leaks error.message)", () => {
    const cause = new Error("socket hang up — https://foo?token=leaked");
    const error = new TypeError("fetch failed", { cause });
    const result = describeFetchError(error);
    expect(result.summary).toBe("Unidentified network failure");
    expect(result.summary).not.toContain("token");
    expect(result.summary).not.toContain("leaked");
  });

  it("uses static fallback when no cause is present", () => {
    expect(describeFetchError(new Error("boom")).summary).toBe("Unidentified network failure");
  });

  it("handles non-Error inputs with a static sentinel", () => {
    expect(describeFetchError("plain string").summary).toBe("Unknown non-Error value thrown");
  });

  it("strips control + URL characters from hostnames before logging", () => {
    const cause = Object.assign(new Error("dns"), {
      code: "ENOTFOUND",
      hostname: "evil.com\n<script>\n?foo=bar",
    });
    const error = new TypeError("fetch failed", { cause });
    const result = describeFetchError(error);
    expect(result.summary).not.toContain("<");
    expect(result.summary).not.toContain(">");
    expect(result.summary).not.toContain("\n");
    expect(result.summary).not.toContain("?");
    expect(result.summary).not.toContain("=");
  });
});
