/**
 * MCP Client Implementation
 *
 * Client for connecting to MCP servers and invoking tools.
 */

import type {
  MCPClient,
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
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
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

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);

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
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.transport.isConnected()) {
      throw new MCPConnectionError("Transport not connected");
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new MCPTimeoutError(`Request '${method}' timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.transport.send(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
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
  async callTool(params: MCPCallToolParams): Promise<MCPCallToolResult> {
    this.ensureInitialized();
    return this.sendRequest<MCPCallToolResult>("tools/call", params);
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
  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<MCPGetPromptResult> {
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
