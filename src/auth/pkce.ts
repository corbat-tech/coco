/**
 * PKCE (Proof Key for Code Exchange) utilities
 *
 * Implements RFC 7636 for secure OAuth 2.0 authorization code flow.
 * Used for browser-based OAuth flows where the client cannot securely store secrets.
 *
 * Flow:
 * 1. Generate a random code_verifier (43-128 chars)
 * 2. Create code_challenge = BASE64URL(SHA256(code_verifier))
 * 3. Send code_challenge in authorization request
 * 4. Send code_verifier in token exchange request
 * 5. Server verifies: SHA256(code_verifier) === code_challenge
 */

import * as crypto from "node:crypto";

/**
 * Generate a cryptographically secure random code verifier
 * RFC 7636 requires 43-128 characters from: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
export function generateCodeVerifier(length = 64): string {
  // Use 32 bytes of randomness, then base64url encode
  // This gives us 43 characters (sufficient for PKCE)
  const randomBytes = crypto.randomBytes(length);
  return base64UrlEncode(randomBytes);
}

/**
 * Generate code challenge from code verifier using S256 method
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(length = 32): string {
  const randomBytes = crypto.randomBytes(length);
  return base64UrlEncode(randomBytes);
}

/**
 * Base64 URL encoding (RFC 4648 § 5)
 * - Replace + with -
 * - Replace / with _
 * - Remove trailing =
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * PKCE credentials for OAuth flow
 */
export interface PKCECredentials {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Generate all PKCE credentials needed for an OAuth flow
 */
export function generatePKCECredentials(): PKCECredentials {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  return {
    codeVerifier,
    codeChallenge,
    state,
  };
}
