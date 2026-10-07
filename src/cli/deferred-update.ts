import { checkForUpdates, printUpdateBanner } from "./repl/version-check.js";

/** Advisory check cannot delay input, interrupt a prompt, or start an installer. */
export async function runWithDeferredUpdateNotice(start: () => Promise<void>): Promise<void> {
  let ready: Awaited<ReturnType<typeof checkForUpdates>> = null;
  void checkForUpdates()
    .then((result) => {
      ready = result;
    })
    .catch(() => {});
  await start();
  // Never wait for the registry at exit; a still-pending result is simply omitted.
  if (ready) printUpdateBanner(ready);
}
