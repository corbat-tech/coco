/**
 * Authentication module for providers
 * Supports API keys and OAuth 2.0 with PKCE
 */

export {
  generatePKCE,
  generateState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  openBrowser,
  startCallbackServer,
  browserOAuthFlow,
  requestDeviceCode,
  pollForDeviceTokens,
  deviceCodeOAuthFlow,
  type OAuthConfig,
  type OAuthTokens,
  type PKCEPair,
  type DeviceCodeResponse,
} from "./oauth.js";

export {
  saveToken,
  getToken,
  getValidToken,
  deleteToken,
  listTokens,
  hasToken,
  clearAllTokens,
  type StoredToken,
} from "./token-store.js";

/**
 * Provider-specific OAuth configurations
 */
export const OAUTH_CONFIGS = {
  /**
   * OpenAI OAuth config (for ChatGPT Plus/Pro)
   * Uses the same auth as Codex CLI
   */
  openai: {
    authorizationUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    deviceAuthorizationUrl: "https://auth.openai.com/oauth/device/code",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann", // Codex CLI public client
    redirectUri: "http://localhost:8090/callback",
    scopes: ["openid", "profile", "email"],
  },

  /**
   * Anthropic OAuth config
   * For console login and API key generation
   */
  anthropic: {
    authorizationUrl: "https://console.anthropic.com/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    clientId: "coco-cli", // Will need to register
    redirectUri: "http://localhost:8090/callback",
    scopes: ["org:create_api_key", "user:profile"],
  },

  /**
   * Google OAuth config (for Gemini)
   */
  google: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: "", // Requires registration with Google
    redirectUri: "http://localhost:8090/callback",
    scopes: [
      "https://www.googleapis.com/auth/generative-language.retriever",
      "https://www.googleapis.com/auth/cloud-platform",
    ],
  },
} as const;

/**
 * Authentication method types
 */
export type AuthMethod = "api_key" | "oauth_browser" | "oauth_device" | "gcloud";

/**
 * Get available auth methods for a provider
 */
export function getAuthMethods(provider: string): AuthMethod[] {
  switch (provider) {
    case "openai":
      return ["api_key", "oauth_browser", "oauth_device"];
    case "anthropic":
      return ["api_key"]; // OAuth not yet fully supported
    case "gemini":
      return ["api_key", "gcloud"];
    case "kimi":
    case "kimi-code":
      return ["api_key"];
    case "lmstudio":
    case "ollama":
      return ["api_key"]; // Optional token auth
    default:
      return ["api_key"];
  }
}
