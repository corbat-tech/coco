/**
 * Tests for MCP module index
 */

import { describe, it, expect } from 'vitest';

import {
  // Types
  MCPErrorCode,
  // Errors
  MCPError,
  MCPTransportError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPInitializationError,
  // Transport
  StdioTransport,
  // Client
  createMCPClient,
  MCPClientImpl,
} from './index.js';

describe('MCP Module Exports', () => {
  it('should export MCPErrorCode enum', () => {
    expect(MCPErrorCode).toBeDefined();
    expect(MCPErrorCode.INTERNAL_ERROR).toBe(-32603);
  });

  it('should export error classes', () => {
    expect(MCPError).toBeDefined();
    expect(MCPTransportError).toBeDefined();
    expect(MCPConnectionError).toBeDefined();
    expect(MCPTimeoutError).toBeDefined();
    expect(MCPInitializationError).toBeDefined();
  });

  it('should export StdioTransport', () => {
    expect(StdioTransport).toBeDefined();
  });

  it('should export client factory and implementation', () => {
    expect(createMCPClient).toBeDefined();
    expect(MCPClientImpl).toBeDefined();
  });
});

describe('MCPError exports', () => {
  it('should be instantiable', () => {
    const error = new MCPTransportError('test');
    expect(error.message).toBe('test');
    expect(error.name).toBe('MCPTransportError');
  });
});
