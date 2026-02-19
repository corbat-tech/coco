/**
 * OAuth 2.0 + PKCE authentication utilities
 * Supports browser-based and device code flows
 */

import { randomBytes, createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWSL } from "../../utils/platform.js";

const execFileAsync = promisify(execFile);

/**
 * OAuth configuration for a provider
 */
export interface OAuthConfig {
  /** Authorization endpoint URL */
  authorizationUrl: string;
  /** Token endpoint URL */
  tokenUrl: string;
  /** Client ID (public) */
  clientId: string;
  /** Redirect URI for callback */
  redirectUri: string;
  /** OAuth scopes to request */
  scopes: string[];
  /** Device authorization endpoint (optional, for device code flow) */
  deviceAuthorizationUrl?: string;
}

/**
 * OAuth tokens returned after authentication
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
}

/**
 * PKCE code verifier and challenge
 */
export interface PKCEPair {
  verifier: string;
  challenge: string;
}

/**
 * Device code response
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
 * Generate PKCE code verifier and challenge
 */
export function generatePKCE(): PKCEPair {
  // Generate 32 random bytes for verifier
  const verifier = randomBytes(32)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 43);

  // Create SHA256 hash of verifier for challenge
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
}

/**
 * Generate random state for CSRF protection
 */
export function generateState(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Build authorization URL with PKCE
 */
export function buildAuthorizationUrl(config: OAuthConfig, pkce: PKCEPair, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  });

  return `${config.authorizationUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  pkce: PKCEPair,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: pkce.verifier,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
    tokenType: data.token_type as string,
    scope: data.scope as string | undefined,
  };
}

/**
 * Refresh an access token
 */
export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresIn: data.expires_in as number,
    tokenType: data.token_type as string,
    scope: data.scope as string | undefined,
  };
}

/**
 * Open URL in default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      await execFileAsync("open", [url]);
    } else if (platform === "win32" || isWSL) {
      // Native Windows or WSL: delegate to Windows browser via cmd.exe
      await execFileAsync("cmd.exe", ["/c", "start", "", url]);
    } else {
      await execFileAsync("xdg-open", [url]);
    }
  } catch {
    // Silently fail if browser can't be opened
    // User will see the URL printed in console
  }
}

/**
 * Start local HTTP server to receive OAuth callback
 */
export function startCallbackServer(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timeout: NodeJS.Timeout | null = null;
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      server.close();
      fn();
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          // Escape error to prevent reflected XSS
          const safeError = error
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#x27;");
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>Error: ${safeError}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          finish(() => reject(new Error(`OAuth error: ${error}`)));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>Invalid state parameter (possible CSRF attack).</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          finish(() => reject(new Error("Invalid state parameter")));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>No authorization code received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          finish(() => reject(new Error("No authorization code")));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Authentication Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
        `);
        finish(() => resolve(code));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port);
    server.on("error", (error) => {
      finish(() => reject(error));
    });

    // Timeout after 5 minutes
    timeout = setTimeout(
      () => {
        finish(() => reject(new Error("Authentication timeout")));
      },
      5 * 60 * 1000,
    );
    if (typeof timeout.unref === "function") {
      timeout.unref();
    }
  });
}

/**
 * Perform browser-based OAuth flow with PKCE
 */
export async function browserOAuthFlow(
  config: OAuthConfig,
  onUrlReady?: (url: string) => void,
): Promise<OAuthTokens> {
  const pkce = generatePKCE();
  const state = generateState();

  // Parse port from redirect URI
  const redirectUrl = new URL(config.redirectUri);
  const port = parseInt(redirectUrl.port, 10) || 8090;

  // Start callback server
  const codePromise = startCallbackServer(port, state);

  // Build authorization URL
  const authUrl = buildAuthorizationUrl(config, pkce, state);

  // Notify caller about URL (for display)
  onUrlReady?.(authUrl);

  // Open browser
  await openBrowser(authUrl);

  // Wait for callback
  const code = await codePromise;

  // Exchange code for tokens
  return exchangeCodeForTokens(config, code, pkce);
}

/**
 * Request device code for device code flow
 */
export async function requestDeviceCode(config: OAuthConfig): Promise<DeviceCodeResponse> {
  if (!config.deviceAuthorizationUrl) {
    throw new Error("Device authorization URL not configured");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(" "),
  });

  const response = await fetch(config.deviceAuthorizationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Device code request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  return {
    deviceCode: data.device_code as string,
    userCode: data.user_code as string,
    verificationUri: data.verification_uri as string,
    verificationUriComplete: data.verification_uri_complete as string | undefined,
    expiresIn: data.expires_in as number,
    interval: (data.interval as number) ?? 5,
  };
}

/**
 * Poll for tokens in device code flow
 */
export async function pollForDeviceTokens(
  config: OAuthConfig,
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<OAuthTokens> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    });

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (response.ok) {
      return {
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string,
        expiresIn: data.expires_in as number,
        tokenType: data.token_type as string,
        scope: data.scope as string | undefined,
      };
    }

    // Check for pending authorization
    if (data.error === "authorization_pending") {
      continue;
    }

    // Check for slow down request
    if (data.error === "slow_down") {
      interval = Math.min(interval + 5, 30);
      continue;
    }

    // Other errors are fatal
    throw new Error(`Device token polling failed: ${data.error} - ${data.error_description}`);
  }

  throw new Error("Device code expired");
}

/**
 * Perform device code OAuth flow
 */
export async function deviceCodeOAuthFlow(
  config: OAuthConfig,
  onCodeReady?: (code: DeviceCodeResponse) => void,
): Promise<OAuthTokens> {
  const deviceCode = await requestDeviceCode(config);

  // Notify caller about the code
  onCodeReady?.(deviceCode);

  // Poll for tokens
  return pollForDeviceTokens(
    config,
    deviceCode.deviceCode,
    deviceCode.interval,
    deviceCode.expiresIn,
  );
}
