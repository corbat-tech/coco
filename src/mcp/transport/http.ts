/**
 * MCP HTTP Transport Implementation
 *
 * Handles communication with MCP servers via HTTP/HTTPS with OAuth support.
 */

import type {
  MCPTransport,
  JSONRPCRequest,
  JSONRPCResponse,
} from '../types.js';
import { MCPConnectionError, MCPTransportError } from '../errors.js';

/**
 * HTTP transport configuration
 */
export interface HTTPTransportConfig {
  /** Server URL */
  url: string;
  /** Authentication configuration */
  auth?: {
    type: 'oauth' | 'bearer' | 'apikey';
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

  constructor(private readonly config: HTTPTransportConfig) {
    this.config.timeout = config.timeout ?? 60000;
    this.config.retries = config.retries ?? 3;
  }

  /**
   * Get authentication token
   */
  private getAuthToken(): string | undefined {
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
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.config.headers,
    };

    const token = this.getAuthToken();
    if (token && this.config.auth) {
      switch (this.config.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${token}`;
          break;
        case 'apikey':
          headers[this.config.auth.headerName || 'X-API-Key'] = token;
          break;
        case 'oauth':
          headers['Authorization'] = `Bearer ${token}`;
          break;
      }
    }

    return headers;
  }

  /**
   * Connect to the HTTP transport
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new MCPConnectionError('Transport already connected');
    }

    // Validate URL
    try {
      // eslint-disable-next-line no-new
      new URL(this.config.url);
    } catch {
      throw new MCPConnectionError(`Invalid URL: ${this.config.url}`);
    }

    // Test connection with a simple request
    try {
      this.abortController = new AbortController();
      
      const response = await fetch(this.config.url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: this.abortController.signal,
      });

      if (!response.ok && response.status !== 404) {
        // 404 is acceptable - endpoint might not support GET
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.connected = true;
    } catch (error) {
      if (error instanceof MCPError) {
        this.reportError(error);
        throw error;
      }
      const connError = new MCPConnectionError(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
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
      throw new MCPTransportError('Transport not connected');
    }

    const abortController = new AbortController();
    this.pendingRequests.set(message.id, abortController);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retries!; attempt++) {
      try {
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, this.config.timeout);

        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(message),
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new MCPTransportError(
            `HTTP error ${response.status}: ${response.statusText}`
          );
        }

        const data = (await response.json()) as JSONRPCResponse;
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
      `Request failed after ${this.config.retries} attempts: ${lastError?.message}`
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
import { MCPError } from '../errors.js';
