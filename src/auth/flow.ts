/**
 * OAuth Flow Implementation
 *
 * High-level authentication flow for CLI using PKCE (browser-based)
 *
 * Flow:
 * 1. Start local callback server on random port
 * 2. Generate PKCE credentials (code_verifier, code_challenge, state)
 * 3. Open browser with authorization URL
 * 4. User authenticates in browser
 * 5. Callback server receives authorization code
 * 6. Exchange code for tokens
 * 7. Save tokens securely
 *
 * Supports:
 * - OpenAI (ChatGPT Plus/Pro subscriptions)
 *
 * Note: Gemini OAuth was removed - Google's client ID is restricted to official apps.
 * Use API Key (https://aistudio.google.com/apikey) or gcloud ADC for Gemini.
 *
 * Falls back to Device Code flow or API key if browser flow fails
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import {
  OAUTH_CONFIGS,
  saveTokens,
  loadTokens,
  getValidAccessToken,
  requestDeviceCode,
  pollForToken,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  type OAuthTokens,
} from "./oauth.js";
import { generatePKCECredentials } from "./pkce.js";
import { createCallbackServer } from "./callback-server.js";

const execAsync = promisify(exec);

/**
 * Map provider to its OAuth config name
 * Codex uses the same OAuth config as openai
 */
function getOAuthProviderName(provider: string): string {
  if (provider === "codex") return "openai";
  return provider;
}

/**
 * Get provider display info for UI
 */
function getProviderDisplayInfo(provider: string): {
  name: string;
  emoji: string;
  authDescription: string;
  apiKeyUrl: string;
} {
  const oauthProvider = getOAuthProviderName(provider);

  switch (oauthProvider) {
    case "openai":
      return {
        name: "OpenAI",
        emoji: "🟢",
        authDescription: "Sign in with your ChatGPT account",
        apiKeyUrl: "https://platform.openai.com/api-keys",
      };
    default:
      // Generic fallback (Gemini OAuth removed - use API key or gcloud ADC)
      return {
        name: provider,
        emoji: "🔐",
        authDescription: "Sign in with your account",
        apiKeyUrl: "",
      };
  }
}

/**
 * Check if a provider supports OAuth
 */
export function supportsOAuth(provider: string): boolean {
  const oauthProvider = getOAuthProviderName(provider);
  return oauthProvider in OAUTH_CONFIGS;
}

/**
 * Check if OAuth is already configured for a provider
 */
export async function isOAuthConfigured(provider: string): Promise<boolean> {
  const oauthProvider = getOAuthProviderName(provider);
  const tokens = await loadTokens(oauthProvider);
  return tokens !== null;
}

/**
 * Open URL in browser (cross-platform)
 */
async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      await execAsync(`open "${url}"`);
    } else if (platform === "win32") {
      await execAsync(`start "" "${url}"`);
    } else {
      await execAsync(`xdg-open "${url}"`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback browser open methods
 * Tries multiple approaches for stubborn systems
 */
async function openBrowserFallback(url: string): Promise<boolean> {
  const platform = process.platform;
  const commands: string[] = [];

  if (platform === "darwin") {
    commands.push(
      `open "${url}"`,
      `open -a Safari "${url}"`,
      `open -a "Google Chrome" "${url}"`,
    );
  } else if (platform === "win32") {
    commands.push(
      `start "" "${url}"`,
      `rundll32 url.dll,FileProtocolHandler ${url}`,
    );
  } else {
    // Linux - try multiple browsers
    commands.push(
      `xdg-open "${url}"`,
      `sensible-browser "${url}"`,
      `x-www-browser "${url}"`,
      `gnome-open "${url}"`,
      `firefox "${url}"`,
      `chromium-browser "${url}"`,
      `google-chrome "${url}"`,
    );
  }

  for (const cmd of commands) {
    try {
      await execAsync(cmd);
      return true;
    } catch {
      // Try next method
      continue;
    }
  }

  return false;
}

/**
 * Run OAuth authentication flow
 *
 * This uses PKCE (browser-based) as the primary method:
 * 1. Starts local server for callback
 * 2. Opens browser with auth URL
 * 3. Receives callback with authorization code
 * 4. Exchanges code for tokens
 *
 * Falls back to Device Code flow or API key if browser flow fails
 */
export async function runOAuthFlow(
  provider: string,
): Promise<{ tokens: OAuthTokens; accessToken: string } | null> {
  // Map codex to openai for OAuth config (they share the same auth)
  const oauthProvider = getOAuthProviderName(provider);
  const config = OAUTH_CONFIGS[oauthProvider];
  if (!config) {
    p.log.error(`OAuth not supported for provider: ${provider}`);
    return null;
  }

  const displayInfo = getProviderDisplayInfo(provider);

  // Show auth method selection
  console.log();
  console.log(chalk.magenta("   ┌─────────────────────────────────────────────────┐"));
  console.log(chalk.magenta("   │ ") + chalk.bold.white(`${displayInfo.emoji} ${displayInfo.name} Authentication`.padEnd(47)) + chalk.magenta("│"));
  console.log(chalk.magenta("   └─────────────────────────────────────────────────┘"));
  console.log();

  const authOptions = [
    {
      value: "browser",
      label: "🌐 Sign in with browser",
      hint: `${displayInfo.authDescription} (recommended)`,
    },
    {
      value: "api_key",
      label: "📋 Paste API key manually",
      hint: `Get from ${displayInfo.apiKeyUrl}`,
    },
  ];

  const authMethod = await p.select({
    message: "Choose authentication method:",
    options: authOptions,
  });

  if (p.isCancel(authMethod)) return null;

  if (authMethod === "browser") {
    return runBrowserOAuthFlow(provider);
  } else {
    return runApiKeyFlow(provider);
  }
}

/**
 * Check if a specific port is available
 */
async function isPortAvailable(port: number): Promise<{ available: boolean; processName?: string }> {
  const net = await import("node:net");

  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ available: false, processName: "another process" });
      } else {
        resolve({ available: false });
      }
    });

    server.once("listening", () => {
      server.close();
      resolve({ available: true });
    });

    server.listen(port, "127.0.0.1");
  });
}

/**
 * Get required port for provider (some providers need specific ports)
 * Returns undefined if any port is acceptable
 */
function getRequiredPort(provider: string): number | undefined {
  const oauthProvider = getOAuthProviderName(provider);
  // OpenAI requires port 1455
  if (oauthProvider === "openai") return 1455;
  // Gemini and others can use any available port
  return undefined;
}

/**
 * Run Browser-based OAuth flow with PKCE
 * This is the recommended method - more reliable than Device Code
 */
async function runBrowserOAuthFlow(
  provider: string,
): Promise<{ tokens: OAuthTokens; accessToken: string } | null> {
  // Map codex to openai for OAuth (they share the same auth)
  const oauthProvider = getOAuthProviderName(provider);
  const displayInfo = getProviderDisplayInfo(provider);
  const config = OAUTH_CONFIGS[oauthProvider];

  // Check if this provider requires a specific port
  const requiredPort = getRequiredPort(provider);

  if (requiredPort) {
    console.log();
    console.log(chalk.dim("   Checking port availability..."));

    const portCheck = await isPortAvailable(requiredPort);

    if (!portCheck.available) {
      console.log();
      console.log(chalk.yellow(`   ⚠ Port ${requiredPort} is already in use`));
      console.log();
      console.log(chalk.dim(`   ${displayInfo.name} OAuth requires port ${requiredPort}, which is currently occupied.`));
      console.log(chalk.dim("   This usually means OpenCode or another coding tool is running."));
      console.log();
      console.log(chalk.cyan("   To fix this:"));
      console.log(chalk.dim("   1. Close OpenCode/Codex CLI (if running)"));
      console.log(chalk.dim("   2. Or use an API key instead (recommended if using multiple tools)"));
      console.log();

      const fallbackOptions = [
        {
          value: "api_key",
          label: "📋 Use API key instead",
          hint: `Get from ${displayInfo.apiKeyUrl}`,
        },
        {
          value: "retry",
          label: "🔄 Retry (after closing other tools)",
          hint: "Check port again",
        },
      ];

      // Only add device code option if provider supports it
      if (config?.deviceAuthEndpoint) {
        fallbackOptions.push({
          value: "device_code",
          label: "🔑 Try device code flow",
          hint: "May be blocked by Cloudflare",
        });
      }

      fallbackOptions.push({
        value: "cancel",
        label: "❌ Cancel",
        hint: "",
      });

      const fallback = await p.select({
        message: "What would you like to do?",
        options: fallbackOptions,
      });

      if (p.isCancel(fallback) || fallback === "cancel") return null;

      if (fallback === "api_key") {
        return runApiKeyFlow(provider);
      } else if (fallback === "device_code") {
        return runDeviceCodeFlow(provider);
      } else if (fallback === "retry") {
        // Recursive retry
        return runBrowserOAuthFlow(provider);
      }
      return null;
    }
  }

  console.log(chalk.dim("   Starting authentication server..."));

  try {
    // Step 1: Generate PKCE credentials
    const pkce = generatePKCECredentials();

    // Step 2: Start callback server (waits until server is ready)
    const { port, resultPromise } = await createCallbackServer(pkce.state);

    // Step 3: Build redirect URI and authorization URL
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const authUrl = buildAuthorizationUrl(oauthProvider, redirectUri, pkce.codeChallenge, pkce.state);

    // Step 4: Show instructions
    console.log(chalk.green(`   ✓ Server ready on port ${port}`));
    console.log();
    console.log(chalk.magenta("   ┌─────────────────────────────────────────────────┐"));
    console.log(chalk.magenta("   │ ") + chalk.bold.white(`${displayInfo.authDescription}`.padEnd(47)) + chalk.magenta("│"));
    console.log(chalk.magenta("   │                                                 │"));
    console.log(chalk.magenta("   │ ") + chalk.dim("A browser window will open for you to sign in.") + chalk.magenta("  │"));
    console.log(chalk.magenta("   │ ") + chalk.dim("After signing in, you'll be redirected back.") + chalk.magenta("    │"));
    console.log(chalk.magenta("   └─────────────────────────────────────────────────┘"));
    console.log();

    // Step 5: Open browser
    const openIt = await p.confirm({
      message: "Open browser to sign in?",
      initialValue: true,
    });

    if (p.isCancel(openIt)) return null;

    if (openIt) {
      const opened = await openBrowser(authUrl);
      if (opened) {
        console.log(chalk.green("   ✓ Browser opened"));
      } else {
        const fallbackOpened = await openBrowserFallback(authUrl);
        if (fallbackOpened) {
          console.log(chalk.green("   ✓ Browser opened"));
        } else {
          console.log(chalk.dim("   Could not open browser automatically."));
          console.log(chalk.dim("   Please open this URL manually:"));
          console.log();
          console.log(chalk.cyan(`   ${authUrl}`));
          console.log();
        }
      }
    } else {
      console.log(chalk.dim("   Please open this URL in your browser:"));
      console.log();
      console.log(chalk.cyan(`   ${authUrl}`));
      console.log();
    }

    // Step 6: Wait for callback
    const spinner = p.spinner();
    spinner.start("Waiting for you to sign in...");

    const callbackResult = await resultPromise;

    spinner.stop(chalk.green("✓ Authentication received!"));

    // Step 7: Exchange code for tokens
    console.log(chalk.dim("   Exchanging code for tokens..."));

    const tokens = await exchangeCodeForTokens(
      oauthProvider,
      callbackResult.code,
      pkce.codeVerifier,
      redirectUri,
    );

    // Step 8: Save tokens (use oauthProvider so codex and openai share the same tokens)
    await saveTokens(oauthProvider, tokens);

    console.log(chalk.green("\n   ✅ Authentication complete!\n"));
    if (oauthProvider === "openai") {
      console.log(chalk.dim("   Your ChatGPT Plus/Pro subscription is now linked."));
    }
    console.log(chalk.dim("   Tokens are securely stored in ~/.coco/tokens/\n"));

    return { tokens, accessToken: tokens.accessToken };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.log();
    console.log(chalk.yellow("   ⚠ Browser authentication failed"));
    console.log(chalk.dim(`   Error: ${errorMsg}`));
    console.log();

    // Offer fallback options (only device code if provider supports it)
    const fallbackOptions = [];

    if (config?.deviceAuthEndpoint) {
      fallbackOptions.push({
        value: "device_code",
        label: "🔑 Try device code flow",
        hint: "Enter code manually in browser",
      });
    }

    fallbackOptions.push({
      value: "api_key",
      label: "📋 Use API key instead",
      hint: `Get from ${displayInfo.apiKeyUrl}`,
    });

    fallbackOptions.push({
      value: "cancel",
      label: "❌ Cancel",
      hint: "",
    });

    const fallback = await p.select({
      message: "What would you like to do?",
      options: fallbackOptions,
    });

    if (p.isCancel(fallback) || fallback === "cancel") return null;

    if (fallback === "device_code") {
      return runDeviceCodeFlow(provider);
    } else {
      return runApiKeyFlow(provider);
    }
  }
}

/**
 * Run Device Code OAuth flow (fallback)
 * Opens browser for user to authenticate with their account
 */
async function runDeviceCodeFlow(
  provider: string,
): Promise<{ tokens: OAuthTokens; accessToken: string } | null> {
  // Map codex to openai for OAuth (they share the same auth)
  const oauthProvider = getOAuthProviderName(provider);
  const displayInfo = getProviderDisplayInfo(provider);

  console.log();
  console.log(chalk.dim(`   Requesting device code from ${displayInfo.name}...`));

  try {
    // Step 1: Request device code
    const deviceCode = await requestDeviceCode(oauthProvider);

    // Step 2: Show user instructions
    console.log();
    console.log(chalk.magenta("   ┌─────────────────────────────────────────────────┐"));
    console.log(chalk.magenta("   │ ") + chalk.bold.white("Enter this code in your browser:") + chalk.magenta("               │"));
    console.log(chalk.magenta("   │                                                 │"));
    console.log(chalk.magenta("   │       ") + chalk.bold.cyan.bgBlack(` ${deviceCode.userCode} `) + chalk.magenta("                            │"));
    console.log(chalk.magenta("   │                                                 │"));
    console.log(chalk.magenta("   └─────────────────────────────────────────────────┘"));
    console.log();

    const verificationUrl = deviceCode.verificationUriComplete || deviceCode.verificationUri;
    console.log(chalk.cyan(`   → ${verificationUrl}`));
    console.log();

    // Step 3: Open browser automatically
    const openIt = await p.confirm({
      message: "Open browser to sign in?",
      initialValue: true,
    });

    if (p.isCancel(openIt)) return null;

    if (openIt) {
      const opened = await openBrowser(verificationUrl);
      if (opened) {
        console.log(chalk.green("   ✓ Browser opened"));
      } else {
        const fallbackOpened = await openBrowserFallback(verificationUrl);
        if (fallbackOpened) {
          console.log(chalk.green("   ✓ Browser opened"));
        } else {
          console.log(chalk.dim("   Copy the URL above and paste it in your browser"));
        }
      }
    }

    console.log();

    // Step 4: Poll for token (with spinner)
    const spinner = p.spinner();
    spinner.start("Waiting for you to sign in...");

    let pollCount = 0;
    const tokens = await pollForToken(
      oauthProvider,
      deviceCode.deviceCode,
      deviceCode.interval,
      deviceCode.expiresIn,
      () => {
        pollCount++;
        const dots = ".".repeat((pollCount % 3) + 1);
        spinner.message(`Waiting for you to sign in${dots}`);
      },
    );

    spinner.stop(chalk.green("✓ Signed in successfully!"));

    // Step 5: Save tokens (use oauthProvider so codex and openai share the same tokens)
    await saveTokens(oauthProvider, tokens);

    console.log(chalk.green("\n   ✅ Authentication complete!\n"));
    if (oauthProvider === "openai") {
      console.log(chalk.dim("   Your ChatGPT Plus/Pro subscription is now linked."));
    } else {
      console.log(chalk.dim(`   Your ${displayInfo.name} account is now linked.`));
    }
    console.log(chalk.dim("   Tokens are securely stored in ~/.coco/tokens/\n"));

    return { tokens, accessToken: tokens.accessToken };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check if it's a Cloudflare/network error
    if (
      errorMsg.includes("Cloudflare") ||
      errorMsg.includes("blocked") ||
      errorMsg.includes("HTML instead of JSON") ||
      errorMsg.includes("not supported")
    ) {
      console.log();
      console.log(chalk.yellow("   ⚠ Device code flow unavailable"));
      console.log(chalk.dim("   This can happen due to network restrictions."));
      console.log();

      const useFallback = await p.confirm({
        message: "Use API key instead?",
        initialValue: true,
      });

      if (p.isCancel(useFallback) || !useFallback) return null;

      return runApiKeyFlow(provider);
    }

    // Other errors
    p.log.error(chalk.red(`   Authentication failed: ${errorMsg}`));
    return null;
  }
}

/**
 * Run API key manual input flow
 * Opens browser to API keys page and asks user to paste key
 */
async function runApiKeyFlow(
  provider: string,
): Promise<{ tokens: OAuthTokens; accessToken: string } | null> {
  const oauthProvider = getOAuthProviderName(provider);
  const displayInfo = getProviderDisplayInfo(provider);
  const apiKeysUrl = displayInfo.apiKeyUrl;

  // Get API key prefix for validation
  const keyPrefix = oauthProvider === "openai" ? "sk-" : oauthProvider === "gemini" ? "AI" : "";
  const keyPrefixHint = keyPrefix ? ` (starts with '${keyPrefix}')` : "";

  console.log();
  console.log(chalk.magenta("   ┌─────────────────────────────────────────────────┐"));
  console.log(chalk.magenta("   │ ") + chalk.bold.white(`🔑 Get your ${displayInfo.name} API key:`.padEnd(47)) + chalk.magenta("│"));
  console.log(chalk.magenta("   ├─────────────────────────────────────────────────┤"));
  console.log(chalk.magenta("   │ ") + chalk.dim("1. Sign in with your account") + chalk.magenta("                   │"));
  console.log(chalk.magenta("   │ ") + chalk.dim("2. Create a new API key") + chalk.magenta("                        │"));
  console.log(chalk.magenta("   │ ") + chalk.dim("3. Copy and paste it here") + chalk.magenta("                      │"));
  console.log(chalk.magenta("   └─────────────────────────────────────────────────┘"));
  console.log();
  console.log(chalk.cyan(`   → ${apiKeysUrl}`));
  console.log();

  // Ask to open browser
  const openIt = await p.confirm({
    message: "Open browser to get API key?",
    initialValue: true,
  });

  if (p.isCancel(openIt)) return null;

  if (openIt) {
    const opened = await openBrowser(apiKeysUrl);
    if (opened) {
      console.log(chalk.green("   ✓ Browser opened"));
    } else {
      const fallbackOpened = await openBrowserFallback(apiKeysUrl);
      if (fallbackOpened) {
        console.log(chalk.green("   ✓ Browser opened"));
      } else {
        console.log(chalk.dim("   Copy the URL above and paste it in your browser"));
      }
    }
  }

  console.log();

  // Ask for the API key
  const apiKey = await p.password({
    message: `Paste your ${displayInfo.name} API key${keyPrefixHint}:`,
    validate: (value) => {
      if (!value || value.length < 10) {
        return "Please enter a valid API key";
      }
      if (keyPrefix && !value.startsWith(keyPrefix)) {
        return `${displayInfo.name} API keys typically start with '${keyPrefix}'`;
      }
      return;
    },
  });

  if (p.isCancel(apiKey)) return null;

  // Create a pseudo-token response (we're using API key, not OAuth token)
  const tokens: OAuthTokens = {
    accessToken: apiKey,
    tokenType: "Bearer",
  };

  // Save for future use (use oauthProvider so codex and openai share the same tokens)
  await saveTokens(oauthProvider, tokens);

  console.log(chalk.green("\n   ✅ API key saved!\n"));

  return { tokens, accessToken: apiKey };
}

/**
 * Get stored OAuth token or run flow if needed
 */
export async function getOrRefreshOAuthToken(
  provider: string,
): Promise<{ accessToken: string } | null> {
  // Map codex to openai for OAuth (they share the same auth)
  const oauthProvider = getOAuthProviderName(provider);

  // First try to load existing tokens
  const result = await getValidAccessToken(oauthProvider);
  if (result) {
    return { accessToken: result.accessToken };
  }

  // Need to authenticate - pass original provider so UI shows correct name
  const flowResult = await runOAuthFlow(provider);
  if (flowResult) {
    return { accessToken: flowResult.accessToken };
  }

  return null;
}
