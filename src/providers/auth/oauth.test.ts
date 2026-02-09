/**
 * Tests for OAuth module, token-store, and auth index
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockRequest = { url?: string };
type MockResponse = {
  statusCode?: number;
  headers?: Record<string, string>;
  writeHead: (statusCode: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};
type MockHandler = (req: MockRequest, res: MockResponse) => void;

let currentHandler: MockHandler | null = null;

class MockServer {
  listen = vi.fn((_port?: number, cb?: () => void) => {
    cb?.();
    return this;
  });
  close = vi.fn();
  on = vi.fn();
}

function simulateRequest(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (!currentHandler) {
      reject(new Error("No server handler registered"));
      return;
    }

    const responseState: { status: number; body: string } = {
      status: 200,
      body: "",
    };

    const res: MockResponse = {
      writeHead: (statusCode, headers) => {
        responseState.status = statusCode;
        responseState.body = responseState.body;
        responseState.headers = headers;
      },
      end: (body) => {
        if (body) {
          responseState.body = body;
        }
        resolve(responseState);
      },
    };

    currentHandler({ url }, res);
  });
}

// ── Mocks ────────────────────────────────────────────────────────────────

// Mock node:fs/promises for token-store tests
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock node:child_process for openBrowser
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock node:http to avoid binding real sockets during tests
vi.mock("node:http", () => ({
  createServer: vi.fn((handler: MockHandler) => {
    currentHandler = handler;
    return new MockServer();
  }),
}));

// We need to import after mocks are set up
import {
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
  type PKCEPair,
} from "./oauth.js";

import {
  saveToken,
  getToken,
  getValidToken,
  deleteToken,
  listTokens,
  hasToken,
  clearAllTokens,
} from "./token-store.js";

import { OAUTH_CONFIGS, getAuthMethods } from "./index.js";

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";

// ── Helpers ──────────────────────────────────────────────────────────────

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockExec = vi.mocked(exec);

function createMockConfig(overrides?: Partial<OAuthConfig>): OAuthConfig {
  return {
    authorizationUrl: "https://auth.example.com/authorize",
    tokenUrl: "https://auth.example.com/token",
    clientId: "test-client-id",
    redirectUri: "http://localhost:8090/callback",
    scopes: ["openid", "profile"],
    ...overrides,
  };
}

function createMockPKCE(): PKCEPair {
  return { verifier: "test-verifier-abc123", challenge: "test-challenge-xyz789" };
}

function mockFetchResponse(data: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)),
    }),
  );
}

// ── oauth.ts tests ───────────────────────────────────────────────────────

describe("oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    currentHandler = null;
  });

  // ── generatePKCE ────────────────────────────────────────────────────

  describe("generatePKCE", () => {
    it("should return a verifier and challenge", () => {
      const pkce = generatePKCE();
      expect(pkce).toHaveProperty("verifier");
      expect(pkce).toHaveProperty("challenge");
      expect(pkce.verifier.length).toBeGreaterThan(0);
      expect(pkce.challenge.length).toBeGreaterThan(0);
    });

    it("should generate unique pairs on each call", () => {
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();
      expect(pkce1.verifier).not.toBe(pkce2.verifier);
      expect(pkce1.challenge).not.toBe(pkce2.challenge);
    });

    it("verifier should only contain alphanumeric characters", () => {
      const pkce = generatePKCE();
      expect(pkce.verifier).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it("verifier should be at most 43 characters", () => {
      const pkce = generatePKCE();
      expect(pkce.verifier.length).toBeLessThanOrEqual(43);
      expect(pkce.verifier.length).toBeGreaterThan(30);
    });
  });

  // ── generateState ──────────────────────────────────────────────────

  describe("generateState", () => {
    it("should return a hex string", () => {
      const state = generateState();
      expect(state).toMatch(/^[a-f0-9]+$/);
    });

    it("should be 32 characters (16 bytes hex)", () => {
      const state = generateState();
      expect(state).toHaveLength(32);
    });

    it("should generate unique values", () => {
      const state1 = generateState();
      const state2 = generateState();
      expect(state1).not.toBe(state2);
    });
  });

  // ── buildAuthorizationUrl ──────────────────────────────────────────

  describe("buildAuthorizationUrl", () => {
    it("should build a valid URL with all required parameters", () => {
      const config = createMockConfig();
      const pkce = createMockPKCE();
      const state = "test-state-123";

      const url = buildAuthorizationUrl(config, pkce, state);
      const parsed = new URL(url);

      expect(parsed.origin + parsed.pathname).toBe("https://auth.example.com/authorize");
      expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:8090/callback");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("scope")).toBe("openid profile");
      expect(parsed.searchParams.get("state")).toBe("test-state-123");
      expect(parsed.searchParams.get("code_challenge")).toBe("test-challenge-xyz789");
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    });
  });

  // ── exchangeCodeForTokens ──────────────────────────────────────────

  describe("exchangeCodeForTokens", () => {
    it("should exchange code for tokens successfully", async () => {
      const config = createMockConfig();
      const pkce = createMockPKCE();

      mockFetchResponse({
        access_token: "access-123",
        refresh_token: "refresh-456",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid profile",
      });

      const tokens = await exchangeCodeForTokens(config, "auth-code-xyz", pkce);

      expect(tokens).toEqual({
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresIn: 3600,
        tokenType: "Bearer",
        scope: "openid profile",
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0]!;
      expect(fetchCall[0]).toBe("https://auth.example.com/token");
      expect(fetchCall[1]!.method).toBe("POST");
      expect(fetchCall[1]!.headers).toEqual({
        "Content-Type": "application/x-www-form-urlencoded",
      });

      const bodyStr = fetchCall[1]!.body as string;
      const body = new URLSearchParams(bodyStr);
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-xyz");
      expect(body.get("redirect_uri")).toBe("http://localhost:8090/callback");
      expect(body.get("code_verifier")).toBe("test-verifier-abc123");
    });

    it("should throw on non-ok response", async () => {
      const config = createMockConfig();
      const pkce = createMockPKCE();

      mockFetchResponse("invalid_grant", false, 400);

      await expect(exchangeCodeForTokens(config, "bad-code", pkce)).rejects.toThrow(
        "Token exchange failed: 400",
      );
    });
  });

  // ── refreshAccessToken ─────────────────────────────────────────────

  describe("refreshAccessToken", () => {
    it("should refresh token successfully", async () => {
      const config = createMockConfig();

      mockFetchResponse({
        access_token: "new-access-789",
        refresh_token: "new-refresh-012",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid",
      });

      const tokens = await refreshAccessToken(config, "old-refresh-token");

      expect(tokens.accessToken).toBe("new-access-789");
      expect(tokens.refreshToken).toBe("new-refresh-012");
      expect(tokens.expiresIn).toBe(3600);
      expect(tokens.tokenType).toBe("Bearer");

      const fetchCall = vi.mocked(fetch).mock.calls[0]!;
      const body = new URLSearchParams(fetchCall[1]!.body as string);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh-token");
    });

    it("should preserve original refresh token if none returned", async () => {
      const config = createMockConfig();

      mockFetchResponse({
        access_token: "new-access",
        expires_in: 3600,
        token_type: "Bearer",
        // no refresh_token in response
      });

      const tokens = await refreshAccessToken(config, "original-refresh");

      expect(tokens.refreshToken).toBe("original-refresh");
    });

    it("should throw on non-ok response", async () => {
      const config = createMockConfig();

      mockFetchResponse("server_error", false, 500);

      await expect(refreshAccessToken(config, "refresh-token")).rejects.toThrow(
        "Token refresh failed: 500",
      );
    });
  });

  // ── openBrowser ────────────────────────────────────────────────────

  describe("openBrowser", () => {
    it("should use 'open' on macOS (darwin)", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      // exec with callback pattern: exec(cmd, callback)
      mockExec.mockImplementation((_cmd: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          (callback as (err: null) => void)(null);
        }
        return {} as ReturnType<typeof exec>;
      });

      await openBrowser("https://example.com");

      expect(mockExec).toHaveBeenCalledWith('open "https://example.com"', expect.any(Function));

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("should use 'start' on Windows (win32)", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", writable: true });

      mockExec.mockImplementation((_cmd: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          (callback as (err: null) => void)(null);
        }
        return {} as ReturnType<typeof exec>;
      });

      await openBrowser("https://example.com");

      expect(mockExec).toHaveBeenCalledWith('start "" "https://example.com"', expect.any(Function));

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("should use 'xdg-open' on Linux", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", writable: true });

      mockExec.mockImplementation((_cmd: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          (callback as (err: null) => void)(null);
        }
        return {} as ReturnType<typeof exec>;
      });

      await openBrowser("https://example.com");

      expect(mockExec).toHaveBeenCalledWith('xdg-open "https://example.com"', expect.any(Function));

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });

    it("should silently fail if exec errors", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });

      mockExec.mockImplementation((_cmd: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          (callback as (err: Error) => void)(new Error("command not found"));
        }
        return {} as ReturnType<typeof exec>;
      });

      // Should not throw
      await expect(openBrowser("https://example.com")).resolves.toBeUndefined();

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });
  });

  // ── requestDeviceCode ──────────────────────────────────────────────

  describe("requestDeviceCode", () => {
    it("should request device code successfully", async () => {
      const config = createMockConfig({
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
      });

      mockFetchResponse({
        device_code: "dev-code-123",
        user_code: "ABCD-EFGH",
        verification_uri: "https://auth.example.com/verify",
        verification_uri_complete: "https://auth.example.com/verify?code=ABCD-EFGH",
        expires_in: 900,
        interval: 5,
      });

      const result = await requestDeviceCode(config);

      expect(result).toEqual({
        deviceCode: "dev-code-123",
        userCode: "ABCD-EFGH",
        verificationUri: "https://auth.example.com/verify",
        verificationUriComplete: "https://auth.example.com/verify?code=ABCD-EFGH",
        expiresIn: 900,
        interval: 5,
      });
    });

    it("should default interval to 5 if not provided", async () => {
      const config = createMockConfig({
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
      });

      mockFetchResponse({
        device_code: "dev-code",
        user_code: "CODE",
        verification_uri: "https://example.com/verify",
        expires_in: 300,
        // no interval
      });

      const result = await requestDeviceCode(config);
      expect(result.interval).toBe(5);
    });

    it("should throw if no deviceAuthorizationUrl configured", async () => {
      const config = createMockConfig(); // no deviceAuthorizationUrl

      await expect(requestDeviceCode(config)).rejects.toThrow(
        "Device authorization URL not configured",
      );
    });

    it("should throw on non-ok response", async () => {
      const config = createMockConfig({
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
      });

      mockFetchResponse("unauthorized_client", false, 400);

      await expect(requestDeviceCode(config)).rejects.toThrow("Device code request failed: 400");
    });
  });

  // ── pollForDeviceTokens ────────────────────────────────────────────

  describe("pollForDeviceTokens", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return tokens on successful poll", async () => {
      const config = createMockConfig();

      // First call: authorization_pending, second call: success
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({
              error: "authorization_pending",
              error_description: "User has not yet authorized",
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: "device-access-token",
              refresh_token: "device-refresh-token",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid",
            }),
        });

      vi.stubGlobal("fetch", mockFetch);

      const pollPromise = pollForDeviceTokens(config, "device-code-123", 1, 60);

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(1000);
      // Advance past second interval
      await vi.advanceTimersByTimeAsync(1000);

      const tokens = await pollPromise;

      expect(tokens).toEqual({
        accessToken: "device-access-token",
        refreshToken: "device-refresh-token",
        expiresIn: 3600,
        tokenType: "Bearer",
        scope: "openid",
      });
    });

    it("should handle slow_down by increasing interval", async () => {
      const config = createMockConfig();

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({
              error: "slow_down",
              error_description: "Slow down",
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: "token",
              refresh_token: "refresh",
              expires_in: 3600,
              token_type: "Bearer",
            }),
        });

      vi.stubGlobal("fetch", mockFetch);

      const pollPromise = pollForDeviceTokens(config, "device-code", 1, 60);

      // First interval: 1 second
      await vi.advanceTimersByTimeAsync(1000);
      // After slow_down, interval becomes 1+5=6 seconds
      await vi.advanceTimersByTimeAsync(6000);

      const tokens = await pollPromise;
      expect(tokens.accessToken).toBe("token");
    });

    it("should throw on fatal error (not pending or slow_down)", async () => {
      const config = createMockConfig();

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: "access_denied",
            error_description: "User denied access",
          }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const pollPromise = pollForDeviceTokens(config, "device-code", 1, 60);

      // Attach catch handler BEFORE advancing timers to prevent unhandled rejection
      const resultPromise = pollPromise.catch((e: Error) => e);

      await vi.advanceTimersByTimeAsync(1000);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Device token polling failed: access_denied - User denied access",
      );
    });

    it("should throw when device code expires", async () => {
      const config = createMockConfig();

      // Always return authorization_pending
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: "authorization_pending",
          }),
      });

      vi.stubGlobal("fetch", mockFetch);

      // expiresIn=2 seconds, interval=1 second
      const pollPromise = pollForDeviceTokens(config, "device-code", 1, 2);

      // Attach catch handler BEFORE advancing timers to prevent unhandled rejection
      const resultPromise = pollPromise.catch((e: Error) => e);

      // Advance past 1s interval + check, then past 1s interval + check, then expiry
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Device code expired");
    });
  });

  // ── startCallbackServer ────────────────────────────────────────────

  describe("startCallbackServer", () => {
    it("should resolve with code when valid callback is received", async () => {
      const port = 18901;
      const state = "test-state-abc";
      const codePromise = startCallbackServer(port, state);

      const response = await simulateRequest(
        `/callback?code=auth-code-xyz&state=${state}`,
      );
      expect(response.status).toBe(200);

      const code = await codePromise;
      expect(code).toBe("auth-code-xyz");
    });

    it("should reject when error parameter is present", async () => {
      const port = 18902;
      const state = "test-state";
      const codePromise = startCallbackServer(port, state);

      // Attach catch handler immediately to prevent unhandled rejection
      const resultPromise = codePromise.catch((e: Error) => e);

      const response = await simulateRequest(`/callback?error=access_denied`);
      expect(response.status).toBe(400);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("OAuth error: access_denied");
    });

    it("should reject when state does not match", async () => {
      const port = 18903;
      const state = "expected-state";
      const codePromise = startCallbackServer(port, state);

      // Attach catch handler immediately to prevent unhandled rejection
      const resultPromise = codePromise.catch((e: Error) => e);

      const response = await simulateRequest(`/callback?code=abc&state=wrong-state`);
      expect(response.status).toBe(400);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid state parameter");
    });

    it("should reject when no code is present", async () => {
      const port = 18904;
      const state = "test-state";
      const codePromise = startCallbackServer(port, state);

      // Attach catch handler immediately to prevent unhandled rejection
      const resultPromise = codePromise.catch((e: Error) => e);

      const response = await simulateRequest(`/callback?state=${state}`);
      expect(response.status).toBe(400);

      const error = await resultPromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("No authorization code");
    });

    it("should return 404 for non-callback paths", async () => {
      const port = 18905;
      const state = "test-state";
      const codePromise = startCallbackServer(port, state);

      const response = await simulateRequest(`/other-path`);
      expect(response.status).toBe(404);

      // Clean up: send a valid callback to close the server
      await simulateRequest(`/callback?code=cleanup&state=${state}`);
      await codePromise;
    });
  });

  // ── browserOAuthFlow ───────────────────────────────────────────────

  describe("browserOAuthFlow", () => {
    it("should perform browser-based OAuth flow end-to-end", async () => {
      const config = createMockConfig({
        redirectUri: "http://localhost:18906/callback",
      });

      // Mock exec for openBrowser (darwin)
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin", writable: true });
      mockExec.mockImplementation((_cmd: unknown, callback: unknown) => {
        if (typeof callback === "function") {
          (callback as (err: null) => void)(null);
        }
        return {} as ReturnType<typeof exec>;
      });

      // Mock fetch for exchangeCodeForTokens
      const mockFetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: "browser-access",
            refresh_token: "browser-refresh",
            expires_in: 3600,
            token_type: "Bearer",
          }),
      });
      vi.stubGlobal("fetch", mockFetchFn);

      let capturedUrl: string | undefined;
      const flowPromise = browserOAuthFlow(config, (url) => {
        capturedUrl = url;
      });

      // Extract state from the captured URL
      expect(capturedUrl).toBeDefined();
      const parsed = new URL(capturedUrl!);
      const state = parsed.searchParams.get("state")!;

      await simulateRequest(`/callback?code=browser-code&state=${state}`);

      const tokens = await flowPromise;
      expect(tokens.accessToken).toBe("browser-access");
      expect(tokens.refreshToken).toBe("browser-refresh");

      Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    });
  });

  // ── deviceCodeOAuthFlow ────────────────────────────────────────────

  describe("deviceCodeOAuthFlow", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should perform device code flow end-to-end", async () => {
      const config = createMockConfig({
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
      });

      // First call: requestDeviceCode, second: pollForDeviceTokens (pending), third: success
      const mockFetchFn = vi
        .fn()
        // requestDeviceCode response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              device_code: "dev-code-flow",
              user_code: "FLOW-CODE",
              verification_uri: "https://auth.example.com/verify",
              expires_in: 60,
              interval: 1,
            }),
        })
        // first poll: pending
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: "authorization_pending" }),
        })
        // second poll: success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: "device-flow-access",
              refresh_token: "device-flow-refresh",
              expires_in: 3600,
              token_type: "Bearer",
            }),
        });

      vi.stubGlobal("fetch", mockFetchFn);

      let capturedCode: unknown;
      const flowPromise = deviceCodeOAuthFlow(config, (code) => {
        capturedCode = code;
      });

      // Let the requestDeviceCode resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(capturedCode).toBeDefined();
      expect((capturedCode as { userCode: string }).userCode).toBe("FLOW-CODE");

      // Advance past first poll interval
      await vi.advanceTimersByTimeAsync(1000);
      // Advance past second poll interval
      await vi.advanceTimersByTimeAsync(1000);

      const tokens = await flowPromise;
      expect(tokens.accessToken).toBe("device-flow-access");
      expect(tokens.refreshToken).toBe("device-flow-refresh");
    });
  });
});

// ── token-store.ts tests ─────────────────────────────────────────────────

describe("token-store", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to avoid XDG_CONFIG_HOME interference
    process.env = { ...originalEnv };
    delete process.env.XDG_CONFIG_HOME;

    // Default: mkdir succeeds
    mockMkdir.mockResolvedValue(undefined);
    // Default: writeFile succeeds
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("saveToken", () => {
    it("should save a token for a provider", async () => {
      // loadTokenStore: ENOENT (first time)
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      await saveToken("openai", {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresIn: 3600,
        tokenType: "Bearer",
        scope: "openid",
      });

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledTimes(1);

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent.version).toBe(1);
      expect(writtenContent.tokens.openai.accessToken).toBe("access-123");
      expect(writtenContent.tokens.openai.refreshToken).toBe("refresh-456");
      expect(writtenContent.tokens.openai.provider).toBe("openai");
      expect(writtenContent.tokens.openai.createdAt).toBe(now);
      expect(writtenContent.tokens.openai.expiresAt).toBe(now + 3600 * 1000);

      vi.spyOn(Date, "now").mockRestore();
    });

    it("should update existing store when saving", async () => {
      // loadTokenStore: returns existing data
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            anthropic: {
              accessToken: "old-access",
              tokenType: "Bearer",
              provider: "anthropic",
              createdAt: 1000,
            },
          },
        }),
      );

      await saveToken("openai", {
        accessToken: "new-access",
        tokenType: "Bearer",
      });

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent.tokens.anthropic).toBeDefined();
      expect(writtenContent.tokens.openai).toBeDefined();
      expect(writtenContent.tokens.openai.accessToken).toBe("new-access");
    });

    it("should not set expiresAt when expiresIn is undefined", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      await saveToken("openai", {
        accessToken: "access",
        tokenType: "Bearer",
        // no expiresIn
      });

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent.tokens.openai.expiresAt).toBeUndefined();
    });

    it("should write with mode 0o600", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      await saveToken("test", {
        accessToken: "a",
        tokenType: "Bearer",
      });

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
        mode: 0o600,
      });
    });

    it("should create config dir with mode 0o700", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      await saveToken("test", {
        accessToken: "a",
        tokenType: "Bearer",
      });

      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
        mode: 0o700,
      });
    });

    it("should handle EEXIST error from mkdir gracefully", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      mockMkdir.mockRejectedValueOnce(Object.assign(new Error("EEXIST"), { code: "EEXIST" }));

      await expect(
        saveToken("test", { accessToken: "a", tokenType: "Bearer" }),
      ).resolves.toBeUndefined();
    });

    it("should throw non-EEXIST mkdir errors", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      mockMkdir.mockRejectedValueOnce(
        Object.assign(new Error("Permission denied"), { code: "EACCES" }),
      );

      await expect(saveToken("test", { accessToken: "a", tokenType: "Bearer" })).rejects.toThrow(
        "Permission denied",
      );
    });
  });

  describe("getToken", () => {
    it("should return token for existing provider", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "access-123",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: 1000,
            },
          },
        }),
      );

      const token = await getToken("openai");
      expect(token).not.toBeNull();
      expect(token!.accessToken).toBe("access-123");
    });

    it("should return null for non-existing provider", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 1, tokens: {} }));

      const token = await getToken("nonexistent");
      expect(token).toBeNull();
    });

    it("should return empty store when file does not exist", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const token = await getToken("anything");
      expect(token).toBeNull();
    });

    it("should reset store when version is not 1", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 2,
          tokens: { openai: { accessToken: "old" } },
        }),
      );

      const token = await getToken("openai");
      expect(token).toBeNull();
    });

    it("should re-throw non-ENOENT read errors", async () => {
      mockReadFile.mockRejectedValueOnce(
        Object.assign(new Error("Permission denied"), { code: "EACCES" }),
      );

      await expect(getToken("test")).rejects.toThrow("Permission denied");
    });
  });

  describe("getValidToken", () => {
    it("should return null when no token stored", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const result = await getValidToken("openai");
      expect(result).toBeNull();
    });

    it("should return accessToken when not expired", async () => {
      const future = Date.now() + 60 * 60 * 1000; // 1 hour in the future
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "valid-token",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: Date.now(),
              expiresAt: future,
            },
          },
        }),
      );

      const result = await getValidToken("openai");
      expect(result).toBe("valid-token");
    });

    it("should refresh expired token when refreshFn provided", async () => {
      const past = Date.now() - 60000; // expired
      // First call: getToken reads store (expired token)
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "expired-token",
              refreshToken: "refresh-123",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: past - 3600000,
              expiresAt: past,
            },
          },
        }),
      );

      // Second call: saveToken reads store inside saveToken
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "expired-token",
              refreshToken: "refresh-123",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: past - 3600000,
              expiresAt: past,
            },
          },
        }),
      );

      const refreshFn = vi.fn().mockResolvedValue({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
        tokenType: "Bearer",
      });

      const result = await getValidToken("openai", refreshFn);
      expect(result).toBe("new-access-token");
      expect(refreshFn).toHaveBeenCalledWith("refresh-123");
    });

    it("should delete token and return null when refresh fails", async () => {
      const past = Date.now() - 60000;
      // getToken read
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "expired",
              refreshToken: "bad-refresh",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: past - 3600000,
              expiresAt: past,
            },
          },
        }),
      );
      // deleteToken's loadTokenStore read
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "expired",
              refreshToken: "bad-refresh",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: past - 3600000,
              expiresAt: past,
            },
          },
        }),
      );

      const refreshFn = vi.fn().mockRejectedValue(new Error("refresh failed"));

      const result = await getValidToken("openai", refreshFn);
      expect(result).toBeNull();
    });

    it("should delete token and return null when expired and no refresh token", async () => {
      const past = Date.now() - 60000;
      // getToken read
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "expired",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: past - 3600000,
              expiresAt: past,
              // no refreshToken
            },
          },
        }),
      );
      // deleteToken's loadTokenStore read
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "expired",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: past - 3600000,
              expiresAt: past,
            },
          },
        }),
      );

      const result = await getValidToken("openai");
      expect(result).toBeNull();
    });

    it("should return token when expiresAt is not set (no expiry)", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: {
              accessToken: "no-expiry-token",
              tokenType: "Bearer",
              provider: "openai",
              createdAt: Date.now(),
              // no expiresAt
            },
          },
        }),
      );

      const result = await getValidToken("openai");
      expect(result).toBe("no-expiry-token");
    });
  });

  describe("deleteToken", () => {
    it("should remove a token from the store", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: { accessToken: "a", tokenType: "Bearer", provider: "openai", createdAt: 1 },
            anthropic: {
              accessToken: "b",
              tokenType: "Bearer",
              provider: "anthropic",
              createdAt: 2,
            },
          },
        }),
      );

      await deleteToken("openai");

      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent.tokens.openai).toBeUndefined();
      expect(writtenContent.tokens.anthropic).toBeDefined();
    });
  });

  describe("listTokens", () => {
    it("should return all stored tokens", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: { accessToken: "a", tokenType: "Bearer", provider: "openai", createdAt: 1 },
            anthropic: {
              accessToken: "b",
              tokenType: "Bearer",
              provider: "anthropic",
              createdAt: 2,
            },
          },
        }),
      );

      const tokens = await listTokens();
      expect(tokens).toHaveLength(2);
      expect(tokens.map((t) => t.provider)).toContain("openai");
      expect(tokens.map((t) => t.provider)).toContain("anthropic");
    });

    it("should return empty array when no tokens stored", async () => {
      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      const tokens = await listTokens();
      expect(tokens).toEqual([]);
    });
  });

  describe("hasToken", () => {
    it("should return true for existing provider", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          tokens: {
            openai: { accessToken: "a", tokenType: "Bearer", provider: "openai", createdAt: 1 },
          },
        }),
      );

      const result = await hasToken("openai");
      expect(result).toBe(true);
    });

    it("should return false for non-existing provider", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 1, tokens: {} }));

      const result = await hasToken("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("clearAllTokens", () => {
    it("should write an empty token store", async () => {
      await clearAllTokens();

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writtenContent = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenContent).toEqual({ version: 1, tokens: {} });
    });
  });

  describe("XDG_CONFIG_HOME", () => {
    it("should use XDG_CONFIG_HOME when set", async () => {
      process.env.XDG_CONFIG_HOME = "/custom/config";

      mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

      await saveToken("test", { accessToken: "a", tokenType: "Bearer" });

      const writePath = mockWriteFile.mock.calls[0]![0] as string;
      expect(writePath).toContain("/custom/config/coco/auth.json");
    });
  });
});

// ── auth/index.ts tests ──────────────────────────────────────────────────

describe("auth/index", () => {
  describe("OAUTH_CONFIGS", () => {
    it("should have openai config with all required fields", () => {
      const config = OAUTH_CONFIGS.openai;
      expect(config.authorizationUrl).toContain("openai.com");
      expect(config.tokenUrl).toContain("openai.com");
      expect(config.clientId).toBeTruthy();
      expect(config.redirectUri).toContain("localhost");
      expect(config.scopes).toContain("openid");
      expect(config.deviceAuthorizationUrl).toBeDefined();
    });

    it("should have anthropic config", () => {
      const config = OAUTH_CONFIGS.anthropic;
      expect(config.authorizationUrl).toContain("anthropic.com");
      expect(config.tokenUrl).toContain("anthropic.com");
      expect(config.clientId).toBeTruthy();
      expect(config.scopes.length).toBeGreaterThan(0);
    });

    it("should have google config", () => {
      const config = OAUTH_CONFIGS.google;
      expect(config.authorizationUrl).toContain("google.com");
      expect(config.tokenUrl).toContain("googleapis.com");
      expect(config.scopes.length).toBeGreaterThan(0);
    });
  });

  describe("getAuthMethods", () => {
    it("should return api_key, oauth_browser, oauth_device for openai", () => {
      const methods = getAuthMethods("openai");
      expect(methods).toContain("api_key");
      expect(methods).toContain("oauth_browser");
      expect(methods).toContain("oauth_device");
    });

    it("should return api_key for anthropic", () => {
      const methods = getAuthMethods("anthropic");
      expect(methods).toEqual(["api_key"]);
    });

    it("should return api_key and gcloud for gemini", () => {
      const methods = getAuthMethods("gemini");
      expect(methods).toContain("api_key");
      expect(methods).toContain("gcloud");
    });

    it("should return api_key for kimi", () => {
      const methods = getAuthMethods("kimi");
      expect(methods).toEqual(["api_key"]);
    });

    it("should return api_key for lmstudio", () => {
      const methods = getAuthMethods("lmstudio");
      expect(methods).toEqual(["api_key"]);
    });

    it("should return api_key for ollama", () => {
      const methods = getAuthMethods("ollama");
      expect(methods).toEqual(["api_key"]);
    });

    it("should return api_key for unknown providers", () => {
      const methods = getAuthMethods("unknown-provider");
      expect(methods).toEqual(["api_key"]);
    });
  });
});
