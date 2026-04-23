import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetProxyDispatcher,
  describeFetchError,
  getProxyFromEnv,
  installProxyDispatcher,
  maskProxyUrl,
  safeHostname,
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
  it("returns only code + hostname from the cause chain", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), {
      code: "ENOTFOUND",
      hostname: "github.com",
    });
    const error = new TypeError("fetch failed", { cause });

    const result = describeFetchError(error);
    expect(result.code).toBe("ENOTFOUND");
    expect(result.hostname).toBe("github.com");
    // No `summary` / message-derived field must be exposed.
    expect(Object.keys(result).sort()).toEqual(["code", "hostname"]);
  });

  it("returns just the code when no hostname is present", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const error = new TypeError("fetch failed", { cause });
    const result = describeFetchError(error);
    expect(result.code).toBe("ECONNREFUSED");
    expect(result.hostname).toBeUndefined();
  });

  it("returns empty fields when no cause is present", () => {
    const result = describeFetchError(new Error("boom"));
    expect(result.code).toBeUndefined();
    expect(result.hostname).toBeUndefined();
  });

  it("returns empty object for non-Error inputs", () => {
    expect(describeFetchError("plain string")).toEqual({});
  });

  it("never includes error or cause message strings", () => {
    const cause = Object.assign(new Error("fetch https://api.example.com?token=SECRET123"), {
      code: "ECONNRESET",
    });
    const error = new TypeError("fetch failed", { cause });
    const serialized = JSON.stringify(describeFetchError(error));
    expect(serialized).not.toContain("SECRET123");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("api.example.com");
  });
});

describe("safeHostname", () => {
  it("strips control and URL characters", () => {
    const result = safeHostname("evil.com\n<script>\n?foo=bar");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("?");
    expect(result).not.toContain("=");
  });

  it("returns 'unknown' for a string that sanitizes to empty", () => {
    expect(safeHostname("!!!***###")).toBe("unknown");
  });

  it("caps the length at 253 characters (DNS max)", () => {
    const input = "a".repeat(500);
    expect(safeHostname(input)).toHaveLength(253);
  });
});
