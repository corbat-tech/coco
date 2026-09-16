/** Transport cancellation is neither provider failure nor permission to retry. */
export function isCancellation(error: unknown): boolean {
  return error instanceof Error && ["AbortError", "APIUserAbortError"].includes(error.name);
}

/** Preserve the host's reason when its signal was cancelled. */
export function rethrowCancellation(error: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (isCancellation(error)) throw error;
}
