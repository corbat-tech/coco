/**
 * Tests for MCP Stdio Transport
 */

import { describe, it, expect } from 'vitest';
import { StdioTransport } from './stdio.js';
import { MCPConnectionError } from '../errors.js';

describe('StdioTransport', () => {
  describe('constructor', () => {
    it('should create stdio transport with config', () => {
      const transport = new StdioTransport({
        command: 'test-command',
        args: ['arg1', 'arg2'],
        env: { TEST_VAR: 'value' },
        cwd: '/test/dir',
      });

      expect(transport).toBeDefined();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('connection state', () => {
    it('should not be connected initially', () => {
      const transport = new StdioTransport({
        command: 'echo',
        args: ['hello'],
      });

      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('callbacks', () => {
    it('should allow setting callbacks', () => {
      const transport = new StdioTransport({
        command: 'echo',
        args: ['hello'],
      });

      const messageCallback = () => {};
      const errorCallback = () => {};
      const closeCallback = () => {};

      // Should not throw
      transport.onMessage(messageCallback);
      transport.onError(errorCallback);
      transport.onClose(closeCallback);
    });
  });
});
