/**
 * MCP Stdio Transport Implementation
 *
 * Handles communication with MCP servers via stdio streams.
 */

import { spawn, ChildProcess } from 'node:child_process';
import type {
  MCPTransport,
  JSONRPCRequest,
  JSONRPCResponse,
  StdioTransportConfig,
} from '../types.js';
import { MCPConnectionError, MCPTransportError } from '../errors.js';

/**
 * Stdio transport for MCP communication
 */
export class StdioTransport implements MCPTransport {
  private process: ChildProcess | null = null;
  private messageCallback: ((message: JSONRPCResponse) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private buffer = '';
  private connected = false;

  constructor(private readonly config: StdioTransportConfig) {}

  /**
   * Connect to the stdio transport by spawning the process
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new MCPConnectionError('Transport already connected');
    }

    return new Promise((resolve, reject) => {
      const { command, args = [], env, cwd } = this.config;

      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        cwd,
      });

      this.process.on('error', (error) => {
        reject(new MCPConnectionError(`Failed to spawn process: ${error.message}`));
      });

      this.process.on('spawn', () => {
        this.connected = true;
        this.setupHandlers();
        resolve();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        // Log stderr for debugging but don't treat as error
        // eslint-disable-next-line no-console
        console.debug(`[MCP Server stderr]: ${data.toString()}`);
      });
    });
  }

  /**
   * Setup data handlers for the process
   */
  private setupHandlers(): void {
    if (!this.process?.stdout) return;

    this.process.stdout.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.process.on('exit', (code) => {
      this.connected = false;
      if (code !== 0 && code !== null) {
        this.errorCallback?.(new MCPTransportError(`Process exited with code ${code}`));
      }
      this.closeCallback?.();
    });

    this.process.on('close', () => {
      this.connected = false;
      this.closeCallback?.();
    });
  }

  /**
   * Handle incoming data from stdout
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines (JSON-RPC messages are line-delimited)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JSONRPCResponse;
        this.messageCallback?.(message);
      } catch {
        this.errorCallback?.(new MCPTransportError(`Invalid JSON: ${trimmed}`));
      }
    }
  }

  /**
   * Send a message through the transport
   */
  async send(message: JSONRPCRequest): Promise<void> {
    if (!this.connected || !this.process?.stdin) {
      throw new MCPTransportError('Transport not connected');
    }

    const line = JSON.stringify(message) + '\n';

    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new MCPTransportError('stdin not available'));
        return;
      }

      const stdin = this.process.stdin;
      const canWrite = stdin.write(line, (error) => {
        if (error) {
          reject(new MCPTransportError(`Write error: ${error.message}`));
        } else {
          resolve();
        }
      });

      if (!canWrite) {
        stdin.once('drain', () => resolve());
      }
    });
  }

  /**
   * Disconnect from the transport
   */
  async disconnect(): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.process.stdin?.end();

      const timeout = setTimeout(() => {
        this.process?.kill('SIGTERM');
      }, 5000);

      this.process.on('close', () => {
        clearTimeout(timeout);
        this.connected = false;
        this.process = null;
        resolve();
      });

      if (this.process.killed || !this.connected) {
        clearTimeout(timeout);
        this.process = null;
        resolve();
      }
    });
  }

  /**
   * Set callback for received messages
   */
  onMessage(callback: (message: JSONRPCResponse) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Set callback for errors
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Set callback for connection close
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  /**
   * Check if transport is connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}
