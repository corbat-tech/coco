/**
 * MCP (Model Context Protocol) Errors
 */

import { MCPErrorCode } from './types.js';

/**
 * Base MCP Error class
 */
export class MCPError extends Error {
  public readonly code: MCPErrorCode;

  constructor(code: MCPErrorCode, message: string) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
  }
}

/**
 * Transport error - occurs during transport operations
 */
export class MCPTransportError extends MCPError {
  constructor(message: string) {
    super(MCPErrorCode.TRANSPORT_ERROR, message);
    this.name = 'MCPTransportError';
  }
}

/**
 * Connection error - occurs when connection fails
 */
export class MCPConnectionError extends MCPError {
  constructor(message: string) {
    super(MCPErrorCode.CONNECTION_ERROR, message);
    this.name = 'MCPConnectionError';
  }
}

/**
 * Timeout error - occurs when request times out
 */
export class MCPTimeoutError extends MCPError {
  constructor(message: string = 'Request timed out') {
    super(MCPErrorCode.TIMEOUT_ERROR, message);
    this.name = 'MCPTimeoutError';
  }
}

/**
 * Initialization error - occurs during client initialization
 */
export class MCPInitializationError extends MCPError {
  constructor(message: string) {
    super(MCPErrorCode.INITIALIZATION_ERROR, message);
    this.name = 'MCPInitializationError';
  }
}
