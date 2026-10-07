/** Check cancellation after an operation settles; never abandon a still-running mutation. */
export async function cancellationCheckpoint<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const result = await operation;
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

/** Own terminal interrupts only at the outermost interactive entry point. */
export async function withInteractiveCancellation<T>(
  signal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (signal) return cancellationCheckpoint(operation(signal), signal);
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Interaction cancelled", "AbortError"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    return await cancellationCheckpoint(operation(controller.signal), controller.signal);
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}
