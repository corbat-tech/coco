/**
 * Tests for MCP errors
 */

import { describe, it, expect } from 'vitest';
import {
  MCPError,
  MCPTransportError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPInitializationError,
} from './errors.js';
import { MCPErrorCode } from './types.js';

describe('MCPError', () => {
  it('should create error with code and message', () => {
    const error = new MCPError(MCPErrorCode.INTERNAL_ERROR, 'Test error');

    expect(error.name).toBe('MCPError');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe(MCPErrorCode.INTERNAL_ERROR);
  });
});

describe('MCPTransportError', () => {
  it('should create transport error with correct code', () => {
    const error = new MCPTransportError('Transport failed');

    expect(error.name).toBe('MCPTransportError');
    expect(error.message).toBe('Transport failed');
    expect(error.code).toBe(MCPErrorCode.TRANSPORT_ERROR);
  });
});

describe('MCPConnectionError', () => {
  it('should create connection error with correct code', () => {
    const error = new MCPConnectionError('Connection failed');

    expect(error.name).toBe('MCPConnectionError');
    expect(error.message).toBe('Connection failed');
    expect(error.code).toBe(MCPErrorCode.CONNECTION_ERROR);
  });
});

describe('MCPTimeoutError', () => {
  it('should create timeout error with default message', () => {
    const error = new MCPTimeoutError();

    expect(error.name).toBe('MCPTimeoutError');
    expect(error.message).toBe('Request timed out');
    expect(error.code).toBe(MCPErrorCode.TIMEOUT_ERROR);
  });

  it('should create timeout error with custom message', () => {
    const error = new MCPTimeoutError('Custom timeout');

    expect(error.message).toBe('Custom timeout');
  });
});

describe('MCPInitializationError', () => {
  it('should create initialization error with correct code', () => {
    const error = new MCPInitializationError('Initialization failed');

    expect(error.name).toBe('MCPInitializationError');
    expect(error.message).toBe('Initialization failed');
    expect(error.code).toBe(MCPErrorCode.INITIALIZATION_ERROR);
  });
});
