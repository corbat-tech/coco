import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetProxyDispatcher,
  describeFetchError,
  getProxyFromEnv,
  getProxyFromSystem,
  installProxyDispatcher,
  maskProxyUrl,
  parseMacOsProxy,
  parseWindowsProxy,
  safeHostname,
} from "./proxy.js";

const PROXY_VARS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

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
    expect(installProxyDispatcher(() => null)).toBeNull();
  });

  it("returns masked proxy URL when configured", () => {
    process.env.HTTPS_PROXY = "http://user:pw@proxy.corp:8080";
    const result = installProxyDispatcher(() => null);
    expect(result).toMatch(/^http:\/\/user:\*\*\*@proxy\.corp:8080\/?$/);
  });

  it("is idempotent on repeated calls", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp:8080";
    const first = installProxyDispatcher(() => null);
    const second = installProxyDispatcher(() => null);
    expect(first).toMatch(/^http:\/\/proxy\.corp:8080\/?$/);
    expect(second).toBe(first);
  });

  it("falls back to system proxy and seeds env vars when no env var is set", () => {
    expect(process.env.HTTPS_PROXY).toBeUndefined();
    const result = installProxyDispatcher(() => ({
      proxyUrl: "http://sys-proxy.corp:3128",
      noProxy: "*.local,169.254/16",
    }));
    expect(result).toMatch(/^http:\/\/sys-proxy\.corp:3128\/?$/);
    expect(process.env.HTTPS_PROXY).toBe("http://sys-proxy.corp:3128");
    expect(process.env.HTTP_PROXY).toBe("http://sys-proxy.corp:3128");
    expect(process.env.NO_PROXY).toBe("*.local,169.254/16");
  });

  it("prefers env var over system proxy when both are present", () => {
    process.env.HTTPS_PROXY = "http://env-proxy.corp:8080";
    const result = installProxyDispatcher(() => ({ proxyUrl: "http://sys-proxy.corp:3128" }));
    expect(result).toMatch(/^http:\/\/env-proxy\.corp:8080\/?$/);
  });

  it("does not overwrite an existing NO_PROXY when falling back to system proxy", () => {
    process.env.NO_PROXY = "preexisting.example";
    installProxyDispatcher(() => ({
      proxyUrl: "http://sys-proxy.corp:3128",
      noProxy: "*.local",
    }));
    expect(process.env.NO_PROXY).toBe("preexisting.example");
  });

  it("clears seeded env vars on reset", () => {
    installProxyDispatcher(() => ({ proxyUrl: "http://sys-proxy.corp:3128" }));
    expect(process.env.HTTPS_PROXY).toBe("http://sys-proxy.corp:3128");
    __resetProxyDispatcher();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });
});

describe("parseMacOsProxy", () => {
  it("returns HTTPS proxy when enabled", () => {
    const output = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : proxy.corp.example.com
  HTTPSEnable : 1
  HTTPSPort : 8443
  HTTPSProxy : secure-proxy.corp.example.com
}`;
    expect(parseMacOsProxy(output)).toEqual({
      proxyUrl: "http://secure-proxy.corp.example.com:8443",
      noProxy: "*.local,169.254/16",
    });
  });

  it("falls back to HTTP proxy when only HTTP is enabled", () => {
    const output = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : proxy.corp.example.com
  HTTPSEnable : 0
}`;
    expect(parseMacOsProxy(output)).toEqual({
      proxyUrl: "http://proxy.corp.example.com:8080",
    });
  });

  it("returns null when only PAC is configured", () => {
    const output = `<dictionary> {
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://wpad.corp/proxy.pac
}`;
    expect(parseMacOsProxy(output)).toBeNull();
  });

  it("returns null when nothing is enabled", () => {
    const output = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
  }
  FTPPassive : 1
}`;
    expect(parseMacOsProxy(output)).toBeNull();
  });

  it("handles proxy with no port", () => {
    const output = `<dictionary> {
  HTTPSEnable : 1
  HTTPSProxy : proxy.corp.example.com
}`;
    expect(parseMacOsProxy(output)).toEqual({
      proxyUrl: "http://proxy.corp.example.com",
    });
  });
});

describe("parseWindowsProxy", () => {
  it("parses a host:port proxy", () => {
    const output = `Current WinHTTP proxy settings:

    Proxy Server(s) :  proxy.corp.example.com:8080
    Bypass List     :  *.local;169.254/16`;
    expect(parseWindowsProxy(output)).toEqual({
      proxyUrl: "http://proxy.corp.example.com:8080",
      noProxy: "*.local,169.254/16",
    });
  });

  it("returns null for direct access", () => {
    const output = `Current WinHTTP proxy settings:

    Direct access (no proxy server).`;
    expect(parseWindowsProxy(output)).toBeNull();
  });

  it("prefers https entry when proxy has scheme=host:port pairs", () => {
    const output = `Current WinHTTP proxy settings:

    Proxy Server(s) :  http=proxy.corp:80;https=secure-proxy.corp:443
    Bypass List     :  (none)`;
    expect(parseWindowsProxy(output)).toEqual({
      proxyUrl: "http://secure-proxy.corp:443",
    });
  });

  it("falls back to http entry when only http= pair is present", () => {
    const output = `Current WinHTTP proxy settings:

    Proxy Server(s) :  http=proxy.corp:80
    Bypass List     :  (none)`;
    expect(parseWindowsProxy(output)).toEqual({
      proxyUrl: "http://proxy.corp:80",
    });
  });
});

describe("getProxyFromSystem", () => {
  it("returns null on linux", () => {
    expect(getProxyFromSystem("linux", () => "ignored")).toBeNull();
  });

  it("calls scutil on darwin", () => {
    const calls: Array<[string, string[]]> = [];
    const run = (cmd: string, args: string[]): string | null => {
      calls.push([cmd, args]);
      return `<dictionary> {
  HTTPSEnable : 1
  HTTPSPort : 3128
  HTTPSProxy : proxy.corp
}`;
    };
    expect(getProxyFromSystem("darwin", run)).toEqual({
      proxyUrl: "http://proxy.corp:3128",
    });
    expect(calls).toEqual([["scutil", ["--proxy"]]]);
  });

  it("calls netsh on win32", () => {
    const calls: Array<[string, string[]]> = [];
    const run = (cmd: string, args: string[]): string | null => {
      calls.push([cmd, args]);
      return `Current WinHTTP proxy settings:\n\n    Proxy Server(s) :  proxy.corp:8080\n    Bypass List     :  (none)`;
    };
    expect(getProxyFromSystem("win32", run)).toEqual({
      proxyUrl: "http://proxy.corp:8080",
    });
    expect(calls).toEqual([["netsh", ["winhttp", "show", "proxy"]]]);
  });

  it("returns null when command runner returns null", () => {
    expect(getProxyFromSystem("darwin", () => null)).toBeNull();
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
