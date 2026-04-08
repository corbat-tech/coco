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
  } catch {
    return { tokens: {}, clients: {} };
  }
}

async function saveStore(store: MCPTokenStore): Promise<void> {
  await fs.mkdir(path.dirname(TOKEN_STORE_PATH), { recursive: true });
  await fs.writeFile(TOKEN_STORE_PATH, JSON.stringify(store, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
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

async function openBrowser(url: string): Promise<boolean> {
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
      await execFileAsync(cmd, args);
      return true;
    } catch {
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return (await res.json()) as T;
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
  wwwAuthenticateHeader?: string | null,
): Promise<ProtectedResourceMetadata> {
  const headerUrl = parseResourceMetadataUrl(wwwAuthenticateHeader);
  const candidates = createProtectedMetadataCandidates(resourceUrl, headerUrl);

  for (const candidate of candidates) {
    try {
      const metadata = await fetchJson<ProtectedResourceMetadata>(candidate);
      if (
        Array.isArray(metadata.authorization_servers) &&
        metadata.authorization_servers.length > 0
      ) {
        return metadata;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Could not discover OAuth protected resource metadata for MCP server");
}

async function discoverAuthorizationServerMetadata(
  authorizationServer: string,
): Promise<AuthorizationServerMetadata> {
  const candidates = buildAuthorizationMetadataCandidates(authorizationServer);
  for (const candidate of candidates) {
    try {
      const metadata = await fetchJson<AuthorizationServerMetadata>(candidate);
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        return metadata;
      }
    } catch {
      // Try next.
    }
  }

  throw new Error("Could not discover OAuth authorization server metadata");
}

async function ensureClientId(
  authorizationMetadata: AuthorizationServerMetadata,
  authorizationServer: string,
  redirectUri: string,
): Promise<string> {
  const store = await loadStore();
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
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(registrationPayload),
  });

  if (!response.ok) {
    throw new Error(`Dynamic client registration failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { client_id?: string };
  const clientId = data.client_id;
  if (!clientId) {
    throw new Error("Dynamic client registration did not return client_id");
  }

  store.clients[clientKey] = { clientId };
  await saveStore(store);
  return clientId;
}

async function refreshAccessToken(params: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  resource: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    refresh_token: params.refreshToken,
    resource: params.resource,
  });

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Refresh token exchange failed: HTTP ${response.status}`);
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  if (!tokenResponse.access_token) {
    throw new Error("Refresh token response missing access_token");
  }
  return tokenResponse;
}

async function exchangeCodeForToken(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  resource: string,
): Promise<TokenResponse> {
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: HTTP ${response.status}`);
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  if (!tokenResponse.access_token) {
    throw new Error("Token exchange response missing access_token");
  }
  return tokenResponse;
}

async function persistToken(
  resourceUrl: string,
  token: TokenResponse,
  metadata?: { authorizationServer?: string; clientId?: string },
): Promise<void> {
  const store = await loadStore();
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
}): Promise<string> {
  const resource = canonicalizeResourceUrl(params.resourceUrl);
  const store = await loadStore();
  const stored = store.tokens[getResourceKey(resource)];
  if (stored && !params.forceRefresh && !isTokenExpired(stored)) {
    return stored.accessToken;
  }

  if (!process.stdout.isTTY) {
    throw new Error(
      `MCP server '${params.serverName}' requires interactive OAuth in a TTY session. Run Coco in a terminal, or use mcp-remote (e.g. npx -y mcp-remote@latest ${resource}) for IDE bridge workflows.`,
    );
  }

  let authorizationServer: string | undefined;
  let authorizationMetadata: AuthorizationServerMetadata | undefined;

  try {
    const protectedMetadata = await discoverProtectedResourceMetadata(
      resource,
      params.wwwAuthenticateHeader,
    );
    authorizationServer = protectedMetadata.authorization_servers?.[0];
    if (authorizationServer) {
      authorizationMetadata = await discoverAuthorizationServerMetadata(authorizationServer);
    }
  } catch {
    // Some real-world MCP servers do not expose RFC9728 protected-resource metadata.
    // Fallback to direct authorization-server metadata discovery at the resource origin.
  }

  if (!authorizationMetadata) {
    authorizationMetadata = await discoverAuthorizationServerMetadata(resource);
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
    try {
      const refreshed = await refreshAccessToken({
        tokenEndpoint: authorizationMetadata.token_endpoint,
        clientId: stored.clientId,
        refreshToken: stored.refreshToken,
        resource,
      });
      await persistToken(resource, refreshed, {
        authorizationServer,
        clientId: stored.clientId,
      });
      return refreshed.access_token;
    } catch {
      // Fall through to interactive auth.
    }
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = createState();

  const { port, resultPromise } = await createCallbackServer(
    state,
    OAUTH_TIMEOUT_MS,
    OAUTH_CALLBACK_PORT,
  );
  const redirectUri = `http://localhost:${port}/auth/callback`;
  const clientId = await ensureClientId(authorizationMetadata, authorizationServer, redirectUri);

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

  const opened = await openBrowser(authUrl.toString());
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
  const token = await exchangeCodeForToken(
    authorizationMetadata.token_endpoint,
    clientId,
    callback.code,
    codeVerifier,
    redirectUri,
    resource,
  );

  await persistToken(resource, token, { authorizationServer, clientId });
  return token.access_token;
}
