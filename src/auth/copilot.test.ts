/**
 * Tests for GitHub Copilot authentication module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock fs module
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  };
});

// Mock child_process so getGitHubCliToken() cannot leak the host's `gh auth`
// state into tests. Without this, machines with an active `gh` session cause
// "no credentials" scenarios to fall through to a real token exchange.
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: unknown) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      const err = new Error("gh not mocked in this test") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      if (typeof callback === "function") {
        (callback as (e: Error | null, out?: string, errOut?: string) => void)(err);
      }
    }),
  };
});

import {
  requestGitHubDeviceCode,
  pollGitHubForToken,
  exchangeForCopilotToken,
  exchangeForCopilotTokenViaGhCli,
  getGitHubCliAuthStatus,
  getValidCopilotToken,
  saveCopilotCredentials,
  loadCopilotCredentials,
  deleteCopilotCredentials,
  getCopilotBaseUrl,
  CopilotAuthError,
  type CopilotCredentials,
} from "./copilot.js";

// Typed handle for the execFile mock so individual tests can override it
import { execFile } from "node:child_process";
const mockedExecFile = vi.mocked(execFile);

const mockedReadFile = vi.mocked(fs.readFile);
const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedMkdir = vi.mocked(fs.mkdir);
const mockedUnlink = vi.mocked(fs.unlink);

describe("Copilot Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["GITHUB_TOKEN"];
    delete process.env["GH_TOKEN"];
  });

  describe("requestGitHubDeviceCode", () => {
    it("should request device code from GitHub", async () => {
      const mockResponse = {
        device_code: "dc_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await requestGitHubDeviceCode();

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/device/code",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
        }),
      );

      // Verify client_id is sent
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.client_id).toBe("Iv1.b507a08c87ecfe98");
      expect(body.scope).toBe("read:user");
    });

    it("should throw on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(requestGitHubDeviceCode()).rejects.toThrow(
        "GitHub device code request failed: 500",
      );
    });
  });

  describe("pollGitHubForToken", () => {
    it("should return token on successful authorization", async () => {
      // First poll: pending, second poll: success
      mockFetch
        .mockResolvedValueOnce({
          json: async () => ({ error: "authorization_pending" }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            access_token: "gho_abc123",
            token_type: "bearer",
            scope: "read:user",
          }),
        });

      const token = await pollGitHubForToken("dc_123", 0.01, 10);

      expect(token).toBe("gho_abc123");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should increase interval on slow_down", async () => {
      mockFetch
        .mockResolvedValueOnce({
          json: async () => ({ error: "slow_down" }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            access_token: "gho_abc123",
            token_type: "bearer",
          }),
        });

      const token = await pollGitHubForToken("dc_123", 0.01, 30);
      expect(token).toBe("gho_abc123");
    });

    it("should throw on expired_token", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ error: "expired_token" }),
      });

      await expect(pollGitHubForToken("dc_123", 0.01, 10)).rejects.toThrow("Device code expired");
    });

    it("should throw on access_denied", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ error: "access_denied" }),
      });

      await expect(pollGitHubForToken("dc_123", 0.01, 10)).rejects.toThrow("Access denied");
    });

    it("should call onPoll callback", async () => {
      const onPoll = vi.fn();
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          access_token: "gho_abc123",
          token_type: "bearer",
        }),
      });

      await pollGitHubForToken("dc_123", 0.01, 10, onPoll);
      expect(onPoll).toHaveBeenCalledTimes(1);
    });
  });

  describe("exchangeForCopilotToken", () => {
    it("should exchange GitHub token for Copilot token", async () => {
      const mockCopilotToken = {
        token: "tid=copilot_token_123",
        refresh_in: 1500,
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        annotations: { copilot_plan: "individual" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockCopilotToken,
      });

      const result = await exchangeForCopilotToken("gho_abc123");

      expect(result).toEqual(mockCopilotToken);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/copilot_internal/v2/token",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "token gho_abc123",
          }),
        }),
      );
    });

    it("should throw CopilotAuthError(permanent=true) on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      try {
        await exchangeForCopilotToken("bad_token");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CopilotAuthError);
        expect((error as CopilotAuthError).permanent).toBe(true);
        expect((error as CopilotAuthError).message).toContain("invalid or expired");
      }
    });

    it("should throw CopilotAuthError(permanent=true) on 403 (no subscription)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      try {
        await exchangeForCopilotToken("gho_no_copilot");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CopilotAuthError);
        expect((error as CopilotAuthError).permanent).toBe(true);
        expect((error as CopilotAuthError).message).toContain("not enabled");
      }
    });

    it("should throw generic Error on 500 (NOT permanent)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      try {
        await exchangeForCopilotToken("gho_abc123");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).not.toBeInstanceOf(CopilotAuthError);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("500");
      }
    });
  });

  describe("getCopilotBaseUrl", () => {
    it("should return individual URL by default", () => {
      expect(getCopilotBaseUrl()).toBe("https://api.githubcopilot.com");
      expect(getCopilotBaseUrl(undefined)).toBe("https://api.githubcopilot.com");
    });

    it("should return correct URL for each account type", () => {
      expect(getCopilotBaseUrl("individual")).toBe("https://api.githubcopilot.com");
      expect(getCopilotBaseUrl("business")).toBe("https://api.business.githubcopilot.com");
      expect(getCopilotBaseUrl("enterprise")).toBe("https://api.enterprise.githubcopilot.com");
    });

    it("should return default for unknown account type", () => {
      expect(getCopilotBaseUrl("unknown")).toBe("https://api.githubcopilot.com");
    });
  });

  describe("Credential storage", () => {
    const creds: CopilotCredentials = {
      githubToken: "gho_abc123",
      copilotToken: "tid=copilot_123",
      copilotTokenExpiresAt: Date.now() + 1800000,
      accountType: "individual",
    };

    it("should save credentials with secure permissions", async () => {
      mockedMkdir.mockResolvedValueOnce(undefined);
      mockedWriteFile.mockResolvedValueOnce(undefined);

      await saveCopilotCredentials(creds);

      expect(mockedMkdir).toHaveBeenCalledWith(expect.stringContaining(".coco/tokens"), {
        recursive: true,
        mode: 0o700,
      });
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("copilot.json"),
        expect.any(String),
        { mode: 0o600 },
      );
    });

    it("should load and validate credentials", async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(creds));

      const loaded = await loadCopilotCredentials();
      expect(loaded).toEqual(creds);
    });

    it("should return null for corrupted JSON", async () => {
      mockedReadFile.mockResolvedValueOnce("not valid json{{{");

      const loaded = await loadCopilotCredentials();
      expect(loaded).toBeNull();
    });

    it("should return null for missing file", async () => {
      mockedReadFile.mockRejectedValueOnce(new Error("ENOENT"));

      const loaded = await loadCopilotCredentials();
      expect(loaded).toBeNull();
    });

    it("should return null for invalid schema (missing githubToken)", async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({ copilotToken: "abc" }));

      const loaded = await loadCopilotCredentials();
      expect(loaded).toBeNull();
    });

    it("should return null for empty githubToken", async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({ githubToken: "" }));

      const loaded = await loadCopilotCredentials();
      expect(loaded).toBeNull();
    });

    it("should delete credentials", async () => {
      mockedUnlink.mockResolvedValueOnce(undefined);

      await deleteCopilotCredentials();

      expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining("copilot.json"));
    });

    it("should not throw when deleting non-existent credentials", async () => {
      mockedUnlink.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(deleteCopilotCredentials()).resolves.toBeUndefined();
    });
  });

  describe("getValidCopilotToken", () => {
    it("should return cached token if not expired", async () => {
      const creds: CopilotCredentials = {
        githubToken: "gho_abc123",
        copilotToken: "tid=cached_token",
        copilotTokenExpiresAt: Date.now() + 300_000, // 5 min from now
        accountType: "individual",
      };

      mockedReadFile.mockResolvedValueOnce(JSON.stringify(creds));

      const result = await getValidCopilotToken();

      expect(result).toEqual({
        token: "tid=cached_token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: false,
      });
      // Should NOT call fetch (no refresh needed)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should refresh expired token", async () => {
      const creds: CopilotCredentials = {
        githubToken: "gho_abc123",
        copilotToken: "tid=old_token",
        copilotTokenExpiresAt: Date.now() - 1000, // expired
        accountType: "individual",
      };

      mockedReadFile.mockResolvedValue(JSON.stringify(creds));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);

      const newExpiry = Math.floor(Date.now() / 1000) + 1800;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          token: "tid=new_token",
          refresh_in: 1500,
          expires_at: newExpiry,
          annotations: { copilot_plan: "individual" },
        }),
      });

      const result = await getValidCopilotToken();

      expect(result).toEqual({
        token: "tid=new_token",
        baseUrl: "https://api.githubcopilot.com",
        isNew: true,
      });
    });

    it("should return null when no credentials exist", async () => {
      mockedReadFile.mockRejectedValueOnce(new Error("ENOENT"));

      const result = await getValidCopilotToken();
      expect(result).toBeNull();
    });

    it("should delete credentials on permanent auth error (401)", async () => {
      const creds: CopilotCredentials = {
        githubToken: "gho_expired",
        copilotToken: "tid=old",
        copilotTokenExpiresAt: Date.now() - 1000, // expired, triggers refresh
      };

      mockedReadFile.mockResolvedValue(JSON.stringify(creds));
      mockedUnlink.mockResolvedValue(undefined);

      // Simulate 401 from token exchange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await getValidCopilotToken();
      expect(result).toBeNull();
      expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining("copilot.json"));
    });

    it("should re-throw transient errors (500) without deleting credentials", async () => {
      const creds: CopilotCredentials = {
        githubToken: "gho_abc123",
        copilotToken: "tid=old",
        copilotTokenExpiresAt: Date.now() - 1000, // expired
      };

      mockedReadFile.mockResolvedValue(JSON.stringify(creds));

      // Simulate 500 from token exchange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      // Transient errors are re-thrown so the retry layer can handle them
      await expect(getValidCopilotToken()).rejects.toThrow("500");
      // Credentials should NOT be deleted for transient errors
      expect(mockedUnlink).not.toHaveBeenCalled();
    });

    it("should use GITHUB_TOKEN env var as override", async () => {
      process.env["GITHUB_TOKEN"] = "gho_from_env";

      const creds: CopilotCredentials = {
        githubToken: "gho_from_file",
        copilotToken: "tid=old",
        copilotTokenExpiresAt: Date.now() - 1000, // expired
      };

      mockedReadFile.mockResolvedValue(JSON.stringify(creds));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);

      const newExpiry = Math.floor(Date.now() / 1000) + 1800;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          token: "tid=new_token",
          refresh_in: 1500,
          expires_at: newExpiry,
        }),
      });

      await getValidCopilotToken();

      // Should use env var token, not file token
      const fetchHeaders = mockFetch.mock.calls[0][1].headers;
      expect(fetchHeaders.Authorization).toBe("token gho_from_env");
    });
  });

  describe("exchangeForCopilotTokenViaGhCli", () => {
    const validGhOutput = JSON.stringify({
      token: "tid=gh_cli_token",
      refresh_in: 1500,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      annotations: { copilot_plan: "business" },
    });

    it("returns parsed token when gh api succeeds", async () => {
      // execFile uses raw callback: (err, stdout, stderr) — no promisify wrapper
      mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (e: null, out: string, err: string) => void)(null, validGhOutput, "");
        return {} as ReturnType<typeof execFile>;
      });

      const result = await exchangeForCopilotTokenViaGhCli();
      expect(result?.token).toBe("tid=gh_cli_token");
      expect(result?.annotations?.copilot_plan).toBe("business");
    });

    it("returns null when gh is not installed", async () => {
      // default mock returns ENOENT error
      const result = await exchangeForCopilotTokenViaGhCli();
      expect(result).toBeNull();
    });

    it("returns null when gh returns invalid JSON", async () => {
      mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (e: null, out: string, err: string) => void)(null, "not-json", "");
        return {} as ReturnType<typeof execFile>;
      });

      const result = await exchangeForCopilotTokenViaGhCli();
      expect(result).toBeNull();
    });

    it("returns null when token fields are missing", async () => {
      mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (e: null, out: string, err: string) => void)(
          null,
          JSON.stringify({ some: "other" }),
          "",
        );
        return {} as ReturnType<typeof execFile>;
      });

      const result = await exchangeForCopilotTokenViaGhCli();
      expect(result).toBeNull();
    });
  });

  describe("getGitHubCliAuthStatus", () => {
    it("returns username when gh reports authenticated", async () => {
      mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (e: null, out: string, err: string) => void)(
          null,
          "Logged in to github.com account victor (keyring)\n",
          "",
        );
        return {} as ReturnType<typeof execFile>;
      });

      const result = await getGitHubCliAuthStatus();
      expect(result).toBe("victor");
    });

    it("returns 'authenticated' when gh confirms login without username match", async () => {
      mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        // Some gh versions write to stderr
        (cb as (e: null, out: string, err: string) => void)(
          null,
          "",
          "Logged in to github.com account corp-user (token)\n",
        );
        return {} as ReturnType<typeof execFile>;
      });

      const result = await getGitHubCliAuthStatus();
      expect(result).toBe("corp-user");
    });

    it("returns null when gh reports not authenticated", async () => {
      // default mock returns ENOENT
      const result = await getGitHubCliAuthStatus();
      expect(result).toBeNull();
    });
  });

  describe("getValidCopilotToken — gh cli fallback (corporate network)", () => {
    const expiredCreds: CopilotCredentials = {
      githubToken: "gho_abc123",
      copilotToken: "tid=old",
      copilotTokenExpiresAt: Date.now() - 1000, // expired
    };

    const ghApiOutput = JSON.stringify({
      token: "tid=gh_cli_fresh",
      refresh_in: 1500,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      annotations: { copilot_plan: "business" },
    });

    // getValidCopilotToken() always calls getGitHubCliToken() (execFile call #1
    // via promisify) before it calls exchangeForCopilotTokenViaGhCli() (execFile
    // call #2 via raw callback). The two calls use different invocation styles:
    //   getGitHubCliToken: promisify → callback is 3rd arg (no opts object)
    //   exchangeForCopilotTokenViaGhCli: raw → callback is 4th arg (with opts object)
    const enoentCb = (cb: unknown) => {
      const err = Object.assign(new Error("gh not mocked"), { code: "ENOENT" });
      if (typeof cb === "function") (cb as (e: Error) => void)(err);
    };
    const enoentMock = (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
      enoentCb(typeof _opts === "function" ? _opts : cb);
      return {} as ReturnType<typeof execFile>;
    };
    const successMock = (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      if (typeof callback === "function")
        (callback as (e: null, out: string, err: string) => void)(null, ghApiOutput, "");
      return {} as ReturnType<typeof execFile>;
    };

    it("uses gh cli when direct fetch returns 403 (corporate proxy scenario)", async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(expiredCreds));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);

      // Direct fetch returns 403 (from corporate proxy, not GitHub)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      // Call #1 (getGitHubCliToken via promisify) → ENOENT
      // Call #2 (exchangeForCopilotTokenViaGhCli via raw callback) → success
      mockedExecFile.mockImplementationOnce(enoentMock).mockImplementationOnce(successMock);

      const result = await getValidCopilotToken();

      // Should succeed via gh cli, NOT delete credentials
      expect(result?.token).toBe("tid=gh_cli_fresh");
      expect(mockedUnlink).not.toHaveBeenCalled();
    });

    it("uses gh cli when direct fetch fails with network error (PAC proxy)", async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(expiredCreds));
      mockedMkdir.mockResolvedValue(undefined);
      mockedWriteFile.mockResolvedValue(undefined);

      // Direct fetch throws network error (PAC proxy not followed by Node)
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      // Call #1 → ENOENT; call #2 → success
      mockedExecFile.mockImplementationOnce(enoentMock).mockImplementationOnce(successMock);

      const result = await getValidCopilotToken();
      expect(result?.token).toBe("tid=gh_cli_fresh");
    });

    it("deletes credentials when both direct fetch (403) and gh cli fail", async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(expiredCreds));
      mockedUnlink.mockResolvedValue(undefined);

      // Direct fetch returns 403
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });
      // Both calls to execFile return ENOENT (default mock behaviour)

      const result = await getValidCopilotToken();
      expect(result).toBeNull();
      expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining("copilot.json"));
    });

    it("re-throws when both direct fetch (network) and gh cli fail", async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(expiredCreds));

      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
      // Both execFile calls return ENOENT (default mock)

      await expect(getValidCopilotToken()).rejects.toThrow("fetch failed");
    });
  });

  describe("CopilotAuthError", () => {
    it("should be an Error with permanent flag", () => {
      const err = new CopilotAuthError("test", true);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CopilotAuthError");
      expect(err.permanent).toBe(true);
      expect(err.message).toBe("test");
    });

    it("should support non-permanent errors", () => {
      const err = new CopilotAuthError("transient", false);
      expect(err.permanent).toBe(false);
    });
  });
});
