import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../auth/callback-server.js", () => ({
  OAUTH_CALLBACK_PORT: 1455,
  createCallbackServer: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

import fs from "node:fs/promises";
import { createCallbackServer } from "../auth/callback-server.js";
import { authenticateMcpOAuth } from "./oauth.js";

describe("mcp oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  it("stores oauth token file with secure permissions", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("not found"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(createCallbackServer).mockResolvedValue({
      port: 1455,
      resultPromise: Promise.resolve({ code: "auth-code", state: "state" }),
    } as any);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization_servers: ["https://auth.example.com"] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.example.com/oauth2/authorize",
            token_endpoint: "https://auth.example.com/oauth2/token",
            registration_endpoint: "https://auth.example.com/oauth2/register",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: "client-123" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "token-123",
            refresh_token: "refresh-123",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      );

    const token = await authenticateMcpOAuth({
      serverName: "atlassian",
      resourceUrl: "https://mcp.atlassian.com/v1/mcp",
      wwwAuthenticateHeader:
        'Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource/v1/mcp"',
    });

    expect(token).toBe("token-123");
    expect(fs.writeFile).toHaveBeenCalled();
    const writeCall = vi.mocked(fs.writeFile).mock.calls.at(-1);
    expect(writeCall?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
  });

  it("uses refresh token path before interactive oauth", async () => {
    const now = Date.now();
    const expiredStore = {
      tokens: {
        "https://mcp.atlassian.com/v1/mcp": {
          accessToken: "old-token",
          refreshToken: "refresh-123",
          expiresAt: now - 1000,
          clientId: "client-123",
          authorizationServer: "https://auth.example.com",
          resource: "https://mcp.atlassian.com/v1/mcp",
        },
      },
      clients: {},
    };

    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(expiredStore));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization_servers: ["https://auth.example.com"] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.example.com/oauth2/authorize",
            token_endpoint: "https://auth.example.com/oauth2/token",
            registration_endpoint: "https://auth.example.com/oauth2/register",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "refreshed-token",
            refresh_token: "refresh-456",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );

    const token = await authenticateMcpOAuth({
      serverName: "atlassian",
      resourceUrl: "https://mcp.atlassian.com/v1/mcp",
      wwwAuthenticateHeader:
        'Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource/v1/mcp"',
    });

    expect(token).toBe("refreshed-token");
    expect(createCallbackServer).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.length).toBe(3);
  });

  it("forces refresh-token exchange even when cached access token is not locally expired", async () => {
    const now = Date.now();
    const cachedStore = {
      tokens: {
        "https://mcp.atlassian.com/v1/mcp": {
          accessToken: "still-cached-token",
          refreshToken: "refresh-123",
          expiresAt: now + 60_000,
          clientId: "client-123",
          authorizationServer: "https://auth.example.com",
          resource: "https://mcp.atlassian.com/v1/mcp",
        },
      },
      clients: {},
    };

    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cachedStore));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization_servers: ["https://auth.example.com"] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.example.com/oauth2/authorize",
            token_endpoint: "https://auth.example.com/oauth2/token",
            registration_endpoint: "https://auth.example.com/oauth2/register",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "refreshed-token",
            refresh_token: "refresh-456",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );

    const token = await authenticateMcpOAuth({
      serverName: "atlassian",
      resourceUrl: "https://mcp.atlassian.com/v1/mcp",
      forceRefresh: true,
    });

    expect(token).toBe("refreshed-token");
    expect(createCallbackServer).not.toHaveBeenCalled();
  });

  it("falls back to authorization-server metadata when protected-resource metadata is unavailable", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("not found"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(createCallbackServer).mockResolvedValue({
      port: 1455,
      resultPromise: Promise.resolve({ code: "auth-code", state: "state" }),
    } as any);

    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/.well-known/oauth-protected-resource")) {
        return new Response("404 Not Found", { status: 404 });
      }
      if (url === "https://mcp.atlassian.com/.well-known/oauth-authorization-server") {
        return new Response(
          JSON.stringify({
            issuer: "https://cf.mcp.atlassian.com",
            authorization_endpoint: "https://mcp.atlassian.com/v1/authorize",
            token_endpoint: "https://cf.mcp.atlassian.com/v1/token",
            registration_endpoint: "https://cf.mcp.atlassian.com/v1/register",
          }),
          { status: 200 },
        );
      }
      if (url === "https://cf.mcp.atlassian.com/v1/register") {
        return new Response(JSON.stringify({ client_id: "client-123" }), { status: 200 });
      }
      if (url === "https://cf.mcp.atlassian.com/v1/token") {
        return new Response(
          JSON.stringify({
            access_token: "token-123",
            refresh_token: "refresh-123",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const token = await authenticateMcpOAuth({
      serverName: "atlassian",
      resourceUrl: "https://mcp.atlassian.com/v1/mcp",
    });

    expect(token).toBe("token-123");
    expect(createCallbackServer).toHaveBeenCalledOnce();
  });
});
