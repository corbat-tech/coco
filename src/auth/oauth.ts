/**
 * OAuth 2.0 for AI Providers
 *
 * Supports two authentication flows:
 *
 * 1. PKCE Authorization Code Flow (Browser-based)
 *    - Opens browser with authorization URL
 *    - Local callback server receives the code
 *    - More reliable, works even with Cloudflare protection
 *
 * 2. Device Code Flow (Fallback)
 *    - User enters code in browser manually
 *    - Can be blocked by Cloudflare/WAF
 *
 * Implements authentication for:
 * - OpenAI (ChatGPT Plus/Pro subscriptions via Codex)
 * - Gemini (Google account login, same as Gemini CLI)
 */

import { saveCredentialFile } from "./credential-storage.js";
import { createRequestScope } from "../utils/request-scope.js";
import { rethrowCancellation } from "../utils/cancellation.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * OAuth configuration for a provider
 *
 * Note: Gemini OAuth was removed because Google's public OAuth client ID
 * (used by Gemini CLI) is restricted and cannot be used by third-party apps.
 * Use API Key or gcloud ADC for Gemini instead.
 */
export interface OAuthConfig {
  provider: "openai";
  clientId: string;
  /** Authorization endpoint for PKCE flow */
  authorizationEndpoint: string;
  /** Device authorization endpoint (fallback, optional for some providers) */
  deviceAuthEndpoint?: string;
  tokenEndpoint: string;
  scopes: string[];
  /** URL where user enters the code (device flow) */
  verificationUri?: string;
  /** Provider-specific extra params for authorization URL */
  extraAuthParams?: Record<string, string>;
  /** Whether this is a Google OAuth (different token exchange) */
  isGoogleOAuth?: boolean;
}

/**
 * OAuth token response
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
}

/**
 * Device code response from initial request
 */
export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

/**
 * Provider-specific OAuth configurations
 */
export const OAUTH_CONFIGS: Record<string, OAuthConfig> = {
  /**
   * OpenAI OAuth (ChatGPT Plus/Pro subscriptions)
   * Uses the official Codex client ID (same as OpenCode, Codex CLI, etc.)
   */
  openai: {
    provider: "openai",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
    tokenEndpoint: "https://auth.openai.com/oauth/token",
    deviceAuthEndpoint: "https://auth.openai.com/oauth/device/code",
    verificationUri: "https://chatgpt.com/codex/device",
    scopes: ["openid", "profile", "email", "offline_access"],
    extraAuthParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "opencode",
    },
  },

  // NOTE: Gemini OAuth removed - Google's client ID is restricted to official apps
  // Use API Key (https://aistudio.google.com/apikey) or gcloud ADC instead
};

/**
 * Request a device code from the provider
 */
export async function requestDeviceCode(provider: string): Promise<DeviceCodeResponse> {
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    throw new Error(`OAuth not supported for provider: ${provider}`);
  }

  if (!config.deviceAuthEndpoint) {
    throw new Error(
      `Device code flow not supported for provider: ${provider}. Use browser OAuth instead.`,
    );
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(" "),
  });

  // OpenAI requires audience parameter
  if (provider === "openai") {
    body.set("audience", "https://api.openai.com/v1");
  }

  const response = await fetch(config.deviceAuthEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Corbat-Coco CLI",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const error = await response.text();

    // Check if we got an HTML page (Cloudflare block, captcha, etc.)
    if (
      contentType.includes("text/html") ||
      error.includes("<!DOCTYPE") ||
      error.includes("<html")
    ) {
      throw new Error(
        "OAuth request blocked (possibly by Cloudflare).\n" +
          "   This can happen due to network restrictions or rate limiting.\n" +
          "   Please try:\n" +
          "   1. Use an API key instead (recommended)\n" +
          "   2. Wait a few minutes and try again\n" +
          "   3. Try from a different network",
      );
    }

    throw new Error(`Failed to request device code: ${error}`);
  }

  // Verify we got JSON, not HTML
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      throw new Error(
        "OAuth service returned HTML instead of JSON.\n" +
          "   The service may be temporarily unavailable.\n" +
          "   Please use an API key instead, or try again later.",
      );
    }
  }

  const data = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  };

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || config.verificationUri || "",
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  };
}

/**
 * Poll for token after user completes authentication
 */
export async function pollForToken(
  provider: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onPoll?: () => void,
): Promise<OAuthTokens> {
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    throw new Error(`OAuth not supported for provider: ${provider}`);
  }

  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    // Wait for the specified interval
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    if (onPoll) onPoll();

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: config.clientId,
      device_code: deviceCode,
    });

    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token) {
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
        tokenType: data.token_type || "Bearer",
      };
    }

    // Handle different error states
    if (data.error === "authorization_pending") {
      // User hasn't completed auth yet, continue polling
      continue;
    } else if (data.error === "slow_down") {
      // Increase interval
      interval += 5;
      continue;
    } else if (data.error === "expired_token") {
      throw new Error("Device code expired. Please try again.");
    } else if (data.error === "access_denied") {
      throw new Error("Access denied by user.");
    } else if (data.error) {
      throw new Error(data.error_description || data.error);
    }
  }

  throw new Error("Authentication timed out. Please try again.");
}

/**
 * Refresh access token using refresh token. The caller owns cancellation and persistence.
 * A fully decoded rotation is returned even after abort so it can be saved safely.
 */
export async function refreshAccessToken(
  provider: string,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  signal?.throwIfAborted();
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    throw new Error(`OAuth not supported for provider: ${provider}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel();
    signal?.throwIfAborted();
    throw new Error(
      `Token refresh failed (HTTP ${response.status}); stored credentials were preserved.`,
    );
  }

  const data = (await response.json()) as Record<string, unknown> | null;
  if (
    !data ||
    typeof data.access_token !== "string" ||
    !data.access_token.trim() ||
    (data.refresh_token !== undefined &&
      (typeof data.refresh_token !== "string" || !data.refresh_token.trim())) ||
    (data.expires_in !== undefined &&
      (typeof data.expires_in !== "number" ||
        !Number.isFinite(data.expires_in) ||
        !Number.isFinite(Date.now() + data.expires_in * 1000) ||
        data.expires_in <= 0))
  ) {
    throw new Error("Invalid token refresh response; stored credentials were preserved.");
  }
  // A complete valid rotation must reach the caller for persistence, even if
  // cancellation arrived while the already-received body was being decoded.

  return {
    accessToken: data.access_token,
    refreshToken: (data.refresh_token as string | undefined) || refreshToken,
    expiresAt:
      typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
  };
}

/**
 * Token storage path
 */
function getTokenStoragePath(provider: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, ".coco", "tokens", `${provider}.json`);
}

/**
 * Save tokens to disk
 */
export async function saveTokens(provider: string, tokens: OAuthTokens): Promise<void> {
  const filePath = getTokenStoragePath(provider);
  await saveCredentialFile(filePath, tokens);
}

/**
 * Load tokens from disk
 */
export async function loadTokens(provider: string): Promise<OAuthTokens | null> {
  const filePath = getTokenStoragePath(provider);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as OAuthTokens;
  } catch {
    return null;
  }
}

/**
 * Delete stored tokens
 */
export async function deleteTokens(provider: string): Promise<void> {
  const filePath = getTokenStoragePath(provider);

  try {
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist, ignore
  }
}

/**
 * Check if tokens are expired (with 5 minute buffer)
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) return false;
  return Date.now() >= tokens.expiresAt - 5 * 60 * 1000;
}

/** A completed rotation could not be committed to local storage. */
class OAuthPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Failed to save refreshed credentials; previous file was preserved.", { cause });
    this.name = "OAuthPersistenceError";
  }
}

/** Get a valid token with a bounded refresh; preserve completed rotations before abort. */
export async function getValidAccessToken(
  provider: string,
  signal?: AbortSignal,
): Promise<{ accessToken: string; isNew: boolean } | null> {
  const scope = createRequestScope(signal, 30000);
  try {
    if (!OAUTH_CONFIGS[provider]) return null;
    const tokens = await loadTokens(provider);
    scope.signal.throwIfAborted();
    if (!tokens) return null;
    if (!isTokenExpired(tokens)) return { accessToken: tokens.accessToken, isNew: false };
    if (!tokens.refreshToken) return null;
    // Never automatically retry refresh: a lost response may have rotated credentials.
    const newTokens = await refreshAccessToken(provider, tokens.refreshToken, scope.signal);
    // Once a rotation is known, finish the local atomic save before honoring abort.
    // A failed save is reported rather than hidden by a concurrent cancellation.
    try {
      await saveTokens(provider, newTokens);
    } catch (error) {
      throw new OAuthPersistenceError(error);
    }
    scope.signal.throwIfAborted();
    return { accessToken: newTokens.accessToken, isNew: true };
  } catch (error) {
    if (error instanceof OAuthPersistenceError) throw error;
    rethrowCancellation(error, scope.signal);
    throw error;
  } finally {
    scope.dispose();
  }
}

/**
 * Build the authorization URL for PKCE flow
 * This opens in the user's browser
 */
export function buildAuthorizationUrl(
  provider: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    throw new Error(`OAuth not supported for provider: ${provider}`);
  }

  // Base params for OAuth 2.0 PKCE flow
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: state,
  });

  // Add provider-specific extra params
  if (config.extraAuthParams) {
    for (const [key, value] of Object.entries(config.extraAuthParams)) {
      params.set(key, value);
    }
  }

  return `${config.authorizationEndpoint}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens (PKCE flow)
 */
export async function exchangeCodeForTokens(
  provider: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const config = OAUTH_CONFIGS[provider];
  if (!config) {
    throw new Error(`OAuth not supported for provider: ${provider}`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
    id_token?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type || "Bearer",
  };
}
