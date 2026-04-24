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
 * Error indicating the GitHub token is permanently invalid and credentials
 * should be deleted. Only thrown for definitive auth failures (401, 403),
 * never for transient errors like network timeouts or server errors.
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
export async function requestGitHubDeviceCode(): Promise<GitHubDeviceCodeResponse> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub device code request failed: ${response.status} - ${error}`);
  }

  return (await response.json()) as GitHubDeviceCodeResponse;
}

/**
 * Poll GitHub for OAuth access token after user authorization
 */
export async function pollGitHubForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onPoll?: () => void,
): Promise<string> {
  const expiresAt = Date.now() + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    if (onPoll) onPoll();

    const response = await fetch(GITHUB_TOKEN_URL, {
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
    });

    const data = (await response.json()) as GitHubTokenResponse;

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
export async function exchangeForCopilotToken(githubToken: string): Promise<CopilotToken> {
  const response = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "Corbat-Coco/1.0",
    },
  });

  if (!response.ok) {
    const error = await response.text();

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
    throw new Error(`Copilot token exchange failed: ${response.status} - ${error}`);
  }

  return (await response.json()) as CopilotToken;
}

/**
 * Resolve GitHub login for a token (best-effort, for UX diagnostics).
 */
export async function getGitHubLogin(githubToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/json",
        "User-Agent": "Corbat-Coco/1.0",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as GitHubUserResponse;
    return data.login ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort fallback to GitHub CLI token.
 * Mirrors official Copilot CLI behavior when no direct token is available.
 */
export async function getGitHubCliToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 5000 });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
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
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
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
export function exchangeForCopilotTokenViaGhCli(): Promise<CopilotToken | null> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["api", "/copilot_internal/v2/token"],
      { timeout: 10_000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as CopilotToken;
          resolve(parsed.token && parsed.expires_at ? parsed : null);
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
export function getGitHubCliAuthStatus(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["auth", "status", "--hostname", "github.com"],
      { timeout: 5_000 },
      (_err, stdout, stderr) => {
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
 * If credentials are missing or GitHub token is invalid, returns null.
 *
 * On corporate networks using PAC proxies or TLS interception, Node's
 * direct fetch may fail even if the user has a valid subscription. In that
 * case we fall back to `gh api` which uses Go's HTTP client (PAC-aware,
 * system-CA-aware) before concluding that credentials are invalid.
 */
export async function getValidCopilotToken(): Promise<{
  token: string;
  baseUrl: string;
  isNew: boolean;
} | null> {
  const creds = await loadCopilotCredentials();
  const envToken =
    process.env["COPILOT_GITHUB_TOKEN"] || process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"];
  const fallbackGhToken = await getGitHubCliToken();
  const githubToken = envToken || creds?.githubToken || fallbackGhToken;
  if (!githubToken) return null;

  // Check if current Copilot token is still valid
  if (creds && !isCopilotTokenExpired(creds) && creds.copilotToken) {
    return {
      token: creds.copilotToken,
      baseUrl: getCopilotBaseUrl(creds.accountType),
      isNew: false,
    };
  }

  // Helper: save and return a freshly-obtained Copilot token
  const saveAndReturn = async (copilotToken: CopilotToken) => {
    const updatedCreds: CopilotCredentials = {
      ...(creds ?? { githubToken }),
      githubToken: creds?.githubToken ?? githubToken,
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expires_at * 1000,
      accountType: copilotToken.annotations?.copilot_plan ?? creds?.accountType,
    };
    await saveCopilotCredentials(updatedCreds);
    return {
      token: copilotToken.token,
      baseUrl: getCopilotBaseUrl(updatedCreds.accountType),
      isNew: true,
    };
  };

  // Need to refresh the Copilot token — try direct fetch first
  try {
    const copilotToken = await exchangeForCopilotToken(githubToken);
    return saveAndReturn(copilotToken);
  } catch (error) {
    if (error instanceof CopilotAuthError && error.permanent) {
      // 403 received — could be from a corporate proxy, not from GitHub.
      // Try `gh api` before concluding the credentials are invalid.
      const ghCliToken = await exchangeForCopilotTokenViaGhCli();
      if (ghCliToken) {
        return saveAndReturn(ghCliToken);
      }
      // Both direct fetch and gh cli confirm auth failure → delete credentials
      await deleteCopilotCredentials();
      return null;
    }

    // Network / transient error — also try gh api fallback before re-throwing.
    // This covers PAC proxy environments where Node's fetch cannot route the
    // request but gh's Go HTTP client can.
    const ghCliToken = await exchangeForCopilotTokenViaGhCli();
    if (ghCliToken) {
      return saveAndReturn(ghCliToken);
    }

    // Both paths failed — re-throw original error so the retry layer handles it
    throw error;
  }
}
