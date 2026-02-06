/**
 * Google Cloud Application Default Credentials (ADC) Support
 *
 * Provides authentication via gcloud CLI for Gemini API
 * Users can run: gcloud auth application-default login
 * Then use Gemini without needing an explicit API key
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

/**
 * ADC credentials file structure
 */
interface ADCCredentials {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  type?: string;
}

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
export async function getADCAccessToken(): Promise<ADCToken | null> {
  try {
    const { stdout } = await execAsync("gcloud auth application-default print-access-token", {
      timeout: 10000,
    });

    const accessToken = stdout.trim();
    if (!accessToken) return null;

    // Access tokens typically expire in 1 hour
    const expiresAt = Date.now() + 55 * 60 * 1000; // 55 minutes buffer

    return {
      accessToken,
      expiresAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for common errors
    if (
      message.includes("not logged in") ||
      message.includes("no application default credentials")
    ) {
      return null;
    }

    // gcloud not found or other error
    return null;
  }
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

  // Try to get an access token
  const token = await getADCAccessToken();
  return token !== null;
}

/**
 * Run gcloud auth application-default login
 * Opens browser for user to authenticate with Google account
 */
export async function runGcloudADCLogin(): Promise<boolean> {
  try {
    // This command opens a browser window
    await execAsync("gcloud auth application-default login --no-launch-browser", {
      timeout: 120000, // 2 minute timeout for manual login
    });
    return true;
  } catch {
    return false;
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
