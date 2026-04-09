/**
 * Google Cloud Application Default Credentials (ADC) Support
 *
 * Coco can reuse ADC that already exists on the machine via:
 *   gcloud auth application-default print-access-token
 *
 * For Gemini API, Google's current OAuth guide requires a manually-created
 * OAuth client (`client_secret.json`) plus explicit scopes. Coco does not
 * provision that flow automatically, so the CLI should only reuse existing
 * ADC and otherwise point the user to manual setup.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

/**
 * ADC token response
 */
export interface ADCToken {
  accessToken: string;
  expiresAt?: number;
}

export type ADCStatus = "ok" | "missing" | "scope_not_consented" | "error";

export interface ADCCheckResult {
  status: ADCStatus;
  token: ADCToken | null;
  message?: string;
  suggestion?: string;
}

/**
 * ADC credentials file structure
 */
interface ADCCredentials {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  type?: string;
}

const PRINT_ACCESS_TOKEN_COMMAND = "gcloud auth application-default print-access-token";
const ADC_LOGIN_COMMAND = "gcloud auth application-default login";
const GEMINI_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
].join(",");

/**
 * Get the path to ADC credentials file
 */
function getADCPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  // Check for custom path via env var
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  // Default location
  return path.join(home, ".config", "gcloud", "application_default_credentials.json");
}

/**
 * Check if gcloud CLI is installed
 */
export async function isGcloudInstalled(): Promise<boolean> {
  try {
    await execAsync("gcloud --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ADC credentials file exists
 */
export async function hasADCCredentials(): Promise<boolean> {
  const adcPath = getADCPath();

  try {
    await fs.access(adcPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get access token from gcloud CLI
 * Uses: gcloud auth application-default print-access-token
 */
export async function inspectADC(): Promise<ADCCheckResult> {
  try {
    const { stdout } = await execAsync(PRINT_ACCESS_TOKEN_COMMAND, {
      timeout: 10000,
    });

    const accessToken = stdout.trim();
    if (!accessToken) {
      return {
        status: "missing",
        token: null,
        message: "gcloud ADC is not configured.",
        suggestion: `Run \`${ADC_LOGIN_COMMAND}\` manually, then retry Coco.`,
      };
    }

    // Access tokens typically expire in 1 hour
    const expiresAt = Date.now() + 55 * 60 * 1000; // 55 minutes buffer

    return {
      status: "ok",
      token: {
        accessToken,
        expiresAt,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("scope is required but not consented")) {
      return {
        status: "scope_not_consented",
        token: null,
        message:
          "gcloud ADC exists, but the required Google scope was not consented for this account.",
        suggestion:
          "For Vertex AI, rerun `gcloud auth application-default login` manually. " +
          "For Gemini API OAuth, follow Google's OAuth guide with your own OAuth client and run " +
          `\`gcloud auth application-default login --client-id-file=client_secret.json --scopes='${GEMINI_OAUTH_SCOPES}'\`. ` +
          "Otherwise use a Gemini API key in Coco.",
      };
    }

    if (
      message.includes("not logged in") ||
      message.includes("no application default credentials")
    ) {
      return {
        status: "missing",
        token: null,
        message: "No application default credentials were found for gcloud.",
        suggestion: `Run \`${ADC_LOGIN_COMMAND}\` manually, then retry Coco.`,
      };
    }

    return {
      status: "error",
      token: null,
      message,
      suggestion: `Try \`${PRINT_ACCESS_TOKEN_COMMAND}\` in your terminal to inspect the local ADC state.`,
    };
  }
}

/**
 * Get access token from gcloud CLI
 * Uses: gcloud auth application-default print-access-token
 */
export async function getADCAccessToken(): Promise<ADCToken | null> {
  const result = await inspectADC();
  return result.token;
}

/**
 * Read ADC credentials from file (for refresh token)
 */
export async function readADCCredentials(): Promise<ADCCredentials | null> {
  const adcPath = getADCPath();

  try {
    const content = await fs.readFile(adcPath, "utf-8");
    return JSON.parse(content) as ADCCredentials;
  } catch {
    return null;
  }
}

/**
 * Check if gcloud ADC is configured and working
 */
export async function isADCConfigured(): Promise<boolean> {
  // First check if credentials file exists
  const hasCredentials = await hasADCCredentials();
  if (!hasCredentials) return false;

  const result = await inspectADC();
  return result.status === "ok" && result.token !== null;
}

/**
 * Run gcloud auth application-default login
 * Opens browser for user to authenticate with Google account
 */
export async function runGcloudADCLogin(): Promise<boolean> {
  try {
    // Prefer browser-based flow first for smoother UX.
    await execAsync(ADC_LOGIN_COMMAND, {
      timeout: 300000, // 5 minutes for interactive auth
    });
    return true;
  } catch {
    try {
      // Fallback for headless environments where browser launch is unavailable.
      await execAsync(`${ADC_LOGIN_COMMAND} --no-launch-browser`, {
        timeout: 300000,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get Gemini API key via ADC
 * Uses the access token as the API key for Gemini
 */
export async function getGeminiADCKey(): Promise<string | null> {
  const token = await getADCAccessToken();
  if (!token) return null;
  return token.accessToken;
}

/**
 * Cache for ADC token to avoid repeated gcloud calls
 */
let cachedToken: ADCToken | null = null;

/**
 * Get cached or fresh ADC token
 * Refreshes automatically when expired
 */
export async function getCachedADCToken(): Promise<ADCToken | null> {
  // Check if cached token is still valid
  if (cachedToken && cachedToken.expiresAt && Date.now() < cachedToken.expiresAt) {
    return cachedToken;
  }

  // Get fresh token
  cachedToken = await getADCAccessToken();
  return cachedToken;
}

/**
 * Clear the cached token
 */
export function clearADCCache(): void {
  cachedToken = null;
}
