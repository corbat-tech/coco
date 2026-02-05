/**
 * Secure token storage for OAuth tokens
 * Stores tokens in ~/.config/coco/auth.json with restricted permissions
 */

import { readFile, writeFile, mkdir, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { OAuthTokens } from "./oauth.js";

/**
 * Stored token data with metadata
 */
export interface StoredToken extends OAuthTokens {
  provider: string;
  createdAt: number;
  expiresAt?: number;
}

/**
 * Token store structure
 */
interface TokenStoreData {
  version: number;
  tokens: Record<string, StoredToken>;
}

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return join(xdgConfig, "coco");
  }
  return join(homedir(), ".config", "coco");
}

/**
 * Get the token store file path
 */
function getTokenStorePath(): string {
  return join(getConfigDir(), "auth.json");
}

/**
 * Ensure config directory exists with secure permissions
 */
async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (error) {
    // Directory might already exist
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Load token store from disk
 */
async function loadTokenStore(): Promise<TokenStoreData> {
  const path = getTokenStorePath();

  try {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content) as TokenStoreData;

    // Validate version
    if (data.version !== 1) {
      // Future: handle migration
      return { version: 1, tokens: {} };
    }

    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, tokens: {} };
    }
    throw error;
  }
}

/**
 * Save token store to disk with secure permissions
 */
async function saveTokenStore(data: TokenStoreData): Promise<void> {
  await ensureConfigDir();

  const path = getTokenStorePath();
  const content = JSON.stringify(data, null, 2);

  await writeFile(path, content, { mode: 0o600 });
}

/**
 * Save a token for a provider
 */
export async function saveToken(
  provider: string,
  tokens: OAuthTokens,
): Promise<void> {
  const store = await loadTokenStore();

  const createdAt = Date.now();
  const expiresAt = tokens.expiresIn
    ? createdAt + tokens.expiresIn * 1000
    : undefined;

  store.tokens[provider] = {
    ...tokens,
    provider,
    createdAt,
    expiresAt,
  };

  await saveTokenStore(store);
}

/**
 * Get a token for a provider
 */
export async function getToken(provider: string): Promise<StoredToken | null> {
  const store = await loadTokenStore();
  return store.tokens[provider] ?? null;
}

/**
 * Get a valid access token, refreshing if needed
 */
export async function getValidToken(
  provider: string,
  refreshFn?: (refreshToken: string) => Promise<OAuthTokens>,
): Promise<string | null> {
  const token = await getToken(provider);

  if (!token) {
    return null;
  }

  // Check if token is expired or will expire soon (5 minute buffer)
  const now = Date.now();
  const expirationBuffer = 5 * 60 * 1000; // 5 minutes

  if (token.expiresAt && token.expiresAt - expirationBuffer < now) {
    // Token is expired or will expire soon
    if (token.refreshToken && refreshFn) {
      try {
        const newTokens = await refreshFn(token.refreshToken);
        await saveToken(provider, newTokens);
        return newTokens.accessToken;
      } catch {
        // Refresh failed, token is invalid
        await deleteToken(provider);
        return null;
      }
    }
    // No refresh token, token is invalid
    await deleteToken(provider);
    return null;
  }

  return token.accessToken;
}

/**
 * Delete a token for a provider
 */
export async function deleteToken(provider: string): Promise<void> {
  const store = await loadTokenStore();
  delete store.tokens[provider];
  await saveTokenStore(store);
}

/**
 * List all stored tokens
 */
export async function listTokens(): Promise<StoredToken[]> {
  const store = await loadTokenStore();
  return Object.values(store.tokens);
}

/**
 * Check if a token exists for a provider
 */
export async function hasToken(provider: string): Promise<boolean> {
  const token = await getToken(provider);
  return token !== null;
}

/**
 * Clear all stored tokens
 */
export async function clearAllTokens(): Promise<void> {
  await saveTokenStore({ version: 1, tokens: {} });
}
