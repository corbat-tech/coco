/**
 * Tests for MCP Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPClientImpl, createMCPClient } from './client.js';
import type {
  MCPTransport,
  JSONRPCResponse,
  MCPInitializeParams,
} from './types.js';
import { MCPConnectionError, MCPTimeoutError } from './errors.js';

describe('MCPClientImpl', () => {
  let mockTransport: MCPTransport;
  let client: MCPClientImpl;
  let messageHandler: ((message: JSONRPCResponse) => void) | null = null;
  let errorHandler: ((error: Error) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let isConnected = false;
  let lastRequestId = 0;

  beforeEach(() => {
    isConnected = true;
    lastRequestId = 0;
    messageHandler = null;
    errorHandler = null;
    closeHandler = null;

    mockTransport = {
      connect: vi.fn().mockImplementation(() => {
        isConnected = true;
        return Promise.resolve();
      }),
      disconnect: vi.fn().mockImplementation(() => {
        isConnected = false;
        return Promise.resolve();
      }),
      send: vi.fn().mockImplementation((req) => {
        lastRequestId = req.id as number;
        return Promise.resolve();
      }),
      onMessage: vi.fn().mockImplementation((callback) => {
        messageHandler = callback;
      }),
      onError: vi.fn().mockImplementation((callback) => {
        errorHandler = callback;
      }),
      onClose: vi.fn().mockImplementation((callback) => {
        closeHandler = callback;
      }),
      isConnected: vi.fn().mockImplementation(() => isConnected),
    };

    client = new MCPClientImpl(mockTransport, 5000);
  });

  describe('initialize', () => {
    it('should initialize mcp client', async () => {
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      // Wait for send to be called and get the request ID
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Simulate response with matching ID
      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      const result = await initPromise;

      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.serverInfo.name).toBe('test-server');
      expect(client.isConnected()).toBe(true);
    });

    it('should connect transport if not connected', async () => {
      isConnected = false;

      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      expect(mockTransport.connect).toHaveBeenCalled();
    });

    it('should send initialized notification after handshake', async () => {
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // Should have sent initialize request and initialized notification
      expect(mockTransport.send).toHaveBeenCalledTimes(2);
      expect(vi.mocked(mockTransport.send).mock.calls[1]?.[0]).toMatchObject({
        method: 'notifications/initialized',
      });
    });
  });

  describe('listTools', () => {
    it('should list available tools', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const initId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: initId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // Now list tools
      const listPromise = client.listTools();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const listId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: listId,
        result: {
          tools: [
            {
              name: 'read_file',
              description: 'Read a file',
              inputSchema: { type: 'object' },
            },
          ],
        },
      });

      const result = await listPromise;

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe('read_file');
    });

    it('should throw error when not initialized', async () => {
      await expect(client.listTools()).rejects.toThrow(MCPConnectionError);
    });
  });

  describe('callTool', () => {
    it('should call tool on mcp server', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const initId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: initId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // Call tool
      const callPromise = client.callTool({
        name: 'read_file',
        arguments: { path: '/test/file.txt' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const callId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: callId,
        result: {
          content: [{ type: 'text', text: 'file content' }],
        },
      });

      const result = await callPromise;

      expect(result.content[0]?.text).toBe('file content');
    });

    it('should throw error when not initialized', async () => {
      await expect(
        client.callTool({ name: 'read_file', arguments: {} })
      ).rejects.toThrow(MCPConnectionError);
    });
  });

  describe('listResources', () => {
    it('should list available resources', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const initId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: initId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // List resources
      const listPromise = client.listResources();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const listId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: listId,
        result: {
          resources: [{ uri: 'file:///test.txt', name: 'test.txt' }],
        },
      });

      const result = await listPromise;

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.uri).toBe('file:///test.txt');
    });
  });

  describe('listPrompts', () => {
    it('should list available prompts', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      const initId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: initId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // List prompts
      const listPromise = client.listPrompts();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const listId = lastRequestId;

      messageHandler?.({
        jsonrpc: '2.0',
        id: listId,
        result: {
          prompts: [{ name: 'greeting', description: 'A greeting prompt' }],
        },
      });

      const result = await listPromise;

      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]?.name).toBe('greeting');
    });
  });

  describe('close', () => {
    it('should close client connection', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;
      expect(client.isConnected()).toBe(true);

      await client.close();

      expect(mockTransport.disconnect).toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('should timeout on slow response', async () => {
      // Initialize with very short timeout
      const shortTimeoutClient = new MCPClientImpl(mockTransport, 50);

      const initParams: MCPInitializeParams = {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      };

      // Don't send response to trigger timeout
      await expect(shortTimeoutClient.initialize(initParams)).rejects.toThrow(MCPTimeoutError);
    });
  });

  describe('error handling', () => {
    it('should handle JSON-RPC errors', async () => {
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        error: {
          code: -32600,
          message: 'Invalid request',
        },
      });

      await expect(initPromise).rejects.toThrow('Invalid request');
    });

    it('should handle transport errors', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // Mark as disconnected
      isConnected = false;

      // Trigger transport error
      errorHandler?.(new Error('Connection lost'));

      // Client should be marked as not initialized after transport error
      expect(client.isConnected()).toBe(false);
    });

    it('should handle server disconnection', async () => {
      // Initialize first
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;
      expect(client.isConnected()).toBe(true);

      // Mark as disconnected
      isConnected = false;

      // Trigger close
      closeHandler?.();

      expect(client.isConnected()).toBe(false);
    });

    it('should reject all pending on transport close', async () => {
      // Initialize
      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      messageHandler?.({
        jsonrpc: '2.0',
        id: lastRequestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });

      await initPromise;

      // Start a request that won't complete
      const listPromise = client.listTools();

      // Mark as disconnected and trigger close
      isConnected = false;
      closeHandler?.();

      await expect(listPromise).rejects.toThrow(MCPConnectionError);
    });
  });

  describe('send request error', () => {
    it('should handle send errors', async () => {
      vi.mocked(mockTransport.send).mockRejectedValue(new Error('Send failed'));

      const initPromise = client.initialize({
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      await expect(initPromise).rejects.toThrow('Send failed');
    });
  });
});

describe('createMCPClient', () => {
  it('should create MCP client', () => {
    const mockTransport: MCPTransport = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      send: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
    };

    const client = createMCPClient(mockTransport, 10000);

    expect(client).toBeDefined();
    expect(typeof client.initialize).toBe('function');
    expect(typeof client.listTools).toBe('function');
    expect(typeof client.callTool).toBe('function');
    expect(typeof client.close).toBe('function');
  });
});
