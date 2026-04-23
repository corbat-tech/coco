/**
 * HTTP(S) Proxy support for Node's global fetch.
 *
 * Node's built-in fetch (undici) does NOT honor HTTP_PROXY / HTTPS_PROXY /
 * NO_PROXY by default. Corporate networks routinely fail without this wiring
 * — the failures surface as opaque "fetch failed" errors with no indication
 * that a proxy is in play.
 *
 * installProxyDispatcher() reads the standard env vars via undici's
 * EnvHttpProxyAgent and installs it as the global dispatcher, so every
 * fetch() call (auth flows, providers, MCP HTTP transport, etc.) goes
 * through the proxy. Returns a short description for logging, or null
 * when no proxy is configured.
 *
 * describeFetchError() unwraps the `cause` chain on Node fetch errors so
 * we can surface the real reason (ENOTFOUND, ECONNREFUSED, certificate
 * errors, etc.) instead of a generic "Network error".
 */

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

let installed = false;

/**
 * Install an undici EnvHttpProxyAgent as the global dispatcher when any
 * proxy env var is set. Safe to call multiple times (idempotent).
 *
 * Returns a masked proxy URL when a proxy is installed, or null otherwise.
 */
export function installProxyDispatcher(): string | null {
  if (installed) return getProxyFromEnv() ? maskProxyUrl(getProxyFromEnv()!) : null;

  const proxy = getProxyFromEnv();
  if (!proxy) return null;

  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    installed = true;
    return maskProxyUrl(proxy);
  } catch {
    return null;
  }
}

/**
 * Internal: reset install state. Tests only.
 */
export function __resetProxyDispatcher(): void {
  installed = false;
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
