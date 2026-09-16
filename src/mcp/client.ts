/**
 * MCP Client Implementation
 *
 * Client for connecting to MCP servers and invoking tools.
 */

import type {
  MCPClient,
  MCPRequestOptions,
  MCPTransport,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPCallToolParams,
  MCPCallToolResult,
  MCPReadResourceResult,
  MCPGetPromptResult,
  MCPTool,
  MCPResource,
  MCPPrompt,
  JSONRPCRequest,
  JSONRPCResponse,
} from "./types.js";
import { MCPConnectionError, MCPTimeoutError } from "./errors.js";

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_REQUEST_TIMEOUT = 60000;

/**
 * MCP Client implementation
 */
export class MCPClientImpl implements MCPClient {
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    }
  >();
  private initialized = false;
  private serverCapabilities: MCPInitializeResult["capabilities"] | null = null;

  constructor(
    private readonly transport: MCPTransport,
    private readonly requestTimeout = DEFAULT_REQUEST_TIMEOUT,
  ) {
    this.setupTransportHandlers();
  }

  /**
   * Setup transport message handlers
   */
  private setupTransportHandlers(): void {
    this.transport.onMessage((message) => {
      this.handleMessage(message);
    });

    this.transport.onError((error) => {
      this.rejectAllPending(error);
    });

    this.transport.onClose(() => {
      this.initialized = false;
      this.rejectAllPending(new MCPConnectionError("Connection closed"));
    });
  }

  /**
   * Handle incoming messages from transport
   */
  private handleMessage(message: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  /**
   * Reject all pending requests
   */
  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest<T>(
    method: string,
    params?: Record<string, unknown>,
    options: MCPRequestOptions = {},
  ): Promise<T> {
    const { signal } = options;
    signal?.throwIfAborted();
    const timeoutMs = options.timeout ?? this.requestTimeout;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647) {
      throw new RangeError("MCP request timeout must be between 0 and 2147483647ms");
    }
    if (!this.transport.isConnected()) {
      throw new MCPConnectionError("Transport not connected");
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pendingRequests.delete(id);
        return true;
      };
      const fail = (error: unknown) => {
        if (cleanup()) reject(error);
      };
      const onAbort = () => fail(signal?.reason);
      this.pendingRequests.set(id, {
        resolve: (value) => {
          if (cleanup()) resolve(value as T);
        },
        reject: fail,
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          fail(new MCPTimeoutError(`Request '${method}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      try {
        // A transport may synchronously deliver a response or throw on dispatch.
        Promise.resolve(this.transport.send(request)).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  /**
   * Initialize connection to MCP server
   */
  async initialize(params: MCPInitializeParams): Promise<MCPInitializeResult> {
    if (!this.transport.isConnected()) {
      await this.transport.connect();
    }

    const result = await this.sendRequest<MCPInitializeResult>("initialize", params);
    this.serverCapabilities = result.capabilities;
    this.initialized = true;

    // Send initialized notification
    await this.transport.send({
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "notifications/initialized",
    });

    return result;
  }

  /**
   * List available tools
   */
  async listTools(): Promise<{ tools: MCPTool[] }> {
    this.ensureInitialized();
    return this.sendRequest<{ tools: MCPTool[] }>("tools/list");
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    params: MCPCallToolParams,
    options?: MCPRequestOptions,
  ): Promise<MCPCallToolResult> {
    options?.signal?.throwIfAborted();
    this.ensureInitialized();
    return this.sendRequest<MCPCallToolResult>("tools/call", params, options);
  }

  /**
   * List available resources
   */
  async listResources(): Promise<{ resources: MCPResource[] }> {
    this.ensureInitialized();
    return this.sendRequest<{ resources: MCPResource[] }>("resources/list");
  }

  /**
   * Read a specific resource by URI
   */
  async readResource(uri: string): Promise<MCPReadResourceResult> {
    this.ensureInitialized();
    return this.sendRequest<MCPReadResourceResult>("resources/read", { uri });
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<{ prompts: MCPPrompt[] }> {
    this.ensureInitialized();
    return this.sendRequest<{ prompts: MCPPrompt[] }>("prompts/list");
  }

  /**
   * Get a specific prompt with arguments
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<MCPGetPromptResult> {
    this.ensureInitialized();
    return this.sendRequest<MCPGetPromptResult>("prompts/get", {
      name,
      arguments: args,
    });
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new MCPConnectionError("Client not initialized. Call initialize() first.");
    }
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    this.initialized = false;
    await this.transport.disconnect();
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.transport.isConnected() && this.initialized;
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(): MCPInitializeResult["capabilities"] | null {
    return this.serverCapabilities;
  }
}

/**
 * Create a new MCP client
 */
export function createMCPClient(transport: MCPTransport, requestTimeout?: number): MCPClient {
  return new MCPClientImpl(transport, requestTimeout);
}
