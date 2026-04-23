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
 * Unwrap a Node fetch error to surface the underlying cause.
 * Node's fetch throws "TypeError: fetch failed" and puts the real error
 * (ENOTFOUND, ECONNREFUSED, SELF_SIGNED_CERT_IN_CHAIN, etc.) on `.cause`.
 */
export function describeFetchError(error: unknown): {
  code?: string;
  hostname?: string;
  summary: string;
} {
  if (!(error instanceof Error)) {
    return { summary: String(error) };
  }

  const cause = unwrapCause(error);
  const code = cause?.code;
  const hostname = cause?.hostname;

  const hostSuffix = hostname ? ` (${hostname})` : "";

  if (code) {
    return { code, hostname, summary: `${humanizeCode(code)}${hostSuffix}` };
  }

  const causeMessage = cause?.message;
  if (causeMessage && causeMessage !== error.message) {
    return { hostname, summary: `${causeMessage}${hostSuffix}` };
  }

  return { hostname, summary: error.message };
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

function humanizeCode(code: string): string {
  switch (code) {
    case "ENOTFOUND":
      return "DNS lookup failed — host not found";
    case "ECONNREFUSED":
      return "Connection refused";
    case "ECONNRESET":
      return "Connection reset by peer";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "Connection timed out";
    case "EHOSTUNREACH":
      return "Host unreachable";
    case "ENETUNREACH":
      return "Network unreachable";
    case "CERT_HAS_EXPIRED":
      return "TLS certificate has expired";
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return "Self-signed TLS certificate — likely a corporate TLS interceptor";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "TLS certificate could not be verified — likely a corporate TLS interceptor";
    case "UND_ERR_SOCKET":
      return "Socket error during request";
    default:
      return code;
  }
}
