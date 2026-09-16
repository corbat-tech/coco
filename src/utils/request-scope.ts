/** Own the transport lifetime, including body consumption and early iterator return. */
export function createRequestScope(hostSignal: AbortSignal | undefined, timeout: number) {
  hostSignal?.throwIfAborted();
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2_147_483_647) {
    throw new RangeError("timeout must be between 0 and 2147483647 milliseconds");
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(hostSignal?.reason);
  hostSignal?.addEventListener("abort", onAbort, { once: true });
  const timer =
    timeout > 0
      ? setTimeout(
          () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
          timeout,
        )
      : undefined;
  timer?.unref();
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      hostSignal?.removeEventListener("abort", onAbort);
      // Closing an iterator must also close a response body still owned by its SDK.
      if (!controller.signal.aborted) controller.abort();
    },
  };
}
