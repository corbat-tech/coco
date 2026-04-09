/**
 * MCP HTTP Transport Implementation
 *
 * Handles communication with MCP servers via HTTP/HTTPS with OAuth support.
 */

import type { MCPTransport, JSONRPCRequest, JSONRPCResponse } from "../types.js";
import { MCPConnectionError, MCPTransportError } from "../errors.js";
import { authenticateMcpOAuth, getStoredMcpOAuthToken } from "../oauth.js";

/**
 * HTTP transport configuration
 */
export interface HTTPTransportConfig {
  /** MCP server name (for logs/errors) */
  name?: string;
  /** Server URL */
  url: string;
  /** Authentication configuration */
  auth?: {
    type: "oauth" | "bearer" | "apikey";
    /** Token value (or loaded from tokenEnv) */
    token?: string;
    /** Environment variable containing token */
    tokenEnv?: string;
    /** API key header name (for apikey auth) */
    headerName?: string;
  };
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Retry attempts */
  retries?: number;
}

/**
 * HTTP transport for MCP communication
 */
export class HTTPTransport implements MCPTransport {
  private messageCallback: ((message: JSONRPCResponse) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  // Used to report transport errors to the client
  private reportError(error: Error): void {
    this.errorCallback?.(error);
  }
  private closeCallback: (() => void) | null = null;
  private connected = false;
  private abortController: AbortController | null = null;
  private pendingRequests = new Map<string | number, AbortController>();
  private oauthToken: string | undefined;
  private oauthInFlight: Promise<string> | null = null;
  private sessionId: string | undefined;
  private protocolVersion = "2024-11-05";

  constructor(private readonly config: HTTPTransportConfig) {
    this.config.timeout = config.timeout ?? 60000;
    this.config.retries = config.retries ?? 3;
  }

  /**
   * Get authentication token
   */
  private getAuthToken(): string | undefined {
    if (this.oauthToken) {
      return this.oauthToken;
    }

    if (!this.config.auth) return undefined;

    // Try token directly
    if (this.config.auth.token) {
      return this.config.auth.token;
    }

    // Try environment variable
    if (this.config.auth.tokenEnv) {
      return process.env[this.config.auth.tokenEnv];
    }

    return undefined;
  }

  /**
   * Build request headers
   */
  private buildHeaders(method: "GET" | "POST"): Record<string, string> {
    const headers: Record<string, string> = {
      ...(method === "POST"
        ? {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          }
        : {
            Accept: "text/event-stream",
          }),
      ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
      ...this.config.headers,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    if (this.oauthToken) {
      headers["Authorization"] = `Bearer ${this.oauthToken}`;
      return headers;
    }

    const token = this.getAuthToken();
    if (token && this.config.auth) {
      if (this.config.auth.type === "apikey") {
        headers[this.config.auth.headerName || "X-API-Key"] = token;
      } else {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  private shouldAttemptOAuth(): boolean {
    if (this.config.auth?.type === "apikey") {
      return false;
    }
    // If bearer auth is configured and token is present, do not override with OAuth.
    // If token is missing (e.g., env var not set), allow OAuth fallback.
    if (this.config.auth?.type === "bearer") {
      return !this.getAuthToken();
    }
    return true;
  }

  private async ensureOAuthToken(
    wwwAuthenticateHeader?: string | null,
    options?: { forceRefresh?: boolean },
  ): Promise<string> {
    if (this.oauthToken && !options?.forceRefresh) {
      return this.oauthToken;
    }

    if (this.oauthInFlight) {
      return this.oauthInFlight;
    }

    const serverName = this.config.name ?? this.config.url;
    if (options?.forceRefresh) {
      this.oauthToken = undefined;
    }
    this.oauthInFlight = authenticateMcpOAuth({
      serverName,
      resourceUrl: this.config.url,
      wwwAuthenticateHeader,
      forceRefresh: options?.forceRefresh,
    })
      .then((token) => {
        this.oauthToken = token;
        return token;
      })
      .finally(() => {
        this.oauthInFlight = null;
      });

    return this.oauthInFlight;
  }

  private async sendRequestWithOAuthRetry(
    method: "GET" | "POST",
    body?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const doFetch = async (): Promise<Response> =>
      fetch(this.config.url, {
        method,
        headers: this.buildHeaders(method),
        ...(body ? { body } : {}),
        signal,
      });

    let response = await doFetch();
    if (response.status !== 401 || !this.shouldAttemptOAuth()) {
      // Some servers include OAuth challenge headers even on non-401 responses.
      // If we don't have a token yet and challenge is present, bootstrap OAuth now.
      if (
        this.shouldAttemptOAuth() &&
        !this.oauthToken &&
        response.headers.get("www-authenticate")
      ) {
        await this.ensureOAuthToken(response.headers.get("www-authenticate"));
        response = await doFetch();
      }
      return response;
    }

    await this.ensureOAuthToken(response.headers.get("www-authenticate"), { forceRefresh: true });
    response = await doFetch();
    return response;
  }

  private looksLikeAuthErrorMessage(message?: string): boolean {
    if (!message) return false;
    const msg = message.toLowerCase();
    const hasStrongAuthSignal =
      msg.includes("unauthorized") ||
      msg.includes("unauthorised") ||
      msg.includes("authentication") ||
      msg.includes("oauth") ||
      msg.includes("access token") ||
      msg.includes("invalid_token") ||
      msg.includes("invalid token") ||
      msg.includes("token expired") ||
      msg.includes("bearer") ||
      msg.includes("not authenticated") ||
      msg.includes("not logged") ||
      msg.includes("login") ||
      (msg.includes("generate") && msg.includes("token"));
    const hasVendorHint =
      msg.includes("gemini cli") ||
      msg.includes("jira") ||
      msg.includes("confluence") ||
      msg.includes("atlassian");
    const hasWeakAuthSignal =
      msg.includes("authenticate") || msg.includes("token") || msg.includes("authorization");
    return (
      hasStrongAuthSignal ||
      // Vendor-specific hints alone are not enough; require an auth-related token too.
      (hasVendorHint && hasWeakAuthSignal)
    );
  }

  private isJsonRpcAuthError(payload: JSONRPCResponse): boolean {
    if (!payload.error) return false;
    return this.looksLikeAuthErrorMessage(payload.error.message);
  }

  private captureResponseSession(response: Response): void {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }
  }

  private async parseSseResponse(response: Response): Promise<void> {
    if (!response.body) {
      throw new MCPTransportError("SSE response has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventData = "";

    const flushEvent = (): void => {
      if (!eventData) return;
      const payload = eventData.trim();
      eventData = "";
      if (!payload) return;

      const parsed = JSON.parse(payload) as JSONRPCResponse;
      if (
        parsed.result &&
        typeof parsed.result === "object" &&
        parsed.result !== null &&
        "protocolVersion" in parsed.result &&
        typeof (parsed.result as { protocolVersion?: unknown }).protocolVersion === "string"
      ) {
        this.protocolVersion = (parsed.result as { protocolVersion: string }).protocolVersion;
      }
      this.messageCallback?.(parsed);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          flushEvent();
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          eventData += (eventData ? "\n" : "") + line.slice(5).trimStart();
        }
      }
    }

    if (buffer.length > 0 && buffer.startsWith("data:")) {
      eventData += (eventData ? "\n" : "") + buffer.slice(5).trimStart();
    }
    flushEvent();
  }

  /**
   * Connect to the HTTP transport
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new MCPConnectionError("Transport already connected");
    }

    // Validate URL
    try {
      // eslint-disable-next-line no-new
      new URL(this.config.url);
    } catch {
      throw new MCPConnectionError(`Invalid URL: ${this.config.url}`);
    }

    try {
      this.abortController = new AbortController();

      if (this.shouldAttemptOAuth()) {
        this.oauthToken = await getStoredMcpOAuthToken(this.config.url);
      }
      this.connected = true;
    } catch (error) {
      if (error instanceof MCPError) {
        this.reportError(error);
        throw error;
      }
      const connError = new MCPConnectionError(
        `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      this.reportError(connError);
      throw connError;
    }
  }

  /**
   * Send a message through the transport
   */
  async send(message: JSONRPCRequest): Promise<void> {
    if (!this.connected) {
      throw new MCPTransportError("Transport not connected");
    }

    const abortController = new AbortController();
    this.pendingRequests.set(message.id, abortController);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retries!; attempt++) {
      try {
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, this.config.timeout);

        const response = await this.sendRequestWithOAuthRetry(
          "POST",
          JSON.stringify(message),
          abortController.signal,
        );

        clearTimeout(timeoutId);
        this.captureResponseSession(response);

        if (!response.ok) {
          throw new MCPTransportError(`HTTP error ${response.status}: ${response.statusText}`);
        }

        if (response.status === 202) {
          return;
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (contentType.includes("text/event-stream")) {
          await this.parseSseResponse(response);
          return;
        }

        const data = (await response.json()) as JSONRPCResponse;
        if (
          data.result &&
          typeof data.result === "object" &&
          data.result !== null &&
          "protocolVersion" in data.result &&
          typeof (data.result as { protocolVersion?: unknown }).protocolVersion === "string"
        ) {
          this.protocolVersion = (data.result as { protocolVersion: string }).protocolVersion;
        }

        if (this.shouldAttemptOAuth() && this.isJsonRpcAuthError(data)) {
          await this.ensureOAuthToken(response.headers.get("www-authenticate"), {
            forceRefresh: true,
          });

          const retryResponse = await this.sendRequestWithOAuthRetry(
            "POST",
            JSON.stringify(message),
            abortController.signal,
          );

          this.captureResponseSession(retryResponse);
          if (!retryResponse.ok) {
            throw new MCPTransportError(
              `HTTP error ${retryResponse.status}: ${retryResponse.statusText}`,
            );
          }

          if (retryResponse.status === 202) {
            return;
          }

          const retryContentType = retryResponse.headers.get("content-type")?.toLowerCase() ?? "";
          if (retryContentType.includes("text/event-stream")) {
            await this.parseSseResponse(retryResponse);
            return;
          }

          const retryData = (await retryResponse.json()) as JSONRPCResponse;
          if (
            retryData.result &&
            typeof retryData.result === "object" &&
            retryData.result !== null &&
            "protocolVersion" in retryData.result &&
            typeof (retryData.result as { protocolVersion?: unknown }).protocolVersion === "string"
          ) {
            this.protocolVersion = (retryData.result as { protocolVersion: string }).protocolVersion;
          }
          this.messageCallback?.(retryData);
          return;
        }

        this.messageCallback?.(data);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof MCPTransportError) {
          this.reportError(error);
          throw error; // Don't retry transport errors
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.retries! - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    this.pendingRequests.delete(message.id);
    throw new MCPTransportError(
      `Request failed after ${this.config.retries} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Disconnect from the transport
   */
  async disconnect(): Promise<void> {
    // Abort all pending requests
    for (const [, controller] of this.pendingRequests) {
      controller.abort();
    }
    this.pendingRequests.clear();

    this.abortController?.abort();
    this.connected = false;
    this.closeCallback?.();
  }

  /**
   * Set callback for received messages
   */
  onMessage(callback: (message: JSONRPCResponse) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Set callback for errors
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Set callback for connection close
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  /**
   * Check if transport is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get transport URL
   */
  getURL(): string {
    return this.config.url;
  }

  /**
   * Get auth type
   */
  getAuthType(): string | undefined {
    return this.config.auth?.type;
  }
}

// Import for type checking
import { MCPError } from "../errors.js";
