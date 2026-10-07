import { describe, expect, it, vi, beforeEach } from "vitest";
import { runWithDeferredUpdateNotice } from "./deferred-update.js";
import { checkForUpdates, printUpdateBanner } from "./repl/version-check.js";
vi.mock("./repl/version-check.js", () => ({
  checkForUpdates: vi.fn(),
  printUpdateBanner: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
});
describe("deferred update advice", () => {
  it("starts and exits without waiting for a slow registry", async () => {
    vi.mocked(checkForUpdates).mockReturnValue(new Promise(() => {}));
    const start = vi.fn(async () => {});
    await runWithDeferredUpdateNotice(start);
    expect(start).toHaveBeenCalledOnce();
    expect(printUpdateBanner).not.toHaveBeenCalled();
  });
  it("prints a ready notice only after the session closes", async () => {
    const info = { currentVersion: "1", latestVersion: "2", updateCommand: "npm update" };
    vi.mocked(checkForUpdates).mockResolvedValue(info);
    await runWithDeferredUpdateNotice(async () => {
      await Promise.resolve();
      expect(printUpdateBanner).not.toHaveBeenCalled();
    });
    expect(printUpdateBanner).toHaveBeenCalledWith(info);
  });
  it("does not fail the session when the advisory check fails", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue(new Error("offline"));
    await expect(runWithDeferredUpdateNotice(async () => {})).resolves.toBeUndefined();
  });
});
