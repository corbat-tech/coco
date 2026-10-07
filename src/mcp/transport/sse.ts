/**
 * SSE (Server-Sent Events) Transport for MCP
 * Implements bidirectional communication using SSE for receiving and HTTP POST for sending
 */

import type {
  MCPTransport,
  MCPOutboundMessage,
  MCPTransportSendOptions,
  JSONRPCResponse,
} from "../types.js";
import { setTimeout as delay } from "node:timers/promises";
import { createRequestScope } from "../../utils/request-scope.js";
import { rethrowCancellation } from "../../utils/cancellation.js";
import { MCPTransportError, MCPConnectionError } from "../errors.js";
import { boundedEventLines, MCPMessageLimitError } from "./limits.js";

/**
 * SSE transport configuration
 */
export interface SSETransportConfig {
  /** Base URL of the MCP SSE server */
  url: string;
  /** Optional headers for authentication */
  headers?: Record<string, string>;
  /** POST and GET-header deadline in ms; zero disables it. */
  timeout?: number;
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
  timeout: 60000,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  maxReconnectAttempts: 10,
};

/**
 * SSE Transport implementation
 */
class SSEEndpointError extends MCPTransportError {}

export class SSETransport implements MCPTransport {
  private config: SSETransportConfig & typeof DEFAULT_CONFIG;
  private connected = false;
  private abortController: AbortController | null = null;
  private connecting: Promise<void> | null = null;
  private receiver: Promise<void> | null = null;
  private sends = new Set<Promise<void>>();
  private closing: Promise<void> | null = null;
  private lastEventId: string | null = null;
  private messageEndpoint: string | null = null;

  private messageHandler: ((message: JSONRPCResponse) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(config: SSETransportConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    for (const name of ["timeout", "initialReconnectDelay", "maxReconnectDelay"] as const) {
      const value = this.config[name];
      if (!Number.isFinite(value) || value < 0 || value > 2147483647) {
        throw new RangeError(`${name} must be between 0 and 2147483647ms`);
      }
    }
    if (
      !Number.isSafeInteger(this.config.maxReconnectAttempts) ||
      this.config.maxReconnectAttempts < 0
    ) {
      throw new RangeError("maxReconnectAttempts must be a nonnegative safe integer");
    }
  }

  /**
   * Connect to the SSE endpoint
   */
  async connect(): Promise<void> {
    if (this.closing) await this.closing;
    if (this.connecting) return this.connecting;
    if (this.connected) return;
    if (this.abortController) {
      await this.disconnect();
      return this.connect();
    }
    const controller = new AbortController();
    this.abortController = controller;
    this.messageEndpoint = null;
    this.lastEventId = null;
    const opening = this.openStream(controller.signal).then(async (stream) => {
      if (controller.signal.aborted) {
        stream.dispose();
        await stream.response.body?.cancel().catch(() => {});
        controller.signal.throwIfAborted();
      }
      this.connected = true;
      // Defer reception so its promise is owned before any event can trigger close.
      this.receiver = Promise.resolve().then(() => this.receive(stream, controller));
      void this.receiver.catch(() => {});
    });
    this.connecting = opening;
    try {
      await opening;
    } catch (error) {
      this.finishConnection(controller);
      throw error;
    } finally {
      if (this.connecting === opening) this.connecting = null;
    }
  }

  /** Abort this generation, then wait until its receiver and pending open settle. */
  async disconnect(): Promise<void> {
    if (this.closing) return this.closing;
    const controller = this.abortController;
    if (!controller) return;
    this.connected = false;
    controller.abort();
    const closing = (async () => {
      try {
        await this.connecting?.catch(() => {});
        await this.receiver?.catch(() => {});
        await Promise.allSettled(this.sends);
      } finally {
        this.finishConnection(controller);
      }
    })();
    this.closing = closing;
    try {
      await closing;
    } finally {
      if (this.closing === closing) this.closing = null;
    }
  }

  private finishConnection(controller: AbortController): void {
    controller.abort();
    if (this.abortController !== controller) return;
    this.connected = false;
    this.abortController = null;
    this.messageEndpoint = null;
    this.closeHandler?.();
  }

  /**
   * Send a JSON-RPC message via HTTP POST
   */
  send(message: MCPOutboundMessage, options: MCPTransportSendOptions = {}): Promise<void> {
    const operation = this.sendMessage(message, options);
    this.sends.add(operation);
    void operation.then(
      () => this.sends.delete(operation),
      () => this.sends.delete(operation),
    );
    return operation;
  }

  private async sendMessage(
    message: MCPOutboundMessage,
    options: MCPTransportSendOptions,
  ): Promise<void> {
    options.signal?.throwIfAborted();
    if (!this.connected) {
      throw new MCPConnectionError("Not connected to SSE endpoint");
    }

    const scope = createRequestScope(options.signal, this.config.timeout);
    const signal = this.abortController
      ? AbortSignal.any([scope.signal, this.abortController.signal])
      : scope.signal;
    const endpoint = this.messageEndpoint ?? `${this.config.url}/message`;
    let response: Response | undefined;
    try {
      signal.throwIfAborted();
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json", ...this.config.headers },
        body: JSON.stringify(message),
        signal,
      });
      signal.throwIfAborted();
      if (!response.ok) {
        throw new MCPTransportError(`HTTP POST failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      rethrowCancellation(error, signal);
      if (error instanceof MCPTransportError) throw error;
      throw new MCPTransportError(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      scope.dispose();
      await response?.body?.cancel().catch(() => {});
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

  /** Only headers have a deadline; the body remains owned by the connection. */
  private async openStream(signal: AbortSignal): Promise<{ response: Response; dispose(): void }> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      this.config.timeout > 0
        ? setTimeout(
            () => controller.abort(new DOMException("SSE headers timed out", "TimeoutError")),
            this.config.timeout,
          )
        : undefined;
    timer?.unref();
    let response: Response | undefined;
    const dispose = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      controller.abort();
    };
    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...this.config.headers,
      };
      if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;
      response = await fetch(this.config.url, {
        method: "GET",
        redirect: "error",
        headers,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!response.ok)
        throw new MCPConnectionError(
          `SSE connection failed: ${response.status} ${response.statusText}`,
        );
      if (!response.body) throw new MCPConnectionError("SSE response has no body");
      clearTimeout(timer);
      return { response, dispose };
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      dispose();
      await response?.body?.cancel().catch(() => {});
      throw reason;
    }
  }

  /** One iterative owner covers every reader and reconnect wait of a generation. */
  private async receive(
    first: { response: Response; dispose(): void },
    controller: AbortController,
  ): Promise<void> {
    const signal = controller.signal;
    let stream: typeof first | undefined = first;
    let attempts = 0;
    try {
      while (!signal.aborted) {
        if (stream) {
          try {
            await this.processStream(stream.response.body!, signal);
          } catch (error) {
            if (signal.aborted) break;
            this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
            if (error instanceof SSEEndpointError || error instanceof MCPMessageLimitError) break;
          } finally {
            stream.dispose();
            stream = undefined;
          }
        }
        signal.throwIfAborted();
        if (attempts >= this.config.maxReconnectAttempts) break;
        const wait = Math.min(
          this.config.initialReconnectDelay * Math.pow(2, Math.min(attempts, 31)),
          this.config.maxReconnectDelay,
        );
        attempts++;
        await delay(wait, undefined, { signal });
        signal.throwIfAborted();
        try {
          stream = await this.openStream(signal);
        } catch (error) {
          if (signal.aborted) break;
          this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } catch (error) {
      if (!signal.aborted)
        this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.abortController === controller) this.connected = false;
      controller.abort();
      if (stream) {
        stream.dispose();
        await stream.response.body?.cancel().catch(() => {});
      }
      await Promise.allSettled(this.sends);
      this.finishConnection(controller);
    }
  }

  private async processStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = body.getReader();
    let cancellation: Promise<void> | undefined;
    const cancelReader = () => (cancellation ??= reader.cancel(signal.reason).catch(() => {}));
    const onAbort = () => {
      void cancelReader();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let eventType = "";
    let eventData = "";
    let eventId = "";
    const lines = boundedEventLines((line) => {
      signal.throwIfAborted();

      if (line === "") {
        if (eventData) this.handleEvent(eventType, eventData, eventId);
        signal.throwIfAborted();
        eventType = "";
        eventData = "";
        eventId = "";
        return;
      }
      if (line.startsWith(":")) return;
      const colon = line.indexOf(":");
      if (colon === -1) return;
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1).replace(/^ /, "");
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
        case "retry": {
          const ms = Number(value);
          if (/^\d+$/.test(value) && Number.isSafeInteger(ms) && ms <= 2147483647) {
            this.config.initialReconnectDelay = Math.min(ms, this.config.maxReconnectDelay);
          }
          break;
        }
      }
    });
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) return;
        lines.push(value);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      try {
        await cancelReader();
      } catch {
        /* Already cancelled or errored. */
      } finally {
        reader.releaseLock();
      }
    }
  }

  private handleEvent(type: string, data: string, id: string): void {
    if (id) this.lastEventId = id;
    if (type === "endpoint") {
      const base = new URL(this.config.url);
      let endpoint: URL;
      try {
        endpoint = new URL(data, base);
      } catch {
        throw new SSEEndpointError("Invalid SSE message endpoint");
      }
      if (endpoint.origin !== base.origin || endpoint.username || endpoint.password) {
        throw new SSEEndpointError("SSE message endpoint must remain on the configured origin");
      }
      this.messageEndpoint = endpoint.toString();
      return;
    }
    let message: JSONRPCResponse;
    try {
      message = JSON.parse(data) as JSONRPCResponse;
    } catch {
      this.errorHandler?.(new Error("Invalid JSON in SSE event"));
      return;
    }
    // Exceptions from callbacks are not JSON parse failures.
    this.messageHandler?.(message);
  }
}
