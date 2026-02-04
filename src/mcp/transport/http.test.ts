/**
 * Tests for MCP HTTP Transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPTransport } from './http.js';
import { MCPConnectionError, MCPTransportError } from '../errors.js';

describe('HTTPTransport', () => {
  let transport: HTTPTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    try {
      await transport?.disconnect();
    } catch {
      // Ignore
    }
  });

  describe('constructor', () => {
    it('should create http transport with config', () => {
      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        timeout: 30000,
        retries: 2,
      });

      expect(transport.getURL()).toBe('https://api.example.com/mcp');
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect to valid url', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      await transport.connect();

      expect(transport.isConnected()).toBe(true);
    });

    it('should accept 404 as valid connection', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 404 })
      );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      await transport.connect();

      expect(transport.isConnected()).toBe(true);
    });

    it('should throw for invalid url', async () => {
      transport = new HTTPTransport({
        url: 'not-a-url',
      });

      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });

    it('should throw for connection errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });

    it('should throw if already connected', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      await transport.connect();
      await expect(transport.connect()).rejects.toThrow(MCPConnectionError);
    });
  });

  describe('authentication', () => {
    it('should include bearer token', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
            status: 200,
          })
        );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        auth: {
          type: 'bearer',
          token: 'my-token',
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers['Authorization']).toBe('Bearer my-token');
    });

    it('should include api key', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
            status: 200,
          })
        );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        auth: {
          type: 'apikey',
          token: 'my-api-key',
          headerName: 'X-Custom-Key',
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers['X-Custom-Key']).toBe('my-api-key');
    });

    it('should read token from environment variable', async () => {
      process.env.TEST_API_TOKEN = 'env-token';

      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
            status: 200,
          })
        );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        auth: {
          type: 'bearer',
          tokenEnv: 'TEST_API_TOKEN',
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers['Authorization']).toBe('Bearer env-token');

      delete process.env.TEST_API_TOKEN;
    });

    it('should include custom headers', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
            status: 200,
          })
        );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      });

      await transport.connect();
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      const calls = vi.mocked(fetch).mock.calls;
      const lastCall = calls[calls.length - 1];
      const headers = lastCall?.[1]?.headers as Record<string, string>;

      expect(headers['X-Custom-Header']).toBe('custom-value');
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        retries: 1,
      });

      await transport.connect();
    });

    it('should send request and receive response', async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      const response = { jsonrpc: '2.0', id: 1, result: { data: 'test' } };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(response), { status: 200 })
      );

      await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      expect(messageCallback).toHaveBeenCalledWith(response);
    });

    it('should throw when not connected', async () => {
      await transport.disconnect();

      await expect(
        transport.send({ jsonrpc: '2.0', id: 1, method: 'test' })
      ).rejects.toThrow(MCPTransportError);
    });

    it('should throw on http error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Error', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(
        transport.send({ jsonrpc: '2.0', id: 1, method: 'test' })
      ).rejects.toThrow(MCPTransportError);
    });

    it('should retry on failure', async () => {
      const response = { jsonrpc: '2.0', id: 1, result: { data: 'test' } };

      // Setup connect mock first
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      // Create new transport with retries
      const retryTransport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        retries: 2,
      });

      await retryTransport.connect();

      const messageCallback = vi.fn();
      retryTransport.onMessage(messageCallback);

      // Mock retry: first fails, second succeeds
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(response), { status: 200 })
        );

      await retryTransport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      expect(messageCallback).toHaveBeenCalledWith(response);
    });
  });

  describe('disconnect', () => {
    it('should disconnect and call close callback', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      const closeCallback = vi.fn();
      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      transport.onClose(closeCallback);
      await transport.connect();
      await transport.disconnect();

      expect(transport.isConnected()).toBe(false);
      expect(closeCallback).toHaveBeenCalled();
    });
  });

  describe('callbacks', () => {
    beforeEach(async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, { status: 200 })
      );

      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      await transport.connect();
    });

    it('should call message callback', async () => {
      const messageCallback = vi.fn();
      transport.onMessage(messageCallback);

      const response = { jsonrpc: '2.0', id: 1, result: {} };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(response), { status: 200 })
      );

      await transport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

      expect(messageCallback).toHaveBeenCalledWith(response);
    });
  });

  describe('getters', () => {
    it('should return auth type', () => {
      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
        auth: { type: 'bearer', token: 'test' },
      });

      expect(transport.getAuthType()).toBe('bearer');
    });

    it('should return undefined auth type when no auth', () => {
      transport = new HTTPTransport({
        url: 'https://api.example.com/mcp',
      });

      expect(transport.getAuthType()).toBeUndefined();
    });
  });
});
