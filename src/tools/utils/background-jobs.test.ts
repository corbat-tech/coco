import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackgroundJobOwner } from "./background-jobs.js";

const command = (source: string) => `${JSON.stringify(process.execPath)} -e '${source}'`;
describe.skipIf(process.platform === "win32")("BackgroundJobOwner", () => {
  let root: string;
  const owners: BackgroundJobOwner[] = [];
  function owner(limits = { concurrent: 2, timeoutMs: 30000, outputBytes: 1024 }) {
    const instance = new BackgroundJobOwner(root, limits);
    owners.push(instance);
    return instance;
  }
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "coco-background-"));
  });
  afterEach(async () => {
    await Promise.all(owners.splice(0).map((instance) => instance.close()));
    await rm(root, { recursive: true, force: true });
  });
  it("retains bounded output and records actual completion", async () => {
    const jobs = owner();
    const job = jobs.start({ command: command('console.log("hello")') });
    await expect.poll(() => jobs.status(job.jobId).state, { timeout: 5000 }).toBe("completed");
    expect(jobs.status(job.jobId).exitCode).toBe(0);
    expect(jobs.read(job.jobId, "stdout").output).toBe("hello\n");
  });
  it("rejects foreign IDs, unowned directories and concurrent excess", async () => {
    const jobs = owner();
    const first = jobs.start({ command: command("setInterval(() => {}, 1000)") });
    jobs.start({ command: command("setInterval(() => {}, 1000)") });
    expect(() => jobs.start({ command: "echo excess" })).toThrow(/concurrency/);
    expect(() => owner().status(first.jobId)).toThrow(/Unknown job/);
    expect(() => owner().start({ command: "echo outside", cwd: ".." })).toThrow(/owning project/);
    await jobs.close();
    expect(jobs.status(first.jobId).state).toBe("cancelled");
    expect(() => jobs.start({ command: "echo late" })).toThrow(/closed/);
  });
  it("accepted work outlives the launch scope and completed history is bounded", async () => {
    const jobs = owner();
    const launch = new AbortController();
    const running = jobs.start({ command: command("setInterval(() => {}, 1000)") }, launch.signal);
    launch.abort();
    expect(jobs.status(running.jobId).state).toBe("running");
    const completed: string[] = [];
    for (let index = 0; index < 3; index++) {
      const job = jobs.start({ command: command('console.log("done")') });
      completed.push(job.jobId);
      await expect.poll(() => jobs.status(job.jobId).state, { timeout: 5000 }).toBe("completed");
    }
    expect(jobs.list()).toHaveLength(3);
    expect(() => jobs.status(completed[0]!)).toThrow(/Unknown job/);
    expect(jobs.status(running.jobId).state).toBe("running");
  }, 15000);
  it("terminates output overflow and never reports it as success", async () => {
    const jobs = owner({ concurrent: 2, timeoutMs: 30000, outputBytes: 16 });
    const job = jobs.start({
      command: command('process.stdout.write("x".repeat(100)); setInterval(() => {}, 1000)'),
    });
    await expect.poll(() => jobs.status(job.jobId).state, { timeout: 5000 }).toBe("failed");
    expect(jobs.status(job.jobId).error).toMatch(/output limit/);
    expect(jobs.read(job.jobId, "stdout").totalBytes).toBe(16);
  });
  it("cancels a TERM-resistant descendant without killing unrelated work", async () => {
    const jobs = owner();
    const unrelated = owner();
    const other = unrelated.start({ command: command("setInterval(() => {}, 1000)") });
    const child =
      'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync("child.pid", String(process.pid)); setInterval(() => {}, 1000)';
    const script = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], {stdio: "inherit"}); setInterval(() => {}, 1000)`;
    const job = jobs.start({ command: command(script) });
    let childPid = 0;
    await expect
      .poll(
        async () => {
          try {
            childPid = Number(await readFile(join(root, "child.pid"), "utf8"));
            return childPid > 0;
          } catch {
            return false;
          }
        },
        { timeout: 5000 },
      )
      .toBe(true);
    await jobs.cancel(job.jobId);
    await expect
      .poll(
        () => {
          try {
            process.kill(childPid, 0);
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 5000 },
      )
      .toBe(true);
    expect(unrelated.status(other.jobId).state).toBe("running");
    expect(jobs.status(job.jobId).state).toBe("cancelled");
  }, 15000);
  it("terminates timed out work and rejects an aborted launch", async () => {
    const jobs = owner({ concurrent: 2, timeoutMs: 100, outputBytes: 1024 });
    const job = jobs.start({ command: command("setInterval(() => {}, 1000)") });
    await expect.poll(() => jobs.status(job.jobId).state, { timeout: 5000 }).toBe("failed");
    expect(jobs.status(job.jobId).error).toMatch(/timeout/);
    expect(() => jobs.start({ command: "echo late" }, AbortSignal.abort())).toThrow();
  });
});
