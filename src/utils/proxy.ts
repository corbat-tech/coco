/**
 * HTTP(S) Proxy support for Node's global fetch.
 *
 * Node's built-in fetch (undici) does NOT honor HTTP_PROXY / HTTPS_PROXY /
 * NO_PROXY by default, nor does it read OS-level proxy configuration (macOS
 * System Preferences → Network → Proxies, Windows WinHTTP). Corporate networks
 * routinely fail without this wiring — the failures surface as opaque
 * "fetch failed" errors with no indication that a proxy is in play.
 *
 * installProxyDispatcher() resolves a proxy in this order:
 *   1. Standard env vars (HTTPS_PROXY, HTTP_PROXY, lowercase variants).
 *   2. Operating-system proxy config (macOS scutil, Windows netsh winhttp).
 *
 * Whatever source it finds, it seeds the env vars and installs undici's
 * EnvHttpProxyAgent as the global dispatcher, so every fetch() call (auth
 * flows, providers, MCP HTTP transport, etc.) goes through the proxy.
 * Seeding the env also means spawned subprocesses (gh CLI, MCP servers)
 * inherit the same proxy config.
 *
 * describeFetchError() unwraps the `cause` chain on Node fetch errors so
 * we can surface the real reason (ENOTFOUND, ECONNREFUSED, certificate
 * errors, etc.) instead of a generic "Network error".
 */

import { execFileSync } from "node:child_process";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const PROXY_ENV_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

/**
 * Read the effective proxy URL from the environment.
 * Returns null if no proxy is configured.
 */
export function getProxyFromEnv(): string | null {
  for (const key of PROXY_ENV_VARS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Mask credentials inside a proxy URL so it is safe to log.
 * "http://user:pass@proxy.corp:8080" → "http://user:***@proxy.corp:8080"
 */
export function maskProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "[invalid proxy URL]";
  }
}

export interface SystemProxyConfig {
  proxyUrl: string;
  noProxy?: string;
}

export type CommandRunner = (cmd: string, args: string[]) => string | null;

function defaultRunner(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Parse `scutil --proxy` output (macOS). Prefers HTTPS over HTTP. Returns
 * null when only a PAC URL is configured (we can't evaluate PAC scripts
 * without a JS proxy runtime) or when no proxy is enabled.
 */
export function parseMacOsProxy(output: string): SystemProxyConfig | null {
  const getField = (name: string): string | undefined => {
    const re = new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, "m");
    return output.match(re)?.[1];
  };

  if (getField("ProxyAutoConfigEnable") === "1") {
    // PAC script detected — we cannot evaluate it, but we record the URL so
    // callers can surface a targeted hint (e.g. "set HTTPS_PROXY manually").
    return null;
  }

  const pick = (prefix: "HTTPS" | "HTTP"): string | null => {
    if (getField(`${prefix}Enable`) !== "1") return null;
    const host = getField(`${prefix}Proxy`);
    const port = getField(`${prefix}Port`);
    if (!host) return null;
    return `http://${host}${port ? `:${port}` : ""}`;
  };

  const proxyUrl = pick("HTTPS") ?? pick("HTTP");
  if (!proxyUrl) return null;

  const exceptionsMatch = output.match(/ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/);
  const exceptions: string[] = [];
  const exceptionsBody = exceptionsMatch?.[1];
  if (exceptionsBody) {
    for (const line of exceptionsBody.split("\n")) {
      const entry = line.match(/^\s*\d+\s*:\s*(.+?)\s*$/)?.[1];
      if (entry) exceptions.push(entry);
    }
  }

  return {
    proxyUrl,
    noProxy: exceptions.length > 0 ? exceptions.join(",") : undefined,
  };
}

/**
 * Parse `netsh winhttp show proxy` output (Windows). Returns null for
 * "Direct access" or when the output can't be parsed (e.g. localised to
 * a non-English locale).
 */
export function parseWindowsProxy(output: string): SystemProxyConfig | null {
  if (/Direct access/i.test(output)) return null;

  const raw = output.match(/Proxy\s+Server\(s\)\s*:\s*(\S.*?)\s*$/m)?.[1]?.trim();
  if (!raw) return null;

  // netsh may emit "host:port" OR "http=host:port;https=host:port".
  // Prefer the https entry when present.
  let hostPort = raw;
  if (raw.includes("=")) {
    const parts = raw.split(";").map((p) => p.trim());
    const httpsEntry = parts.find((p) => p.toLowerCase().startsWith("https="));
    const httpEntry = parts.find((p) => p.toLowerCase().startsWith("http="));
    const chosen = httpsEntry ?? httpEntry;
    if (!chosen) return null;
    hostPort = chosen.split("=", 2)[1]?.trim() ?? "";
    if (!hostPort) return null;
  }

  const proxyUrl = /^https?:\/\//i.test(hostPort) ? hostPort : `http://${hostPort}`;

  let noProxy: string | undefined;
  const bypass = output.match(/Bypass\s+List\s*:\s*(\S.*?)\s*$/m)?.[1]?.trim();
  if (bypass && !/\(none\)/i.test(bypass)) {
    noProxy = bypass.replace(/;/g, ",");
  }

  return { proxyUrl, noProxy };
}

/**
 * Read proxy configuration from the operating system.
 * Returns null on Linux (no standardised OS proxy) or when nothing is set.
 */
export function getProxyFromSystem(
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = defaultRunner,
): SystemProxyConfig | null {
  if (platform === "darwin") {
    const out = run("scutil", ["--proxy"]);
    return out ? parseMacOsProxy(out) : null;
  }
  if (platform === "win32") {
    const out = run("netsh", ["winhttp", "show", "proxy"]);
    return out ? parseWindowsProxy(out) : null;
  }
  return null;
}

/**
 * Detect whether macOS is configured with a PAC (Proxy Auto-Config) script.
 * Returns the PAC URL when present, null otherwise.
 *
 * Corporate networks using PAC scripts are invisible to Node's fetch (undici
 * cannot evaluate PAC scripts), but are fully transparent to Go-based tools
 * like `gh` CLI. Use this to surface a targeted hint to users on such networks.
 */
export function detectPacProxy(
  run: CommandRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "darwin") return null;
  const out = run("scutil", ["--proxy"]);
  if (!out) return null;

  const getField = (name: string): string | undefined => {
    const re = new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, "m");
    return out.match(re)?.[1];
  };

  if (getField("ProxyAutoConfigEnable") === "1") {
    return getField("ProxyAutoConfigURLString") ?? "PAC script";
  }
  return null;
}

let installed = false;
const seededEnvKeys: string[] = [];

/**
 * Install an undici EnvHttpProxyAgent as the global dispatcher. Resolves
 * the proxy from env vars first, then from OS-level config as a fallback.
 * Safe to call multiple times (idempotent).
 *
 * Returns a masked proxy URL when a proxy is installed, or null otherwise.
 */
export function installProxyDispatcher(
  resolveSystem: () => SystemProxyConfig | null = () => getProxyFromSystem(),
): string | null {
  if (installed) {
    const existing = getProxyFromEnv();
    return existing ? maskProxyUrl(existing) : null;
  }

  const envProxy = getProxyFromEnv();
  if (envProxy) {
    return applyDispatcher(envProxy);
  }

  const sys = resolveSystem();
  if (sys) {
    // Seed env so EnvHttpProxyAgent picks it up and so spawned subprocesses
    // (gh CLI, MCP servers, etc.) inherit the same proxy.
    seedEnv("HTTPS_PROXY", sys.proxyUrl);
    seedEnv("HTTP_PROXY", sys.proxyUrl);
    if (sys.noProxy && !process.env.NO_PROXY && !process.env.no_proxy) {
      seedEnv("NO_PROXY", sys.noProxy);
    }
    return applyDispatcher(sys.proxyUrl);
  }

  return null;
}

function seedEnv(key: string, value: string): void {
  if (process.env[key] !== undefined) return;
  process.env[key] = value;
  seededEnvKeys.push(key);
}

function applyDispatcher(proxyUrl: string): string | null {
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    installed = true;
    return maskProxyUrl(proxyUrl);
  } catch {
    return null;
  }
}

/**
 * Internal: reset install state. Tests only.
 */
export function __resetProxyDispatcher(): void {
  installed = false;
  while (seededEnvKeys.length > 0) {
    const key = seededEnvKeys.pop();
    if (key) delete process.env[key];
  }
}

interface FetchErrorShape {
  code?: string;
  hostname?: string;
  syscall?: string;
  message?: string;
}

/**
 * Unwrap a Node fetch error to surface the underlying cause's code +
 * hostname only. No string derived from `error.message` / `cause.message`
 * ever leaves this function — callers must emit their own static labels
 * keyed by the returned `code`.
 *
 * Node's fetch throws "TypeError: fetch failed" and puts the real error
 * (ENOTFOUND, ECONNREFUSED, SELF_SIGNED_CERT_IN_CHAIN, etc.) on `.cause`,
 * sometimes with a URL in the message that could include OAuth tokens or
 * client secrets. This narrow return shape is the hard boundary preventing
 * that data from reaching logs (CodeQL: js/clear-text-logging).
 */
export function describeFetchError(error: unknown): {
  code?: string;
  hostname?: string;
} {
  if (!(error instanceof Error)) {
    return {};
  }

  const cause = unwrapCause(error);
  return {
    code: cause?.code,
    hostname: cause?.hostname,
  };
}

/**
 * Defensive hostname sanitizer. DNS hostnames can only contain
 * [A-Za-z0-9.-]; anything else came from a weird cause shape and gets
 * stripped so it cannot be used to smuggle data into logs.
 */
export function safeHostname(value: string): string {
  return value.replace(/[^a-zA-Z0-9.\-:]/g, "").slice(0, 253) || "unknown";
}

function unwrapCause(error: Error): FetchErrorShape | undefined {
  let current: unknown = error;
  let depth = 0;
  // Walk the cause chain up to 5 levels to find the most specific error.
  while (current && depth < 5) {
    const next = (current as { cause?: unknown }).cause;
    if (!next) break;
    current = next;
    depth++;
  }
  if (current && typeof current === "object") {
    return current as FetchErrorShape;
  }
  return undefined;
}
