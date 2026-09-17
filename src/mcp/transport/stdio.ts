/**
 * MCP Stdio Transport Implementation
 *
 * Handles communication with MCP servers via stdio streams.
 */

import { spawn, ChildProcess } from "node:child_process";
import type {
  MCPTransport,
  MCPOutboundMessage,
  MCPTransportSendOptions,
  JSONRPCResponse,
  StdioTransportConfig,
} from "../types.js";
import { MCPConnectionError, MCPTransportError } from "../errors.js";
import { BoundedLines } from "./limits.js";

/**
 * Stdio transport for MCP communication
 */
interface OwnedChild {
  child: ChildProcess;
  closed: boolean;
  closing: boolean;
  settled: Promise<void>;
  resolveClose(): void;
  termTimer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
}

export class StdioTransport implements MCPTransport {
  private ownedChild: OwnedChild | null = null;
  private process: ChildProcess | null = null;
  private messageCallback: ((message: JSONRPCResponse) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private lines = this.createLines();
  private connected = false;

  constructor(private readonly config: StdioTransportConfig) {}

  /**
   * Connect to the stdio transport by spawning the process
   */
  async connect(): Promise<void> {
    if (this.process || this.ownedChild) {
      throw new MCPConnectionError("Transport already connected or process still closing");
    }
    const { command, args = [], env, cwd } = this.config;
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
        cwd,
      });
    } catch (error) {
      throw new MCPConnectionError(
        `Failed to spawn process: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let resolveClose!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const owner: OwnedChild = { child, closed: false, closing: false, settled, resolveClose };
    this.ownedChild = owner;
    this.process = child;
    this.lines = this.createLines();
    return new Promise<void>((resolve, reject) => {
      let ready = false;
      const onSpawn = () => {
        if (owner.closed || owner.closing) {
          reject(new MCPConnectionError("Process closed while connecting"));
          return;
        }
        ready = true;
        this.connected = true;
        resolve();
      };
      const onError = (error: Error) => {
        if (!ready) reject(new MCPConnectionError(`Failed to spawn process: ${error.message}`));
        else this.errorCallback?.(new MCPTransportError(`Process error: ${error.message}`));
      };
      const onData = (data: Buffer) => {
        if (!owner.closed && !owner.closing) this.handleData(data);
      };
      const onStderr = (data: Buffer) => {
        console.debug(`[MCP Server stderr]: ${data.toString()}`);
      };
      const onExit = (code: number | null) => {
        this.connected = false;
        if (!ready) reject(new MCPConnectionError("Process exited before connection was ready"));
        if (code !== 0 && code !== null) {
          this.errorCallback?.(new MCPTransportError(`Process exited with code ${code}`));
        }
        // exit/killed acknowledge neither stream closure nor complete process ownership release.
      };
      const onClose = () => {
        if (owner.closed) return;
        owner.closed = true;
        clearTimeout(owner.termTimer);
        clearTimeout(owner.killTimer);
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.removeListener("close", onClose);
        child.stdout?.removeListener("data", onData);
        child.stderr?.removeListener("data", onStderr);
        if (this.ownedChild === owner) {
          this.connected = false;
          this.process = null;
          this.ownedChild = null;
          this.lines = this.createLines();
        }
        if (!ready) reject(new MCPConnectionError("Process closed before connection was ready"));
        owner.resolveClose();
        this.closeCallback?.();
      };
      // Register all ownership handlers before the asynchronous spawn event.
      child.on("error", onError);
      child.on("spawn", onSpawn);
      child.on("exit", onExit);
      child.on("close", onClose);
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onStderr);
    });
  }

  /**
   * Handle incoming data from stdout
   */
  private handleData(data: Buffer): void {
    try {
      this.lines.push(data);
    } catch (error) {
      this.connected = false;
      this.errorCallback?.(error instanceof Error ? error : new MCPTransportError(String(error)));
      void this.disconnect();
    }
  }

  private createLines(): BoundedLines {
    return new BoundedLines((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message: JSONRPCResponse;
      try {
        message = JSON.parse(trimmed) as JSONRPCResponse;
      } catch {
        this.errorCallback?.(new MCPTransportError("Invalid JSON in MCP stdio frame"));
        return;
      }
      this.messageCallback?.(message);
    });
  }

  /**
   * Send a message through the transport
   */
  async send(message: MCPOutboundMessage, options: MCPTransportSendOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    if (!this.connected || !this.process?.stdin) {
      throw new MCPTransportError("Transport not connected");
    }

    const line = JSON.stringify(message) + "\n";

    return new Promise((resolve, reject) => {
      const stdin = this.process?.stdin;
      if (!stdin) {
        reject(new MCPTransportError("stdin not available"));
        return;
      }
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        if (error !== undefined) reject(error);
        else resolve();
      };
      const onAbort = () => finish(options.signal?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        // The write callback acknowledges this chunk even under backpressure.
        // A shared drain event cannot acknowledge a particular request.
        stdin.write(line, (error) => {
          finish(error ? new MCPTransportError(`Write error: ${error.message}`) : undefined);
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  /**
   * Disconnect from the transport
   */
  async disconnect(): Promise<void> {
    const owner = this.ownedChild;
    if (!owner) return;
    if (owner.closing) return owner.settled;
    owner.closing = true;
    this.connected = false;
    const signalChild = (signal: NodeJS.Signals) => {
      if (owner.closed) return;
      try {
        owner.child.kill(signal);
      } catch (error) {
        this.errorCallback?.(
          new MCPTransportError(
            `Failed to signal process: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    };
    owner.termTimer = setTimeout(() => {
      if (owner.closed) return;
      // Schedule before signalling: a synchronous close must clear this timer too.
      owner.killTimer = setTimeout(() => signalChild("SIGKILL"), 3000);
      signalChild("SIGTERM");
    }, 5000);
    try {
      owner.child.stdin?.end();
    } catch (error) {
      this.errorCallback?.(
        new MCPTransportError(
          `Failed to close process stdin: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    await owner.settled;
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
