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
import { execFile } from "node:child_process";
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
import { isWSL } from "../utils/platform.js";
import {
  describeFetchError,
  detectPacProxy,
  getProxyFromEnv,
  maskProxyUrl,
} from "../utils/proxy.js";
import {
  requestGitHubDeviceCode,
  pollGitHubForToken,
  exchangeForCopilotToken,
  exchangeForCopilotTokenViaGhCli,
  getGitHubLogin,
  getGitHubCliToken,
  getGitHubCliAuthStatus,
  getValidCopilotToken,
  saveCopilotCredentials,
  loadCopilotCredentials,
  type CopilotCredentials,
} from "./copilot.js";

const execFileAsync = promisify(execFile);

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
    case "copilot":
      return {
        name: "GitHub Copilot",
        emoji: "🐙",
        authDescription: "Sign in with your GitHub account",
        apiKeyUrl: "https://github.com/settings/copilot",
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
  if (provider === "copilot") return true;
  const oauthProvider = getOAuthProviderName(provider);
  return oauthProvider in OAUTH_CONFIGS;
}

/**
 * Check if OAuth is already configured for a provider
 */
export async function isOAuthConfigured(provider: string): Promise<boolean> {
  if (provider === "copilot") {
    const creds = await loadCopilotCredentials();
    return creds !== null;
  }
  const oauthProvider = getOAuthProviderName(provider);
  const tokens = await loadTokens(oauthProvider);
  return tokens !== null;
}

/**
 * Print an auth URL to console, masking sensitive query parameters
 */
function printAuthUrl(url: string): void {
  try {
    const parsed = new URL(url);
    // Mask client_id and other sensitive params for logging
    const maskedParams = new URLSearchParams(parsed.searchParams);
    if (maskedParams.has("client_id")) {
      const clientId = maskedParams.get("client_id")!;
      maskedParams.set("client_id", clientId.slice(0, 8) + "...");
    }
    parsed.search = maskedParams.toString();
    console.log(chalk.cyan(`   ${parsed.toString()}`));
  } catch {
    console.log(chalk.cyan("   [invalid URL]"));
  }
}

/**
 * Open URL in browser (cross-platform)
 */
async function openBrowser(url: string): Promise<boolean> {
  // Parse and reconstruct URL to sanitize input and break taint chain.
  // Only allow http/https schemes to prevent arbitrary protocol handlers.
  let sanitizedUrl: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    sanitizedUrl = parsed.toString();
  } catch {
    return false;
  }

  const platform = process.platform;

  try {
    if (platform === "darwin") {
      await execFileAsync("open", [sanitizedUrl]);
    } else if (platform === "win32") {
      await execFileAsync("rundll32", ["url.dll,FileProtocolHandler", sanitizedUrl]);
    } else if (isWSL) {
      // WSL has no display server — delegate to Windows browser via cmd.exe
      await execFileAsync("cmd.exe", ["/c", "start", "", sanitizedUrl]);
    } else {
      await execFileAsync("xdg-open", [sanitizedUrl]);
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
  // Parse and reconstruct URL to sanitize input and break taint chain.
  // Only allow http/https schemes to prevent arbitrary protocol handlers.
  let sanitizedUrl: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    sanitizedUrl = parsed.toString();
  } catch {
    return false;
  }

  const platform = process.platform;
  const commands: Array<{ cmd: string; args: string[] }> = [];

  if (platform === "darwin") {
    commands.push(
      { cmd: "open", args: [sanitizedUrl] },
      { cmd: "open", args: ["-a", "Safari", sanitizedUrl] },
      { cmd: "open", args: ["-a", "Google Chrome", sanitizedUrl] },
    );
  } else if (platform === "win32") {
    commands.push({
      cmd: "rundll32",
      args: ["url.dll,FileProtocolHandler", sanitizedUrl],
    });
  } else if (isWSL) {
    // WSL: delegate to Windows browser; wslview as optional third-party fallback
    commands.push(
      { cmd: "cmd.exe", args: ["/c", "start", "", sanitizedUrl] },
      { cmd: "powershell.exe", args: ["-Command", `Start-Process '${sanitizedUrl}'`] },
      { cmd: "wslview", args: [sanitizedUrl] },
    );
  } else {
    // Linux - try multiple browsers
    commands.push(
      { cmd: "xdg-open", args: [sanitizedUrl] },
      { cmd: "sensible-browser", args: [sanitizedUrl] },
      { cmd: "x-www-browser", args: [sanitizedUrl] },
      { cmd: "gnome-open", args: [sanitizedUrl] },
      { cmd: "firefox", args: [sanitizedUrl] },
      { cmd: "chromium-browser", args: [sanitizedUrl] },
      { cmd: "google-chrome", args: [sanitizedUrl] },
    );
  }

  for (const { cmd, args } of commands) {
    try {
      await execFileAsync(cmd, args);
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
  // Copilot uses its own GitHub device flow (not standard OAuth)
  if (provider === "copilot") {
    return runCopilotDeviceFlow();
  }

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
  console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
  console.log(
    chalk.magenta("   │ ") +
      chalk.bold.white(`${displayInfo.emoji} ${displayInfo.name} Authentication`.padEnd(47)) +
      chalk.magenta("│"),
  );
  console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
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
async function isPortAvailable(
  port: number,
): Promise<{ available: boolean; processName?: string }> {
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
      console.log(
        chalk.dim(
          `   ${displayInfo.name} OAuth requires port ${requiredPort}, which is currently occupied.`,
        ),
      );
      console.log(chalk.dim("   This usually means OpenCode or another coding tool is running."));
      console.log();
      console.log(chalk.cyan("   To fix this:"));
      console.log(chalk.dim("   1. Close OpenCode/Codex CLI (if running)"));
      console.log(
        chalk.dim("   2. Or use an API key instead (recommended if using multiple tools)"),
      );
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
    const authUrl = buildAuthorizationUrl(
      oauthProvider,
      redirectUri,
      pkce.codeChallenge,
      pkce.state,
    );

    // Step 4: Show instructions
    console.log(chalk.green(`   ✓ Server ready on port ${port}`));
    console.log();
    console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
    console.log(
      chalk.magenta("   │ ") +
        chalk.bold.white(`${displayInfo.authDescription}`.padEnd(47)) +
        chalk.magenta("│"),
    );
    console.log(chalk.magenta("   │                                                 │"));
    console.log(
      chalk.magenta("   │ ") +
        chalk.dim("A browser window will open for you to sign in.") +
        chalk.magenta("  │"),
    );
    console.log(
      chalk.magenta("   │ ") +
        chalk.dim("After signing in, you'll be redirected back.") +
        chalk.magenta("    │"),
    );
    console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
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
          printAuthUrl(authUrl);
          console.log();
        }
      }
    } else {
      console.log(chalk.dim("   Please open this URL in your browser:"));
      console.log();
      printAuthUrl(authUrl);
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
    // Keep high-level categorization to avoid leaking tokens or client IDs,
    // but for network failures surface the actual cause so users can diagnose
    // proxy / DNS / TLS issues instead of staring at an opaque "Network error".
    const isNetwork =
      errorMsg.includes("fetch failed") ||
      errorMsg.toLowerCase().includes("network error") ||
      errorMsg.includes("ECONNREFUSED") ||
      errorMsg.includes("ENOTFOUND") ||
      errorMsg.includes("ETIMEDOUT");

    if (isNetwork) {
      // Only the narrow `code` from describeFetchError is passed downstream;
      // no string derived from `error`/`error.message` is ever interpolated
      // into console output. printNetworkTroubleshooting() emits only static
      // literals so CodeQL cannot flag this as clear-text sensitive logging.
      const { code } = describeFetchError(error);
      console.log(chalk.dim("   Error: Network error"));
      printNetworkTroubleshooting(code);
    } else {
      const errorCategory =
        errorMsg.includes("timeout") || errorMsg.includes("Timeout")
          ? "Request timed out"
          : errorMsg.includes("401") || errorMsg.includes("403")
            ? "Authorization denied"
            : errorMsg.includes("invalid_grant") || errorMsg.includes("invalid_client")
              ? "Invalid credentials"
              : "Authentication error (see debug logs for details)";
      console.log(chalk.dim(`   Error: ${errorCategory}`));
    }
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
    console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
    console.log(
      chalk.magenta("   │ ") +
        chalk.bold.white("Enter this code in your browser:") +
        chalk.magenta("               │"),
    );
    console.log(chalk.magenta("   │                                                 │"));
    console.log(
      chalk.magenta("   │       ") +
        chalk.bold.cyan.bgBlack(` ${deviceCode.userCode} `) +
        chalk.magenta("                            │"),
    );
    console.log(chalk.magenta("   │                                                 │"));
    console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
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

    // Log a generic error category to avoid logging sensitive data from the device code flow
    const deviceErrorCategory =
      errorMsg.includes("timeout") || errorMsg.includes("expired")
        ? "Device code expired"
        : errorMsg.includes("denied") || errorMsg.includes("access_denied")
          ? "Access denied by user"
          : "Unexpected error during device code authentication";
    p.log.error(chalk.red(`   Authentication failed: ${deviceErrorCategory}`));
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
  if (provider === "copilot") {
    throw new Error("runApiKeyFlow called with copilot — use runCopilotDeviceFlow() instead");
  }
  const oauthProvider = getOAuthProviderName(provider);
  const displayInfo = getProviderDisplayInfo(provider);
  const apiKeysUrl = displayInfo.apiKeyUrl;

  // Get API key prefix for validation
  const keyPrefix = oauthProvider === "openai" ? "sk-" : oauthProvider === "gemini" ? "AI" : "";
  const keyPrefixHint = keyPrefix ? ` (starts with '${keyPrefix}')` : "";

  console.log();
  console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
  console.log(
    chalk.magenta("   │ ") +
      chalk.bold.white(`🔑 Get your ${displayInfo.name} API key:`.padEnd(47)) +
      chalk.magenta("│"),
  );
  console.log(chalk.magenta("   ├─────────────────────────────────────────────────┤"));
  console.log(
    chalk.magenta("   │ ") +
      chalk.dim("1. Sign in with your account") +
      chalk.magenta("                   │"),
  );
  console.log(
    chalk.magenta("   │ ") +
      chalk.dim("2. Create a new API key") +
      chalk.magenta("                        │"),
  );
  console.log(
    chalk.magenta("   │ ") +
      chalk.dim("3. Copy and paste it here") +
      chalk.magenta("                      │"),
  );
  console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
  console.log();
  // Log a sanitized version of the URL (mask any sensitive query params)
  try {
    const parsedUrl = new URL(apiKeysUrl);
    // Remove any query parameters that might contain sensitive data
    parsedUrl.search = "";
    console.log(chalk.cyan(`   → ${parsedUrl.toString()}`));
  } catch {
    console.log(chalk.cyan("   → [provider API keys page]"));
  }
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
 * Authenticate Copilot by reusing an existing `gh` CLI session.
 *
 * Skips the browser/device-code flow entirely: reads the GitHub token
 * from `gh auth token` and exchanges it for a Copilot API token using
 * the `gh api` subprocess (Go HTTP client, PAC-aware, system-CA-aware).
 * This is the reliable path on corporate networks.
 */
async function runCopilotAuthViaGhCli(ghCliUser: string): Promise<{
  tokens: OAuthTokens;
  accessToken: string;
} | null> {
  const spinner = p.spinner();
  spinner.start("Exchanging GitHub CLI credentials for Copilot token...");

  try {
    const githubToken = await getGitHubCliToken();
    if (!githubToken) {
      spinner.stop(chalk.red("✗ Could not read gh auth token"));
      return null;
    }

    // Try direct exchange first, fall back to gh api subprocess
    let copilotToken;
    try {
      copilotToken = await exchangeForCopilotToken(githubToken);
    } catch {
      copilotToken = await exchangeForCopilotTokenViaGhCli();
    }

    if (!copilotToken) {
      spinner.stop(chalk.red("✗ Could not obtain Copilot token via gh CLI"));
      console.log(chalk.dim("   Ensure your GitHub account has an active Copilot subscription:"));
      console.log(chalk.cyan("   → https://github.com/settings/copilot"));
      return null;
    }

    const creds: CopilotCredentials = {
      githubToken,
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expires_at * 1000,
      accountType: copilotToken.annotations?.copilot_plan,
    };
    await saveCopilotCredentials(creds);

    spinner.stop(chalk.green("✓ GitHub Copilot authenticated via gh CLI!"));
    const userLabel = ghCliUser !== "authenticated" ? ` (@${ghCliUser})` : "";
    console.log(chalk.dim(`   Account${userLabel} · Plan: ${creds.accountType ?? "individual"}`));
    console.log(chalk.dim("   Credentials stored in ~/.coco/tokens/copilot.json\n"));

    const tokens: OAuthTokens = {
      accessToken: copilotToken.token,
      tokenType: "Bearer",
      expiresAt: copilotToken.expires_at * 1000,
    };
    return { tokens, accessToken: copilotToken.token };
  } catch (error) {
    const { code } = describeFetchError(error);
    spinner.stop(chalk.red("✗ Failed to authenticate via gh CLI"));
    printNetworkTroubleshooting(code);
    return null;
  }
}

/**
 * Run GitHub Copilot device flow authentication
 *
 * This uses GitHub's OAuth Device Flow:
 * 1. Request device code from GitHub
 * 2. User authorizes at github.com/login/device
 * 3. Poll for GitHub access token
 * 4. Exchange GitHub token for Copilot API token
 * 5. Save both tokens
 */
async function runCopilotDeviceFlow(): Promise<{
  tokens: OAuthTokens;
  accessToken: string;
} | null> {
  console.log();
  console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
  console.log(
    chalk.magenta("   │ ") +
      chalk.bold.white("🐙 GitHub Copilot Authentication".padEnd(47)) +
      chalk.magenta("│"),
  );
  console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
  console.log();
  console.log(chalk.dim("   Requires an active GitHub Copilot subscription."));
  console.log(chalk.dim("   https://github.com/settings/copilot"));
  console.log();

  // On corporate networks (PAC proxy, TLS interception) Node's fetch cannot
  // reach GitHub, but the `gh` CLI can (Go's HTTP stack handles PAC/system CAs).
  // If the user already has a `gh` session, offer it as the preferred path —
  // this avoids the device flow entirely and works on any network where gh works.
  const ghCliUser = await getGitHubCliAuthStatus();
  if (ghCliUser) {
    console.log(
      chalk.dim(`   ℹ  GitHub CLI session detected`) +
        (ghCliUser !== "authenticated" ? chalk.dim(` (@${ghCliUser})`) : "") +
        chalk.dim("."),
    );
    const useGhSession = await p.confirm({
      message: "Use your existing `gh` session? (recommended on corporate networks)",
      initialValue: true,
    });

    if (p.isCancel(useGhSession)) return null;

    if (useGhSession) {
      return runCopilotAuthViaGhCli(ghCliUser);
    }
    console.log();
  }

  try {
    // Step 1: Request device code
    console.log(chalk.dim("   Requesting device code from GitHub..."));
    const deviceCode = await requestGitHubDeviceCode();

    // Step 2: Show code to user
    console.log();
    console.log(chalk.magenta("   ╭─────────────────────────────────────────────────╮"));
    console.log(
      chalk.magenta("   │ ") +
        chalk.bold.white("Enter this code in your browser:") +
        chalk.magenta("               │"),
    );
    console.log(chalk.magenta("   │                                                 │"));
    console.log(
      chalk.magenta("   │       ") +
        chalk.bold.cyan.bgBlack(` ${deviceCode.user_code} `) +
        chalk.magenta("                            │"),
    );
    console.log(chalk.magenta("   │                                                 │"));
    console.log(chalk.magenta("   ╰─────────────────────────────────────────────────╯"));
    console.log();
    console.log(chalk.cyan(`   → ${deviceCode.verification_uri}`));
    console.log();

    // Step 3: Open browser
    const openIt = await p.confirm({
      message: "Open browser to sign in?",
      initialValue: true,
    });

    if (p.isCancel(openIt)) return null;

    if (openIt) {
      const opened = await openBrowser(deviceCode.verification_uri);
      if (opened) {
        console.log(chalk.green("   ✓ Browser opened"));
      } else {
        const fallbackOpened = await openBrowserFallback(deviceCode.verification_uri);
        if (fallbackOpened) {
          console.log(chalk.green("   ✓ Browser opened"));
        } else {
          console.log(chalk.dim("   Copy the URL above and paste it in your browser"));
        }
      }
    }

    console.log();

    // Step 4: Poll for GitHub token
    const spinner = p.spinner();
    spinner.start("Waiting for you to sign in on GitHub...");

    let pollCount = 0;
    const githubToken = await pollGitHubForToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in,
      () => {
        pollCount++;
        const dots = ".".repeat((pollCount % 3) + 1);
        spinner.message(`Waiting for you to sign in on GitHub${dots}`);
      },
    );

    spinner.stop(chalk.green("✓ GitHub authentication successful!"));

    const githubLogin = await getGitHubLogin(githubToken);
    if (githubLogin) {
      console.log(chalk.dim(`   Authenticated as: @${githubLogin}`));
    }

    // Step 5: Exchange for Copilot token
    console.log(chalk.dim("   Exchanging token for Copilot access..."));

    const copilotToken = await exchangeForCopilotToken(githubToken);

    // Step 6: Save credentials
    const creds: CopilotCredentials = {
      githubToken,
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expires_at * 1000,
      accountType: copilotToken.annotations?.copilot_plan,
    };

    await saveCopilotCredentials(creds);

    const planType = creds.accountType ?? "individual";
    console.log(chalk.green("\n   ✅ GitHub Copilot authenticated!\n"));
    console.log(chalk.dim(`   Plan: ${planType}`));
    console.log(chalk.dim("   Credentials stored in ~/.coco/tokens/copilot.json\n"));

    // Return as OAuthTokens for compatibility with the flow return type
    const tokens: OAuthTokens = {
      accessToken: copilotToken.token,
      tokenType: "Bearer",
      expiresAt: copilotToken.expires_at * 1000,
    };

    return { tokens, accessToken: copilotToken.token };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.log();
    if (errorMsg.includes("403") || errorMsg.includes("not enabled")) {
      console.log(chalk.red("   ✗ GitHub Copilot is not enabled for this account."));
      console.log(chalk.dim("   Please ensure you have an active Copilot subscription:"));
      console.log(chalk.cyan("   → https://github.com/settings/copilot"));
      console.log(
        chalk.dim(
          "   If this account is wrong, sign out of github.com in your browser and run /provider again.",
        ),
      );
    } else if (errorMsg.includes("expired") || errorMsg.includes("timed out")) {
      console.log(chalk.yellow("   ⚠ Authentication timed out. Please try again."));
    } else if (errorMsg.includes("denied")) {
      console.log(chalk.yellow("   ⚠ Access was denied."));
    } else if (errorMsg.includes("fetch failed") || errorMsg.toLowerCase().includes("network")) {
      // See the corresponding block in runBrowserOAuthFlow for the rationale:
      // only the narrow `code` is surfaced to the logger; detail messages live
      // inside printNetworkTroubleshooting() as static literal strings.
      const { code } = describeFetchError(error);
      console.log(chalk.red("   ✗ Network error reaching GitHub"));
      printNetworkTroubleshooting(code);
    } else {
      console.log(chalk.red("   ✗ Authentication error — see debug logs for details"));
    }
    console.log();

    return null;
  }
}

/**
 * Print proxy / network troubleshooting hints when a fetch fails.
 * Keeps advice tailored to the underlying cause code when available.
 */
function printNetworkTroubleshooting(code?: string): void {
  const proxy = getProxyFromEnv();
  const pacUrl = detectPacProxy();

  if (proxy) {
    console.log(chalk.dim(`   Proxy in use: ${maskProxyUrl(proxy)}`));
    console.log(chalk.dim("   → Verify the proxy allows github.com and api.github.com."));
  } else if (pacUrl) {
    // Corporate PAC script detected — Node's fetch cannot evaluate PAC scripts.
    // Guide the user toward options that work: gh CLI or manual HTTPS_PROXY.
    console.log(
      chalk.dim("   Automatic proxy (PAC script) detected — Node.js cannot evaluate it."),
    );
    console.log(chalk.dim("   You have two options:"));
    console.log(chalk.dim("   1. Run `gh auth login` first, then re-run /provider copilot."));
    console.log(
      chalk.dim(
        "      Coco will reuse your `gh` session (Go HTTP client handles PAC automatically).",
      ),
    );
    console.log(chalk.dim("   2. Set HTTPS_PROXY=http://<your-proxy>:<port> manually and retry."));
  } else {
    console.log(chalk.dim("   No HTTPS_PROXY / HTTP_PROXY env vars detected."));
    console.log(chalk.dim("   → If you're behind a corporate proxy, set HTTPS_PROXY and retry."));
    console.log(chalk.dim("   → Or run `gh auth login` first — Coco will reuse the gh session."));
  }

  if (code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    console.log(
      chalk.dim(
        "   → TLS interceptor detected. Add your corporate root CA to NODE_EXTRA_CA_CERTS.",
      ),
    );
    console.log(chalk.dim("      Example: NODE_EXTRA_CA_CERTS=/path/to/corp-ca.crt coco"));
  } else if (code === "ENOTFOUND") {
    console.log(chalk.dim("   → Check DNS: `nslookup github.com`"));
  } else if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    console.log(chalk.dim("   → A firewall may be blocking the connection. Try `gh auth login`."));
  }
}

/**
 * Get stored OAuth token or run flow if needed
 */
export async function getOrRefreshOAuthToken(
  provider: string,
): Promise<{ accessToken: string } | null> {
  // Copilot has its own token management
  if (provider === "copilot") {
    const tokenResult = await getValidCopilotToken();
    if (tokenResult) {
      return { accessToken: tokenResult.token };
    }
    // Need to authenticate
    const flowResult = await runOAuthFlow(provider);
    if (flowResult) {
      return { accessToken: flowResult.accessToken };
    }
    return null;
  }

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
