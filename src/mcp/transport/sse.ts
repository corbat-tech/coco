/**
 * SSE (Server-Sent Events) Transport for MCP
 * Implements bidirectional communication using SSE for receiving and HTTP POST for sending
 */

import type { MCPTransport, JSONRPCRequest, JSONRPCResponse } from "../types.js";
import { MCPTransportError, MCPConnectionError } from "../errors.js";

/**
 * SSE transport configuration
 */
export interface SSETransportConfig {
  /** Base URL of the MCP SSE server */
  url: string;
  /** Optional headers for authentication */
  headers?: Record<string, string>;
  /** Reconnect delay in ms (default: 1000) */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
}

/**
 * Default SSE config
 */
const DEFAULT_CONFIG: Required<Omit<SSETransportConfig, "url" | "headers">> = {
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  maxReconnectAttempts: 10,
};

/**
 * SSE Transport implementation
 */
export class SSETransport implements MCPTransport {
  private config: SSETransportConfig & typeof DEFAULT_CONFIG;
  private connected = false;
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private lastEventId: string | null = null;
  private messageEndpoint: string | null = null;

  private messageHandler: ((message: JSONRPCResponse) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(config: SSETransportConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Connect to the SSE endpoint
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.abortController = new AbortController();
    this.reconnectAttempts = 0;

    // Set connected before startListening so processStream's while(this.connected) loop works
    this.connected = true;

    try {
      await this.startListening();
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  /**
   * Disconnect from the SSE endpoint
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
    this.abortController = null;
    this.messageEndpoint = null;
    this.closeHandler?.();
  }

  /**
   * Send a JSON-RPC message via HTTP POST
   */
  async send(message: JSONRPCRequest): Promise<void> {
    if (!this.connected) {
      throw new MCPConnectionError("Not connected to SSE endpoint");
    }

    // Use the message endpoint discovered during SSE connection
    const endpoint = this.messageEndpoint ?? `${this.config.url}/message`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify(message),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new MCPTransportError(
          `HTTP POST failed: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;

      if (error instanceof MCPTransportError) throw error;

      throw new MCPTransportError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Register message handler
   */
  onMessage(handler: (message: JSONRPCResponse) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Register error handler
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /**
   * Register close handler
   */
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Start listening to the SSE stream
   */
  private async startListening(): Promise<void> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      ...this.config.headers,
    };

    // Include Last-Event-ID for reconnection
    if (this.lastEventId) {
      headers["Last-Event-ID"] = this.lastEventId;
    }

    try {
      const response = await fetch(this.config.url, {
        method: "GET",
        headers,
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new MCPConnectionError(
          `SSE connection failed: ${response.status} ${response.statusText}`,
        );
      }

      if (!response.body) {
        throw new MCPConnectionError("SSE response has no body");
      }

      // Read SSE stream
      this.processStream(response.body);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;

      if (error instanceof MCPConnectionError) throw error;

      throw new MCPConnectionError(
        `Failed to connect to SSE: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Process the SSE stream
   */
  private async processStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let eventData = "";
    let eventId = "";

    try {
      while (this.connected) {
        const { done, value } = await reader.read();

        if (done) {
          // Stream ended, try to reconnect
          if (this.connected) {
            await this.handleReconnect();
          }
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete last line

        for (const line of lines) {
          if (line === "") {
            // Empty line = end of event
            if (eventData) {
              this.handleEvent(eventType, eventData, eventId);
              eventType = "";
              eventData = "";
              eventId = "";
            }
            continue;
          }

          if (line.startsWith(":")) {
            // Comment, ignore
            continue;
          }

          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;

          const field = line.slice(0, colonIdx);
          const value = line.slice(colonIdx + 1).trimStart();

          switch (field) {
            case "event":
              eventType = value;
              break;
            case "data":
              eventData += (eventData ? "\n" : "") + value;
              break;
            case "id":
              eventId = value;
              break;
            case "retry":
              // Update reconnect delay
              const delay = parseInt(value, 10);
              if (!isNaN(delay)) {
                this.config.initialReconnectDelay = delay;
              }
              break;
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;

      this.errorHandler?.(
        error instanceof Error ? error : new Error(String(error)),
      );

      // Try to reconnect on error
      if (this.connected) {
        await this.handleReconnect();
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle a complete SSE event
   */
  private handleEvent(type: string, data: string, id: string): void {
    // Track last event ID for reconnection
    if (id) {
      this.lastEventId = id;
    }

    // Handle special event types
    if (type === "endpoint") {
      // Server is telling us where to POST messages
      this.messageEndpoint = data;
      return;
    }

    // Parse JSON-RPC message
    try {
      const message = JSON.parse(data) as JSONRPCResponse;
      this.messageHandler?.(message);
    } catch {
      this.errorHandler?.(new Error(`Invalid JSON in SSE event: ${data.slice(0, 100)}`));
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (
      !this.connected ||
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.connected = false;
      this.closeHandler?.();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!this.connected) return;

    try {
      await this.startListening();
      this.reconnectAttempts = 0; // Reset on successful reconnection
    } catch {
      // Will retry on next iteration
      if (this.connected) {
        await this.handleReconnect();
      }
    }
  }
}
