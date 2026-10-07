/**
 * Local HTTP server for OAuth callback
 *
 * Starts a temporary server on localhost to receive the authorization code
 * after the user completes authentication in the browser.
 *
 * The server:
 * 1. Listens on port 1455 (same as OpenCode/Codex CLI for compatibility)
 * 2. Waits for the OAuth provider to redirect with the auth code
 * 3. Extracts the code and state from the callback URL
 * 4. Shows a success page and shuts down
 */

/**
 * Default OAuth callback port (same as OpenCode and Codex CLI)
 * Using a fixed port ensures consistency with OpenAI's OAuth flow
 */
export const OAUTH_CALLBACK_PORT = 1455;

import * as http from "node:http";
import { createRequestScope } from "../utils/request-scope.js";

/**
 * Escape a string for safe HTML insertion to prevent XSS
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
import { URL } from "node:url";

/**
 * Result from the callback server
 */
export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Success HTML page shown to user after authentication
 */
const SUCCESS_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      max-width: 400px;
    }
    .checkmark {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .checkmark svg {
      width: 40px;
      height: 40px;
      stroke: white;
      stroke-width: 3;
      fill: none;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
    }
    p {
      color: #6b7280;
      font-size: 16px;
      line-height: 1.5;
    }
    .brand {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      color: #9ca3af;
      font-size: 14px;
    }
    .brand strong {
      color: #667eea;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">
      <svg viewBox="0 0 24 24">
        <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Authentication Successful!</h1>
    <p>You can close this window and return to your terminal.</p>
    <div class="brand">
      Powered by <strong>Corbat-Coco</strong>
    </div>
  </div>
  <script>
    // Auto-close after 3 seconds
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>
`;

/**
 * Error HTML page shown when authentication fails
 */
const ERROR_HTML = (error: string) => {
  const safeError = escapeHtml(error);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      max-width: 400px;
    }
    .icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg {
      width: 40px;
      height: 40px;
      stroke: white;
      stroke-width: 3;
      fill: none;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
    }
    p {
      color: #6b7280;
      font-size: 16px;
      line-height: 1.5;
    }
    .error {
      margin-top: 16px;
      padding: 12px;
      background: #fef2f2;
      border-radius: 8px;
      color: #dc2626;
      font-family: monospace;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24">
        <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>Authentication Failed</h1>
    <p>Something went wrong. Please try again.</p>
    <div class="error">${safeError}</div>
  </div>
</body>
</html>
`;
};

/**
 * Start a local callback server and wait for the OAuth redirect
 *
 * @param expectedState - The state parameter to validate against CSRF
 * @param timeout - Timeout in milliseconds (default: 5 minutes)
 * @returns Promise resolving to the authorization code and state
 */
export function startCallbackServer(
  expectedState: string,
  timeout = 5 * 60 * 1000,
): Promise<{ result: CallbackResult; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Only handle the callback path
      if (!req.url?.startsWith("/auth/callback")) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      try {
        const url = new URL(req.url, `http://localhost`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        // Handle error response from OAuth provider
        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(ERROR_HTML(errorDescription || error));
          server.close();
          reject(new Error(errorDescription || error));
          return;
        }

        // Validate code and state
        if (!code || !state) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(ERROR_HTML("Missing authorization code or state"));
          server.close();
          reject(new Error("Missing authorization code or state"));
          return;
        }

        // Validate state matches (CSRF protection)
        if (state !== expectedState) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(ERROR_HTML("State mismatch - possible CSRF attack"));
          server.close();
          reject(new Error("State mismatch - possible CSRF attack"));
          return;
        }

        // Success!
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SUCCESS_HTML);

        // Get the port before closing
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;

        server.close();
        resolve({ result: { code, state }, port });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(String(err)));
        server.close();
        reject(err);
      }
    });

    // Start server on random available port
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        // Store port for the caller
        (server as http.Server & { _oauthPort: number })._oauthPort = address.port;
      }
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out. Please try again."));
    }, timeout);

    // Clean up timeout on success
    server.on("close", () => {
      clearTimeout(timeoutId);
    });

    // Handle server errors
    server.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Get the port of a callback server
 */
export function getServerPort(server: http.Server): number {
  const address = server.address();
  if (typeof address === "object" && address) {
    return address.port;
  }
  return 0;
}

/**
 * Create callback server and return port after server is ready
 * The server will resolve the promise when callback is received
 *
 * Uses fixed port 1455 for compatibility with OpenAI's OAuth (same as OpenCode/Codex CLI)
 */
export async function createCallbackServer(
  expectedState: string,
  timeout = 5 * 60 * 1000,
  port = OAUTH_CALLBACK_PORT,
  signal?: AbortSignal,
): Promise<{ port: number; resultPromise: Promise<CallbackResult>; close: () => Promise<void> }> {
  const scope = createRequestScope(signal, timeout);
  let resolveResult!: (result: CallbackResult) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Registration/browser setup can still be running when the callback times out.
  void resultPromise.catch(() => {});
  let settled = false;
  let closing: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closing;
  };
  const finish = (error?: unknown, result?: CallbackResult) => {
    if (settled) return;
    settled = true;
    scope.signal.removeEventListener("abort", onAbort);
    if (result) resolveResult(result);
    else rejectResult(error);
    scope.dispose();
    void stop();
  };
  const onAbort = () => finish(scope.signal.reason);
  const server = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400).end("Bad Request");
      return;
    }
    if (req.method !== "GET" || url.pathname !== "/auth/callback") {
      res.writeHead(404).end("Not Found");
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");
    const failure = providerError
      ? new Error(url.searchParams.get("error_description") || providerError)
      : !code || !state
        ? new Error("Missing authorization code or state")
        : state !== expectedState
          ? new Error("State mismatch - possible CSRF attack")
          : undefined;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(failure ? ERROR_HTML(failure.message) : SUCCESS_HTML, () => {
      finish(failure, failure ? undefined : { code: code!, state: state! });
    });
  });
  scope.signal.addEventListener("abort", onAbort, { once: true });
  const listen = (requestedPort: number) =>
    new Promise<number>((resolve, reject) => {
      const cleanup = () => {
        server.removeListener("error", onError);
        server.removeListener("listening", onListening);
        scope.signal.removeEventListener("abort", onListenAbort);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onListenAbort = () => {
        cleanup();
        reject(scope.signal.reason);
      };
      const onListening = () => {
        cleanup();
        const address = server.address();
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Failed to get server port"));
      };
      scope.signal.addEventListener("abort", onListenAbort, { once: true });
      server.once("error", onError);
      server.once("listening", onListening);
      try {
        scope.signal.throwIfAborted();
        server.listen({ port: requestedPort, host: "127.0.0.1", signal: scope.signal });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  try {
    let actualPort: number;
    try {
      actualPort = await listen(port);
    } catch (error) {
      scope.signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0) throw error;
      actualPort = await listen(0);
    }
    scope.signal.throwIfAborted();
    return {
      port: actualPort,
      resultPromise,
      close: async () => {
        finish(new Error("Authentication callback closed"));
        await stop();
      },
    };
  } catch (error) {
    finish(error);
    await stop();
    throw error;
  }
}
