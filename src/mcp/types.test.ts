/**
 * Tests for MCP types
 */

import { describe, it, expect } from 'vitest';
import { MCPErrorCode } from './types.js';

describe('MCPErrorCode', () => {
  it('should have correct JSON-RPC standard error codes', () => {
    expect(MCPErrorCode.PARSE_ERROR).toBe(-32700);
    expect(MCPErrorCode.INVALID_REQUEST).toBe(-32600);
    expect(MCPErrorCode.METHOD_NOT_FOUND).toBe(-32601);
    expect(MCPErrorCode.INVALID_PARAMS).toBe(-32602);
    expect(MCPErrorCode.INTERNAL_ERROR).toBe(-32603);
  });

  it('should have correct MCP specific error codes', () => {
    expect(MCPErrorCode.INITIALIZATION_ERROR).toBe(-32000);
    expect(MCPErrorCode.TRANSPORT_ERROR).toBe(-32001);
    expect(MCPErrorCode.TIMEOUT_ERROR).toBe(-32002);
    expect(MCPErrorCode.CONNECTION_ERROR).toBe(-32003);
  });
});
