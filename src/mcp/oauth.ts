/**
 * MCP OAuth 2.1 helper for remote HTTP servers.
 *
 * Implements the MCP authorization flow:
 * - Parse WWW-Authenticate on 401
 * - Discover protected resource metadata + authorization server metadata
 * - Dynamic client registration (RFC7591)
 * - Authorization code + PKCE via localhost callback
 * - Persist token for next runs
 */

import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { createCallbackServer, OAUTH_CALLBACK_PORT } from "../auth/callback-server.js";
import { CONFIG_PATHS } from "../config/paths.js";
import { getLogger } from "../utils/logger.js";
import { createRequestScope } from "../utils/request-scope.js";
import { rethrowCancellation } from "../utils/cancellation.js";
import { saveCredentialFile } from "../auth/credential-storage.js";

const execFileAsync = promisify(execFile);
const TOKEN_STORE_PATH = path.join(CONFIG_PATHS.tokens, "mcp-oauth.json");
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface StoredToken {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  expiresAt?: number;
  authorizationServer?: string;
  clientId?: string;
  resource?: string;
}

interface StoredClient {
  clientId: string;
}

interface MCPTokenStore {
  tokens: Record<string, StoredToken>;
  clients: Record<string, StoredClient>;
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[];
}

interface AuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
}

const logger = getLogger();

function getResourceKey(resourceUrl: string): string {
  const resource = canonicalizeResourceUrl(resourceUrl);
  return resource.toLowerCase();
}

function canonicalizeResourceUrl(resourceUrl: string): string {
  const parsed = new URL(resourceUrl);
  parsed.search = "";
  parsed.hash = "";
  if (parsed.pathname === "/") {
    return `${parsed.protocol}//${parsed.host}`;
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

async function loadStore(): Promise<MCPTokenStore> {
  try {
    const content = await fs.readFile(TOKEN_STORE_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<MCPTokenStore>;
    return {
      tokens: parsed.tokens ?? {},
      clients: parsed.clients ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tokens: {}, clients: {} };
    throw error;
  }
}

class MCPPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Failed to save MCP OAuth credentials; previous file was preserved.", { cause });
    this.name = "MCPPersistenceError";
  }
}

async function saveStore(store: MCPTokenStore): Promise<void> {
  try {
    await saveCredentialFile(TOKEN_STORE_PATH, store);
  } catch (error) {
    throw new MCPPersistenceError(error);
  }
}

function isTokenExpired(token: StoredToken): boolean {
  if (!token.expiresAt) return false;
  return Date.now() >= token.expiresAt - 30_000;
}

export async function getStoredMcpOAuthToken(resourceUrl: string): Promise<string | undefined> {
  const store = await loadStore();
  const token = store.tokens[getResourceKey(resourceUrl)];
  if (!token) return undefined;
  if (isTokenExpired(token)) return undefined;
  return token.accessToken;
}

function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function createState(): string {
  return randomBytes(16).toString("hex");
}

async function openBrowser(url: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  let safeUrl: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    safeUrl = parsed.toString();
  } catch {
    return false;
  }

  const isWSL =
    process.platform === "linux" &&
    (process.env["WSL_DISTRO_NAME"] !== undefined ||
      process.env["WSL_INTEROP"] !== undefined ||
      process.env["TERM_PROGRAM"]?.toLowerCase().includes("wsl") === true);

  const commands: Array<{ cmd: string; args: string[] }> = [];

  if (process.platform === "darwin") {
    commands.push(
      { cmd: "open", args: [safeUrl] },
      { cmd: "open", args: ["-a", "Safari", safeUrl] },
      { cmd: "open", args: ["-a", "Google Chrome", safeUrl] },
    );
  } else if (process.platform === "win32") {
    commands.push({ cmd: "rundll32", args: ["url.dll,FileProtocolHandler", safeUrl] });
  } else if (isWSL) {
    commands.push(
      { cmd: "cmd.exe", args: ["/c", "start", "", safeUrl] },
      { cmd: "powershell.exe", args: ["-Command", `Start-Process '${safeUrl}'`] },
      { cmd: "wslview", args: [safeUrl] },
    );
  } else {
    commands.push(
      { cmd: "xdg-open", args: [safeUrl] },
      { cmd: "sensible-browser", args: [safeUrl] },
      { cmd: "x-www-browser", args: [safeUrl] },
      { cmd: "gnome-open", args: [safeUrl] },
      { cmd: "firefox", args: [safeUrl] },
      { cmd: "chromium-browser", args: [safeUrl] },
      { cmd: "google-chrome", args: [safeUrl] },
    );
  }

  for (const { cmd, args } of commands) {
    try {
      signal.throwIfAborted();
      await execFileAsync(cmd, args, { signal });
      signal.throwIfAborted();
      return true;
    } catch (error) {
      rethrowCancellation(error, signal);
      continue;
    }
  }

  return false;
}

function maskUrlForLogs(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

function parseResourceMetadataUrl(wwwAuthenticateHeader?: string | null): string | undefined {
  if (!wwwAuthenticateHeader) return undefined;
  const match = wwwAuthenticateHeader.match(/resource_metadata="([^"]+)"/i);
  return match?.[1];
}

function createProtectedMetadataCandidates(resourceUrl: string, headerUrl?: string): string[] {
  const candidates: string[] = [];
  if (headerUrl) {
    candidates.push(headerUrl);
  }

  const resource = new URL(resourceUrl);
  const origin = `${resource.protocol}//${resource.host}`;
  const pathPart = resource.pathname.replace(/\/+$/, "");

  candidates.push(`${origin}/.well-known/oauth-protected-resource`);
  if (pathPart && pathPart !== "/") {
    candidates.push(`${origin}/.well-known/oauth-protected-resource${pathPart}`);
    candidates.push(
      `${origin}/.well-known/oauth-protected-resource/${pathPart.replace(/^\//, "")}`,
    );
  }

  return Array.from(new Set(candidates));
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  try {
    signal.throwIfAborted();
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
    const data = (await res.json()) as T;
    signal.throwIfAborted();
    return data;
  } finally {
    if (res.body && !res.body.locked) await res.body.cancel().catch(() => {});
  }
}

function buildAuthorizationMetadataCandidates(issuer: string): string[] {
  const parsed = new URL(issuer);
  const base = `${parsed.protocol}//${parsed.host}`;
  const issuerPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");

  const candidates = [
    `${base}/.well-known/oauth-authorization-server${issuerPath}`,
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration${issuerPath}`,
    `${base}/.well-known/openid-configuration`,
  ];

  return Array.from(new Set(candidates));
}

async function discoverProtectedResourceMetadata(
  resourceUrl: string,
  wwwAuthenticateHeader: string | null | undefined,
  signal: AbortSignal,
): Promise<ProtectedResourceMetadata> {
  const headerUrl = parseResourceMetadataUrl(wwwAuthenticateHeader);
  const candidates = createProtectedMetadataCandidates(resourceUrl, headerUrl);

  for (const candidate of candidates) {
    try {
      const metadata = await fetchJson<ProtectedResourceMetadata>(candidate, signal);
      if (
        Array.isArray(metadata.authorization_servers) &&
        metadata.authorization_servers.length > 0
      ) {
        return metadata;
      }
    } catch (error) {
      rethrowCancellation(error, signal);
      // Try next candidate.
    }
  }

  throw new Error("Could not discover OAuth protected resource metadata for MCP server");
}

async function discoverAuthorizationServerMetadata(
  authorizationServer: string,
  signal: AbortSignal,
): Promise<AuthorizationServerMetadata> {
  const candidates = buildAuthorizationMetadataCandidates(authorizationServer);
  for (const candidate of candidates) {
    try {
      const metadata = await fetchJson<AuthorizationServerMetadata>(candidate, signal);
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        return metadata;
      }
    } catch (error) {
      rethrowCancellation(error, signal);
      // Try next.
    }
  }

  throw new Error("Could not discover OAuth authorization server metadata");
}

async function ensureClientId(
  authorizationMetadata: AuthorizationServerMetadata,
  authorizationServer: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const store = await loadStore();
  signal.throwIfAborted();
  const clientKey = `${authorizationServer}|${redirectUri}`;
  const existing = store.clients[clientKey]?.clientId;
  if (existing) return existing;

  const registrationEndpoint = authorizationMetadata.registration_endpoint;
  if (!registrationEndpoint) {
    throw new Error(
      "Authorization server does not expose dynamic client registration; configure a static OAuth client ID for this MCP server.",
    );
  }

  const registrationPayload = {
    client_name: "corbat-coco-mcp",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  const response = await fetch(registrationEndpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(registrationPayload),
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    throw new Error(`Dynamic client registration failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { client_id?: string };
  const clientId = data.client_id;
  if (typeof clientId !== "string" || !clientId.trim()) {
    throw new Error("Dynamic client registration did not return client_id");
  }

  store.clients[clientKey] = { clientId };
  await saveStore(store);
  signal.throwIfAborted();
  return clientId;
}

function validateTokenResponse(token: TokenResponse): TokenResponse {
  if (!token || typeof token.access_token !== "string" || !token.access_token.trim()) {
    throw new Error("Token response missing access_token");
  }
  if (
    token.refresh_token !== undefined &&
    (typeof token.refresh_token !== "string" || !token.refresh_token.trim())
  ) {
    throw new Error("Token response contains an invalid refresh_token");
  }
  if (
    token.expires_in !== undefined &&
    (typeof token.expires_in !== "number" ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in < 0 ||
      !Number.isFinite(Date.now() + token.expires_in * 1000))
  ) {
    throw new Error("Token response contains an invalid expires_in");
  }
  return token;
}

async function refreshAccessToken(params: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  resource: string;
  signal: AbortSignal;
}): Promise<TokenResponse> {
  params.signal.throwIfAborted();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    refresh_token: params.refreshToken,
    resource: params.resource,
  });

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: params.signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    params.signal.throwIfAborted();
    throw new Error(`Refresh token exchange failed: HTTP ${response.status}`);
  }

  return validateTokenResponse((await response.json()) as TokenResponse);
}

async function exchangeCodeForToken(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  resource: string,
  signal: AbortSignal,
): Promise<TokenResponse> {
  signal.throwIfAborted();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    resource,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    throw new Error(`Token exchange failed: HTTP ${response.status}`);
  }

  return validateTokenResponse((await response.json()) as TokenResponse);
}

async function persistToken(
  resourceUrl: string,
  token: TokenResponse,
  metadata?: { authorizationServer?: string; clientId?: string },
): Promise<void> {
  let store: MCPTokenStore;
  try {
    store = await loadStore();
  } catch (error) {
    throw new MCPPersistenceError(error);
  }
  const expiresAt =
    typeof token.expires_in === "number"
      ? Date.now() + Math.max(0, token.expires_in) * 1000
      : undefined;

  store.tokens[getResourceKey(resourceUrl)] = {
    accessToken: token.access_token,
    tokenType: token.token_type,
    refreshToken: token.refresh_token,
    authorizationServer: metadata?.authorizationServer,
    clientId: metadata?.clientId,
    resource: canonicalizeResourceUrl(resourceUrl),
    ...(expiresAt ? { expiresAt } : {}),
  };

  await saveStore(store);
}

export async function authenticateMcpOAuth(params: {
  serverName: string;
  resourceUrl: string;
  wwwAuthenticateHeader?: string | null;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  timeout?: number;
}): Promise<string> {
  const scope = createRequestScope(params.signal, params.timeout ?? OAUTH_TIMEOUT_MS);
  try {
    return await authenticateWithinScope(params, scope.signal);
  } catch (error) {
    if (!(error instanceof MCPPersistenceError)) rethrowCancellation(error, scope.signal);
    throw error;
  } finally {
    scope.dispose();
  }
}

async function authenticateWithinScope(
  params: {
    serverName: string;
    resourceUrl: string;
    wwwAuthenticateHeader?: string | null;
    forceRefresh?: boolean;
  },
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const resource = canonicalizeResourceUrl(params.resourceUrl);
  const store = await loadStore();
  signal.throwIfAborted();
  const stored = store.tokens[getResourceKey(resource)];
  if (stored && !params.forceRefresh && !isTokenExpired(stored)) {
    return stored.accessToken;
  }

  let authorizationServer: string | undefined;
  let authorizationMetadata: AuthorizationServerMetadata | undefined;

  try {
    const protectedMetadata = await discoverProtectedResourceMetadata(
      resource,
      params.wwwAuthenticateHeader,
      signal,
    );
    authorizationServer = protectedMetadata.authorization_servers?.[0];
    if (authorizationServer) {
      authorizationMetadata = await discoverAuthorizationServerMetadata(
        authorizationServer,
        signal,
      );
    }
  } catch (error) {
    rethrowCancellation(error, signal);
    // Some real-world MCP servers do not expose RFC9728 protected-resource metadata.
    // Fallback to direct authorization-server metadata discovery at the resource origin.
  }

  if (!authorizationMetadata) {
    authorizationMetadata = await discoverAuthorizationServerMetadata(resource, signal);
  }

  authorizationServer =
    authorizationServer ?? authorizationMetadata.issuer ?? new URL(resource).origin;

  // Try refresh-token path before interactive login.
  if (
    stored &&
    stored.refreshToken &&
    stored.clientId &&
    (params.forceRefresh || isTokenExpired(stored))
  ) {
    const refreshed = await refreshAccessToken({
      tokenEndpoint: authorizationMetadata.token_endpoint,
      clientId: stored.clientId,
      refreshToken: stored.refreshToken,
      resource,
      signal,
    });
    // Preserve a completed rotation even when cancellation arrives after decoding.
    await persistToken(
      resource,
      {
        ...refreshed,
        refresh_token: refreshed.refresh_token ?? stored.refreshToken,
      },
      { authorizationServer, clientId: stored.clientId },
    );
    signal.throwIfAborted();
    return refreshed.access_token;
  }

  if (!process.stdout.isTTY) {
    throw new Error(
      `MCP server '${params.serverName}' requires interactive OAuth in a TTY session. Run Coco in a terminal, or use mcp-remote (e.g. npx -y mcp-remote@latest ${resource}) for IDE bridge workflows.`,
    );
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = createState();

  signal.throwIfAborted();
  const { port, resultPromise, close } = await createCallbackServer(
    state,
    OAUTH_TIMEOUT_MS,
    OAUTH_CALLBACK_PORT,
    signal,
  );
  // Observe early callback failures while registration/browser opening is still pending.
  void resultPromise.catch(() => {});
  try {
    signal.throwIfAborted();
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const clientId = await ensureClientId(
      authorizationMetadata,
      authorizationServer,
      redirectUri,
      signal,
    );

    const authUrl = new URL(authorizationMetadata.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", resource);

    if (authorizationMetadata.scopes_supported?.includes("offline_access")) {
      authUrl.searchParams.set("scope", "offline_access");
    }

    const opened = await openBrowser(authUrl.toString(), signal);
    if (!opened) {
      logger.warn(`[MCP OAuth] Could not open browser automatically for '${params.serverName}'`);
      logger.warn(`[MCP OAuth] Manual auth URL base: ${maskUrlForLogs(authUrl.toString())}`);
      // Keep full URL on stdout for copy/paste when browser auto-open fails.
      console.log(`[MCP OAuth] Open this URL manually: ${authUrl.toString()}`);
    } else {
      logger.info(
        `[MCP OAuth] Opened browser for '${params.serverName}'. Complete login to continue.`,
      );
    }

    const callback = await resultPromise;
    signal.throwIfAborted();
    const token = await exchangeCodeForToken(
      authorizationMetadata.token_endpoint,
      clientId,
      callback.code,
      codeVerifier,
      redirectUri,
      resource,
      signal,
    );

    await persistToken(resource, token, { authorizationServer, clientId });
    signal.throwIfAborted();
    return token.access_token;
  } finally {
    await close();
  }
}
