import { setTimeout as delay } from "node:timers/promises";
import { cancellationCheckpoint } from "../utils/interactive-cancellation.js";
/**
 * GitHub Copilot Authentication
 *
 * Uses GitHub's OAuth Device Flow to authenticate:
 * 1. Request device code from GitHub
 * 2. User authorizes in browser
 * 3. Poll for GitHub access token
 * 4. Exchange GitHub token for Copilot API token
 *
 * Copilot tokens expire every ~25-30 minutes and are automatically refreshed
 * using the stored GitHub access token.
 *
 * Client ID `Iv1.b507a08c87ecfe98` is the well-known Copilot app ID
 * used by VS Code, opencode, copilot-api, etc.
 */

import { createRequestScope } from "../utils/request-scope.js";
import { rethrowCancellation } from "../utils/cancellation.js";
import { saveCredentialFile } from "./credential-storage.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

/**
 * GitHub Device Code response
 */
export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * GitHub OAuth token response
 */
interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  login?: string;
}

/**
 * Copilot API token response
 */
export interface CopilotToken {
  /** Bearer token for Copilot API */
  token: string;
  /** Seconds until token should be refreshed */
  refresh_in: number;
  /** Unix timestamp when token expires */
  expires_at: number;
  /** Annotations with account type info */
  annotations?: {
    /** "individual", "business", or "enterprise" */
    copilot_plan?: string;
  };
}

/**
 * Stored Copilot credentials
 */
export interface CopilotCredentials {
  /** GitHub OAuth access token (long-lived) */
  githubToken: string;
  /** Current Copilot API token (short-lived, ~25 min) */
  copilotToken?: string;
  /** When the Copilot token expires (epoch ms) */
  copilotTokenExpiresAt?: number;
  /** Account type from last token exchange */
  accountType?: string;
}

/** Well-known Copilot OAuth client ID (same as VS Code, opencode, etc.) */
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

/** GitHub endpoints */
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

/** Copilot API base URLs by account type */
const COPILOT_BASE_URLS: Record<string, string> = {
  individual: "https://api.githubcopilot.com",
  business: "https://api.business.githubcopilot.com",
  enterprise: "https://api.enterprise.githubcopilot.com",
};

/** Default base URL (individual accounts) */
const DEFAULT_COPILOT_BASE_URL = "https://api.githubcopilot.com";

/** Buffer before expiry to trigger refresh (60 seconds) */
const REFRESH_BUFFER_MS = 60_000;
const execFileAsync = promisify(execFile);

/**
 * Error indicating an authentication rejection (401, 403). It does not
 * authorize deleting credentials: intermediaries can also return these statuses.
 * Transient errors like network timeouts or server errors use ordinary Error.
 */
export class CopilotAuthError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
    this.name = "CopilotAuthError";
  }
}

/**
 * Request a device code from GitHub for Copilot authentication
 */
export async function requestGitHubDeviceCode(
  signal?: AbortSignal,
): Promise<GitHubDeviceCodeResponse> {
  signal?.throwIfAborted();
  const response = await cancellationCheckpoint(
    fetch(GITHUB_DEVICE_CODE_URL, {
      signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        scope: "read:user",
      }),
    }),
    signal,
  );

  if (!response.ok) {
    const error = await cancellationCheckpoint(response.text(), signal);
    throw new Error(`GitHub device code request failed: ${response.status} - ${error}`);
  }

  return (await cancellationCheckpoint(response.json(), signal)) as GitHubDeviceCodeResponse;
}

/**
 * Poll GitHub for OAuth access token after user authorization
 */
export async function pollGitHubForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onPoll?: () => void,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const expiresAt = Date.now() + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await cancellationCheckpoint(delay(interval * 1000, undefined, { signal }), signal);

    if (onPoll) onPoll();

    const response = await cancellationCheckpoint(
      fetch(GITHUB_TOKEN_URL, {
        signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: COPILOT_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      }),
      signal,
    );

    const data = (await cancellationCheckpoint(response.json(), signal)) as GitHubTokenResponse;

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      continue;
    } else if (data.error === "slow_down") {
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
 * Exchange a GitHub access token for a Copilot API token
 */
export async function exchangeForCopilotToken(
  githubToken: string,
  signal?: AbortSignal,
): Promise<CopilotToken> {
  signal?.throwIfAborted();
  const response = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    signal,
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "Corbat-Coco/1.0",
    },
  });

  if (!response.ok) {
    await response.body?.cancel();
    signal?.throwIfAborted();

    if (response.status === 401) {
      throw new CopilotAuthError(
        "GitHub token is invalid or expired. Please re-authenticate with /provider copilot.",
        true,
      );
    }

    if (response.status === 403) {
      throw new CopilotAuthError(
        "GitHub Copilot is not enabled for this account.\n" +
          "   Please ensure you have an active Copilot subscription:\n" +
          "   https://github.com/settings/copilot",
        true,
      );
    }

    // Transient errors (5xx, network) — do NOT delete credentials
    throw new Error(`Copilot token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as CopilotToken;
  if (
    !data ||
    typeof data.token !== "string" ||
    !data.token.trim() ||
    !Number.isFinite(data.expires_at) ||
    !Number.isFinite(data.expires_at * 1000) ||
    data.expires_at <= 0
  ) {
    throw new Error("Invalid Copilot token response");
  }
  return data;
}

/**
 * Resolve GitHub login for a token (best-effort, for UX diagnostics).
 */
export async function getGitHubLogin(
  githubToken: string,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const response = await cancellationCheckpoint(
      fetch("https://api.github.com/user", {
        signal,
        method: "GET",
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/json",
          "User-Agent": "Corbat-Coco/1.0",
        },
      }),
      signal,
    );
    if (!response.ok) return null;
    const data = (await cancellationCheckpoint(response.json(), signal)) as GitHubUserResponse;
    return data.login ?? null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

/**
 * Best-effort fallback to GitHub CLI token.
 * Mirrors official Copilot CLI behavior when no direct token is available.
 */
export async function getGitHubCliToken(signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5000,
      signal,
    });
    signal?.throwIfAborted();
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch (error) {
    rethrowCancellation(error, signal);
    return null;
  }
}

/**
 * Get the Copilot API base URL based on account type
 */
export function getCopilotBaseUrl(accountType?: string): string {
  if (accountType && accountType in COPILOT_BASE_URLS) {
    return COPILOT_BASE_URLS[accountType]!;
  }
  return DEFAULT_COPILOT_BASE_URL;
}

// --- Token Storage ---

/**
 * Get the credentials storage path
 */
export function getCopilotCredentialsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, ".coco", "tokens", "copilot.json");
}

/**
 * Save Copilot credentials to disk
 */
export async function saveCopilotCredentials(creds: CopilotCredentials): Promise<void> {
  const filePath = getCopilotCredentialsPath();
  await saveCredentialFile(filePath, creds);
}

/** Zod schema for validating stored credentials */
const CopilotCredentialsSchema = z.object({
  githubToken: z.string().min(1),
  copilotToken: z.string().optional(),
  copilotTokenExpiresAt: z.number().optional(),
  accountType: z.string().optional(),
});

/**
 * Load Copilot credentials from disk.
 * Returns null if file doesn't exist or contents are invalid.
 */
export async function loadCopilotCredentials(): Promise<CopilotCredentials | null> {
  try {
    const content = await fs.readFile(getCopilotCredentialsPath(), "utf-8");
    const parsed = CopilotCredentialsSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Delete stored Copilot credentials
 */
export async function deleteCopilotCredentials(): Promise<void> {
  try {
    await fs.unlink(getCopilotCredentialsPath());
  } catch {
    // File doesn't exist, ignore
  }
}

/**
 * Check if the Copilot token needs refresh
 */
function isCopilotTokenExpired(creds: CopilotCredentials): boolean {
  if (!creds.copilotToken || !creds.copilotTokenExpiresAt) return true;
  return Date.now() >= creds.copilotTokenExpiresAt - REFRESH_BUFFER_MS;
}

/**
 * Exchange for a Copilot token via the `gh` CLI subprocess.
 *
 * This is a fallback for corporate networks that use PAC (Proxy Auto-Config)
 * scripts or TLS interception. Node's fetch (undici) cannot evaluate PAC scripts
 * and may not trust corporate root CAs, while `gh` (Go's HTTP client) handles
 * both transparently. If `gh` is installed and authenticated, this will work
 * in environments where the direct fetch fails.
 *
 * Uses a raw callback (not promisify) so tests can mock execFile cleanly
 * without needing util.promisify.custom semantics.
 */
export async function exchangeForCopilotTokenViaGhCli(
  signal?: AbortSignal,
  githubToken?: string,
): Promise<CopilotToken | null> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["api", "/copilot_internal/v2/token", "--hostname", "github.com"],
      {
        timeout: 10_000,
        signal,
        ...(githubToken ? { env: { ...process.env, GH_TOKEN: githubToken } } : {}),
      },
      (err, stdout) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        if (err || !stdout) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as CopilotToken;
          resolve(
            parsed &&
              typeof parsed.token === "string" &&
              parsed.token.trim() &&
              Number.isFinite(parsed.expires_at) &&
              Number.isFinite(parsed.expires_at * 1000) &&
              parsed.expires_at > 0
              ? parsed
              : null,
          );
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/**
 * Check whether the `gh` CLI is currently authenticated with GitHub.com.
 * Returns the authenticated username or null.
 *
 * Uses raw callback (not promisify) for testability — see exchangeForCopilotTokenViaGhCli.
 */
export function getGitHubCliAuthStatus(signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    execFile(
      "gh",
      ["auth", "status", "--hostname", "github.com"],
      { timeout: 5_000, signal },
      (_err, stdout, stderr) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        // gh auth status writes to stdout on success, stderr on failure in some versions.
        const combined = (stdout ?? "") + (stderr ?? "");
        const match = combined.match(/Logged in to github\.com account (\S+)/);
        if (match) {
          resolve(match[1]!);
          return;
        }
        if (combined.includes("Logged in")) {
          resolve("authenticated");
          return;
        }
        resolve(null);
      },
    );
  });
}

/**
 * Get a valid Copilot API token, refreshing if necessary.
 *
 * Returns the bearer token and base URL to use for API calls.
 * Missing credentials return null; failed exchanges preserve credentials and reject.
 *
 * On corporate networks using PAC proxies or TLS interception, Node's
 * direct fetch may fail even if the user has a valid subscription. In that
 * case we try `gh api` with the same GitHub token; failure is not proof that
 * stored credentials should be deleted.
 */
export async function getValidCopilotToken(signal?: AbortSignal): Promise<{
  token: string;
  baseUrl: string;
  isNew: boolean;
} | null> {
  const scope = createRequestScope(signal, 30000);
  let saving = false;
  try {
    const creds = await loadCopilotCredentials();
    scope.signal.throwIfAborted();
    if (creds && !isCopilotTokenExpired(creds) && creds.copilotToken) {
      return {
        token: creds.copilotToken,
        baseUrl: getCopilotBaseUrl(creds.accountType),
        isNew: false,
      };
    }
    const envToken =
      process.env["COPILOT_GITHUB_TOKEN"] || process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"];
    const githubToken = envToken || creds?.githubToken || (await getGitHubCliToken(scope.signal));
    scope.signal.throwIfAborted();
    if (!githubToken) return null;
    let copilotToken: CopilotToken;
    try {
      copilotToken = await exchangeForCopilotToken(githubToken, scope.signal);
    } catch (error) {
      rethrowCancellation(error, scope.signal);
      // A CLI failure is not proof that saved credentials are invalid.
      const fallback = await exchangeForCopilotTokenViaGhCli(scope.signal, githubToken);
      scope.signal.throwIfAborted();
      if (!fallback) throw error;
      copilotToken = fallback;
    }
    const updatedCreds: CopilotCredentials = {
      githubToken,
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expires_at * 1000,
      accountType: copilotToken.annotations?.copilot_plan ?? creds?.accountType,
    };
    saving = true;
    await saveCopilotCredentials(updatedCreds);
    saving = false;
    scope.signal.throwIfAborted();
    return {
      token: copilotToken.token,
      baseUrl: getCopilotBaseUrl(updatedCreds.accountType),
      isNew: true,
    };
  } catch (error) {
    if (!saving) rethrowCancellation(error, scope.signal);
    throw error;
  } finally {
    scope.dispose();
  }
}
