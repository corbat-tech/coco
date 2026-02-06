/**
 * MCP (Model Context Protocol) Types
 *
 * Based on the Model Context Protocol specification for connecting LLMs
 * with external tools and resources.
 */

/**
 * JSON-RPC 2.0 Request
 */
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JSONRPCError;
}

/**
 * JSON-RPC 2.0 Error
 */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * MCP Server capabilities
 */
export interface MCPServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: Record<string, never>;
}

/**
 * MCP Server information
 */
export interface MCPServerInfo {
  name: string;
  version: string;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP Prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * MCP Request parameters
 */
export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  clientInfo: MCPServerInfo;
  [key: string]: unknown;
}

/**
 * MCP Initialize result
 */
export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  serverInfo: MCPServerInfo;
}

/**
 * MCP Call Tool params
 */
export interface MCPCallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * MCP Call Tool result
 */
export interface MCPCallToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: MCPResource;
  }>;
  isError?: boolean;
}

/**
 * MCP Read Resource result
 */
export interface MCPReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

/**
 * MCP Get Prompt result
 */
export interface MCPGetPromptResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: {
      type: "text" | "image" | "resource";
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: MCPResource;
    };
  }>;
}

/**
 * Transport interface for MCP communication
 */
export interface MCPTransport {
  /** Connect to the transport */
  connect(): Promise<void>;

  /** Disconnect from the transport */
  disconnect(): Promise<void>;

  /** Send a message through the transport */
  send(message: JSONRPCRequest): Promise<void>;

  /** Set callback for received messages */
  onMessage(callback: (message: JSONRPCResponse) => void): void;

  /** Set callback for errors */
  onError(callback: (error: Error) => void): void;

  /** Set callback for connection close */
  onClose(callback: () => void): void;

  /** Check if transport is connected */
  isConnected(): boolean;
}

/**
 * MCP Client interface
 */
export interface MCPClient {
  /** Initialize connection to MCP server */
  initialize(params: MCPInitializeParams): Promise<MCPInitializeResult>;

  /** List available tools */
  listTools(): Promise<{ tools: MCPTool[] }>;

  /** Call a tool on the MCP server */
  callTool(params: MCPCallToolParams): Promise<MCPCallToolResult>;

  /** List available resources */
  listResources(): Promise<{ resources: MCPResource[] }>;

  /** Read a specific resource by URI */
  readResource(uri: string): Promise<MCPReadResourceResult>;

  /** List available prompts */
  listPrompts(): Promise<{ prompts: MCPPrompt[] }>;

  /** Get a specific prompt with arguments */
  getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<MCPGetPromptResult>;

  /** Close the client connection */
  close(): Promise<void>;

  /** Check if client is connected */
  isConnected(): boolean;
}

/**
 * Stdio transport configuration
 */
export interface StdioTransportConfig {
  /** Command to execute */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * MCP Error codes
 */
export enum MCPErrorCode {
  // JSON-RPC standard errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // MCP specific errors
  INITIALIZATION_ERROR = -32000,
  TRANSPORT_ERROR = -32001,
  TIMEOUT_ERROR = -32002,
  CONNECTION_ERROR = -32003,
}

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  /** Transport to use */
  transport: MCPTransport;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
}

/**
 * Base transport configuration
 */
export interface MCPTransportConfig {
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  /** Server name (unique identifier) */
  name: string;
  /** Server description */
  description?: string;
  /** Transport type */
  transport: "stdio" | "http" | "sse";
  /** Stdio transport configuration */
  stdio?: StdioTransportConfig;
  /** HTTP transport configuration */
  http?: {
    /** Server URL */
    url: string;
    /** Custom headers */
    headers?: Record<string, string>;
    /** Authentication type */
    auth?: {
      type: "oauth" | "bearer" | "apikey";
      /** Token or API key (optional, can be loaded from env) */
      token?: string;
      /** Environment variable name containing the token */
      tokenEnv?: string;
    };
    /** Request timeout in milliseconds */
    timeout?: number;
  };
  /** Whether the server is enabled */
  enabled?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * MCP Registry interface
 */
export interface MCPRegistry {
  /** Add or update a server configuration */
  addServer(config: MCPServerConfig): Promise<void>;

  /** Remove a server by name */
  removeServer(name: string): Promise<boolean>;

  /** Get a server configuration by name */
  getServer(name: string): MCPServerConfig | undefined;

  /** List all registered servers */
  listServers(): MCPServerConfig[];

  /** List enabled servers only */
  listEnabledServers(): MCPServerConfig[];

  /** Check if a server exists */
  hasServer(name: string): boolean;

  /** Save registry to disk */
  save(): Promise<void>;

  /** Load registry from disk */
  load(): Promise<void>;

  /** Get registry file path */
  getRegistryPath(): string;
}

/**
 * Wrapped MCP tool information
 */
export interface MCPWrappedTool {
  /** Original MCP tool */
  originalTool: MCPTool;
  /** Server name this tool belongs to */
  serverName: string;
  /** Prefixed tool name (e.g., "mcp_filesystem_read") */
  wrappedName: string;
}

/**
 * MCP Tool wrapper options
 */
export interface MCPToolWrapperOptions {
  /** Prefix for tool names (default: "mcp") */
  namePrefix?: string;
  /** Tool category for COCO registry (default: "deploy") */
  category?: "file" | "bash" | "git" | "test" | "quality" | "build" | "deploy";
  /** Request timeout in milliseconds */
  requestTimeout?: number;
}
