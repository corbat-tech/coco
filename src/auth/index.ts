/**
 * Authentication Module
 *
 * Provides multiple authentication methods for AI providers:
 *
 * 1. Browser OAuth with PKCE (recommended)
 *    - Opens browser for user to authenticate
 *    - Local callback server receives authorization code
 *    - Works reliably even with Cloudflare protection
 *
 * 2. Device Code Flow (fallback)
 *    - User enters code manually in browser
 *    - Can be blocked by Cloudflare/WAF
 *
 * 3. API Key (manual)
 *    - User pastes API key directly
 *
 * 4. Google Cloud ADC
 *    - Uses gcloud auth application-default login
 *
 * Supports:
 * - OpenAI (Browser OAuth + Device Code + API key)
 * - Google Gemini (gcloud ADC + API key)
 */

export {
  // Types
  type OAuthConfig,
  type OAuthTokens,
  type DeviceCodeResponse,
  // Configs
  OAUTH_CONFIGS,
  // Device code flow
  requestDeviceCode,
  pollForToken,
  refreshAccessToken,
  // PKCE flow (browser-based)
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  // Token storage
  saveTokens,
  loadTokens,
  deleteTokens,
  isTokenExpired,
  getValidAccessToken,
} from "./oauth.js";

// PKCE utilities
export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generatePKCECredentials,
  type PKCECredentials,
} from "./pkce.js";

// Callback server for browser OAuth
export {
  createCallbackServer,
  startCallbackServer,
  OAUTH_CALLBACK_PORT,
  type CallbackResult,
} from "./callback-server.js";

export { runOAuthFlow, supportsOAuth, isOAuthConfigured, getOrRefreshOAuthToken } from "./flow.js";

// Google Cloud ADC support
export {
  isGcloudInstalled,
  hasADCCredentials,
  isADCConfigured,
  getADCAccessToken,
  getGeminiADCKey,
  getCachedADCToken,
  clearADCCache,
  runGcloudADCLogin,
  type ADCToken,
} from "./gcloud.js";
