import type { Readable } from "node:stream";

/** Read one finite piped input; never keep a listener or a partially timed-out task. */
export async function readHeadlessStdin(
  input: Readable & { isTTY?: boolean } = process.stdin,
  options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  if (input.isTTY || input.readableEnded) return "";
  if (input.destroyed) throw new Error("Piped input closed before completion");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.off("close", onClose);
      options.signal?.removeEventListener("abort", onAbort);
      input.pause();
      if (error) reject(error);
      else {
        try {
          resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).trim());
        } catch {
          reject(new Error("Piped input must be valid UTF-8 text"));
        }
      }
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > (options.maxBytes ?? 1024 * 1024))
        finish(new Error("Piped input exceeds the 1 MiB limit"));
      else chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const onClose = () =>
      finish(input.readableEnded ? undefined : new Error("Piped input closed before completion"));
    const onAbort = () => finish(new Error("Headless execution cancelled"));
    const timer = setTimeout(
      () => finish(new Error("Piped input did not finish within the input deadline")),
      options.timeoutMs ?? 5000,
    );
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.once("close", onClose);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}
