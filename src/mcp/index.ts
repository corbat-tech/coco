/**
 * MCP (Model Context Protocol) Module
 *
 * This module provides client implementations for the Model Context Protocol,
 * allowing connection to MCP servers and invocation of tools.
 *
 * @example
 * ```typescript
 * import { createMCPClient, StdioTransport } from './mcp/index.js';
 *
 * const transport = new StdioTransport({
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/files'],
 * });
 *
 * const client = createMCPClient(transport);
 *
 * await client.initialize({
 *   protocolVersion: '2024-11-05',
 *   capabilities: {},
 *   clientInfo: { name: 'my-client', version: '1.0.0' },
 * });
 *
 * const tools = await client.listTools();
 * console.log(tools);
 *
 * await client.close();
 * ```
 */

// Types
export type {
  MCPClient,
  MCPClientConfig,
  MCPTransport,
  MCPTransportConfig,
  StdioTransportConfig,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPCallToolParams,
  MCPCallToolResult,
  MCPReadResourceResult,
  MCPGetPromptResult,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPServerCapabilities,
  MCPServerInfo,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCError,
  MCPServerConfig,
  MCPRegistry,
} from "./types.js";

export { MCPErrorCode } from "./types.js";

// Errors
export {
  MCPError,
  MCPTransportError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPInitializationError,
} from "./errors.js";

// Transport implementations
export { StdioTransport } from "./transport/stdio.js";
export { HTTPTransport } from "./transport/http.js";
export type { HTTPTransportConfig } from "./transport/http.js";
export { SSETransport } from "./transport/sse.js";
export type { SSETransportConfig } from "./transport/sse.js";

// Client factory
export { createMCPClient, MCPClientImpl } from "./client.js";

// Registry
export { createMCPRegistry, MCPRegistryImpl } from "./registry.js";

// Config
export {
  loadMCPConfig,
  saveMCPConfig,
  validateServerConfig,
  getDefaultRegistryPath,
  DEFAULT_MCP_CONFIG_DIR,
  DEFAULT_REGISTRY_FILE,
} from "./config.js";
export type { MCPGlobalConfig } from "./config.js";

// Tools wrapper
export {
  wrapMCPTool,
  wrapMCPTools,
  createToolsFromMCPServer,
  registerMCPTools,
  getMCPToolInfo,
  extractOriginalToolName,
} from "./tools.js";

// Config loader
export {
  loadMCPConfigFile,
  mergeMCPConfigs,
  loadMCPServersFromCOCOConfig,
} from "./config-loader.js";
export type { MCPConfigFile } from "./config-loader.js";

// Schema to Zod converter
export { jsonSchemaToZod } from "./tools.js";

// Lifecycle manager
export {
  MCPServerManager,
  getMCPServerManager,
  createMCPServerManager,
} from "./lifecycle.js";
export type {
  ServerConnection,
  HealthCheckResult,
} from "./lifecycle.js";
