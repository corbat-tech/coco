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

import {
  requestGitHubDeviceCode,
  pollGitHubForToken,
  exchangeForCopilotToken,
  getValidCopilotToken,
  saveCopilotCredentials,
  loadCopilotCredentials,
  deleteCopilotCredentials,
  getCopilotBaseUrl,
  CopilotAuthError,
  type CopilotCredentials,
} from "./copilot.js";

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

      await expect(pollGitHubForToken("dc_123", 0.01, 10)).rejects.toThrow(
        "Device code expired",
      );
    });

    it("should throw on access_denied", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ error: "access_denied" }),
      });

      await expect(pollGitHubForToken("dc_123", 0.01, 10)).rejects.toThrow(
        "Access denied",
      );
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

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining(".coco/tokens"),
        { recursive: true, mode: 0o700 },
      );
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
