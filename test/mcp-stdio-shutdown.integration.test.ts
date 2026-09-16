import { describe, expect, it, vi } from "vitest";
import { StdioTransport } from "../src/mcp/transport/stdio.js";

describe("MCP stdio real process ownership", () => {
  it("waits for close after killing a child that ignores TERM", async () => {
    const transport = new StdioTransport({
      command: process.execPath,
      args: [
        "-e",
        `
        process.on('SIGTERM', () => {});
        process.stdin.resume();
        setInterval(() => {}, 1000);
        console.log(JSON.stringify({jsonrpc:'2.0', id:1, result:{pid:process.pid}}));
      `,
      ],
    });
    let ready!: (pid: number) => void;
    const started = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const closed = vi.fn();
    transport.onClose(closed);
    transport.onMessage((message) => ready((message.result as { pid: number }).pid));
    let pid: number | undefined;
    try {
      await transport.connect();
      pid = await started;
      process.kill(pid, 0);
      await transport.disconnect();
      expect(closed).toHaveBeenCalledOnce();
      expect(transport.isConnected()).toBe(false);
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already closed */
        }
      }
      await transport.disconnect();
    }
  }, 15000);
});
