/**
 * MCP HTTP Transport Implementation
 *
 * Handles communication with MCP servers via HTTP/HTTPS using configured or stored tokens.
 */

import type {
  MCPTransport,
  MCPOutboundMessage,
  MCPTransportSendOptions,
  JSONRPCResponse,
} from "../types.js";
import { MCPConnectionError, MCPTransportError } from "../errors.js";
import { authenticateMcpOAuth, getStoredMcpOAuthToken } from "../oauth.js";
import { createRequestScope } from "../../utils/request-scope.js";

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
  /** Retained for configuration compatibility; POST requests are never replayed. */
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
  private pendingRequests = new Set<AbortController>();
  private oauthToken: string | undefined;
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
    // If token is missing (e.g., env var not set), allow loading stored OAuth credentials.
    if (this.config.auth?.type === "bearer") {
      return !this.getAuthToken();
    }
    return true;
  }

  private captureResponseSession(response: Response): void {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }
  }

  private async parseSseResponse(response: Response, signal: AbortSignal): Promise<void> {
    if (!response.body) {
      throw new MCPTransportError("SSE response has no body");
    }

    signal.throwIfAborted();
    const reader = response.body.getReader();
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const decoder = new TextDecoder();
    let buffer = "";
    let eventData = "";

    const flushEvent = (): void => {
      if (!eventData) return;
      const payload = eventData.trim();
      eventData = "";
      if (!payload) return;

      signal.throwIfAborted();
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

    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          signal.throwIfAborted();
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

      signal.throwIfAborted();
      if (buffer.length > 0 && buffer.startsWith("data:")) {
        eventData += (eventData ? "\n" : "") + buffer.slice(5).trimStart();
      }
      flushEvent();
    } finally {
      signal.removeEventListener("abort", onAbort);
      try {
        await reader.cancel();
      } catch {
        // The transport may already have errored or cancelled this body.
      } finally {
        reader.releaseLock();
      }
    }
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
  async send(message: MCPOutboundMessage, options: MCPTransportSendOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    if (!this.connected) {
      throw new MCPTransportError("Transport not connected");
    }

    const controller = new AbortController();
    const hostSignal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const scope = createRequestScope(hostSignal, this.config.timeout!);
    this.pendingRequests.add(controller);
    let response: Response | undefined;
    let authenticating = false;
    try {
      scope.signal.throwIfAborted();
      // A failed POST may already have executed a mutating tool. Never replay it,
      // including in response to authentication-shaped JSON-RPC error messages.
      response = await fetch(this.config.url, {
        method: "POST",
        redirect: "error",
        headers: this.buildHeaders("POST"),
        body: JSON.stringify(message),
        signal: scope.signal,
      });
      scope.signal.throwIfAborted();
      // Only the initialization handshake may recover authentication automatically.
      // Tool requests and application-level error hints never authorize replay.
      if (message.method === "initialize" && response.status === 401 && this.shouldAttemptOAuth()) {
        const challenge = response.headers.get("www-authenticate");
        await response.body?.cancel();
        authenticating = true;
        const token = await authenticateMcpOAuth({
          serverName: this.config.name ?? this.config.url,
          resourceUrl: this.config.url,
          wwwAuthenticateHeader: challenge,
          forceRefresh: true,
          signal: scope.signal,
        });
        authenticating = false;
        scope.signal.throwIfAborted();
        this.oauthToken = token;
        response = await fetch(this.config.url, {
          method: "POST",
          redirect: "error",
          headers: this.buildHeaders("POST"),
          body: JSON.stringify(message),
          signal: scope.signal,
        });
        scope.signal.throwIfAborted();
      }
      this.captureResponseSession(response);
      if (!response.ok) {
        const guidance =
          response.status === 401
            ? "; configure a bearer/API-key token or use mcp-remote for OAuth authentication"
            : "";
        throw new MCPTransportError(
          `HTTP error ${response.status}: ${response.statusText}${guidance}`,
        );
      }
      if (response.status === 202 || response.status === 204) return;

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("text/event-stream")) {
        await this.parseSseResponse(response, scope.signal);
        scope.signal.throwIfAborted();
        return;
      }
      const data = (await response.json()) as JSONRPCResponse;
      scope.signal.throwIfAborted();
      if (
        data.result &&
        typeof data.result === "object" &&
        "protocolVersion" in data.result &&
        typeof (data.result as { protocolVersion?: unknown }).protocolVersion === "string"
      ) {
        this.protocolVersion = (data.result as { protocolVersion: string }).protocolVersion;
      }
      this.messageCallback?.(data);
    } catch (error) {
      // Auth owns cancellation normalization and must retain credential-save failures.
      if (authenticating) throw error;
      scope.signal.throwIfAborted();
      if (error instanceof MCPTransportError) throw error;
      throw new MCPTransportError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.pendingRequests.delete(controller);
      scope.dispose();
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => {});
      }
    }
  }

  /**
   * Disconnect from the transport
   */
  async disconnect(): Promise<void> {
    // Abort all pending requests
    for (const controller of this.pendingRequests) {
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
