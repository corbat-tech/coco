import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { execa } from "execa";
import { ownShell } from "./owned-shell.js";

export interface BackgroundJob {
  jobId: string;
  pid: number;
  command: string;
  state: "running" | "completed" | "failed" | "cancelled";
  exitCode?: number;
  error?: string;
}
interface OwnedJob {
  info: BackgroundJob;
  stdout: { buffer: Buffer; length: number };
  stderr: { buffer: Buffer; length: number };
  controller: AbortController;
  completion: Promise<void>;
}

/** Host-created capability: never construct from model-supplied session IDs. */
export class BackgroundJobOwner {
  private readonly jobs = new Map<string, OwnedJob>();
  private closed = false;
  private readonly projectRoot: string;

  constructor(
    projectRoot: string,
    private readonly limits = {
      concurrent: 2,
      timeoutMs: 30 * 60 * 1000,
      outputBytes: 16 * 1024 * 1024,
    },
  ) {
    this.projectRoot = realpathSync(projectRoot);
  }

  start(
    input: { command: string; cwd?: string; env?: Record<string, string> },
    signal?: AbortSignal,
  ): BackgroundJob {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("Background owner is closed");
    if (process.platform === "win32")
      throw new Error("Background unavailable on Windows: process-tree ownership is not verified");
    if (
      [...this.jobs.values()].filter((job) => job.info.state === "running").length >=
      this.limits.concurrent
    ) {
      throw new Error("Background concurrency limit reached");
    }
    const cwd = realpathSync(resolve(this.projectRoot, input.cwd ?? "."));
    const path = relative(this.projectRoot, cwd);
    if (path === ".." || path.startsWith("../") || isAbsolute(path))
      throw new Error("Background cwd must belong to the owning project");
    const controller = new AbortController();
    const subprocess = execa(input.command, {
      shell: true,
      cwd,
      env: input.env,
      detached: true,
      buffer: false,
      reject: false,
      stdin: "ignore",
      cleanup: true,
    });
    // Failed creation must never return an invented PID or successful launch.
    if (subprocess.pid === undefined) {
      void subprocess.catch(() => {});
      throw new Error("Background process could not be spawned");
    }
    const job: OwnedJob = {
      info: { jobId: randomUUID(), pid: subprocess.pid, command: input.command, state: "running" },
      stdout: { buffer: Buffer.alloc(0), length: 0 },
      stderr: { buffer: Buffer.alloc(0), length: 0 },
      controller,
      completion: Promise.resolve(),
    };
    this.jobs.set(job.info.jobId, job);
    const stop = (reason: string) => {
      if (controller.signal.aborted) return;
      job.info.error = reason;
      controller.abort(new Error(reason));
    };
    // The launching tool scope ends on return. Only the session owner and this
    // job deadline control the accepted process thereafter.
    const timer = setTimeout(() => stop("Background timeout exceeded"), this.limits.timeoutMs);
    timer.unref();
    const capture = (channel: "stdout" | "stderr", chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const output = job[channel];
      const available = this.limits.outputBytes - output.length;
      const added = Math.min(available, bytes.length);
      const needed = output.length + added;
      if (needed > output.buffer.length) {
        const capacity = Math.min(
          this.limits.outputBytes,
          Math.max(needed, output.buffer.length * 2, 4096),
        );
        const grown = Buffer.allocUnsafe(capacity);
        output.buffer.copy(grown, 0, 0, output.length);
        output.buffer = grown;
      }
      bytes.copy(output.buffer, output.length, 0, added);
      output.length = needed;
      if (bytes.length > available) stop(`Background ${channel} output limit exceeded`);
    };
    subprocess.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    subprocess.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));
    job.completion = (async () => {
      try {
        const result = await ownShell(subprocess, controller.signal);
        job.info.exitCode = result.exitCode;
        job.info.state = job.info.error
          ? job.info.error === "Background cancelled"
            ? "cancelled"
            : "failed"
          : result.exitCode === 0
            ? "completed"
            : "failed";
        if (job.info.state === "failed" && !job.info.error)
          job.info.error = result.shortMessage ?? "Background process failed";
      } catch (error) {
        job.info.state = "failed";
        job.info.error ??= error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
        // At most two completed jobs retain output, in addition to live jobs.
        const completed = [...this.jobs].filter(
          ([, candidate]) => candidate.info.state !== "running",
        );
        for (const [id] of completed.slice(0, Math.max(0, completed.length - 2)))
          this.jobs.delete(id);
      }
    })();
    return { ...job.info };
  }

  list(): BackgroundJob[] {
    return [...this.jobs.values()].map((job) => ({ ...job.info }));
  }
  status(jobId: string): BackgroundJob {
    return { ...this.get(jobId).info };
  }
  read(jobId: string, channel: "stdout" | "stderr", offset = 0, limit = 64 * 1024) {
    const output = this.get(jobId)[channel];
    const nextOffset = Math.max(offset, Math.min(output.length, offset + limit));
    const page = output.buffer.subarray(offset, Math.min(nextOffset, output.length));
    return {
      output: page.toString("utf8"),
      base64: page.toString("base64"),
      nextOffset,
      totalBytes: output.length,
    };
  }
  async cancel(jobId: string): Promise<BackgroundJob> {
    const job = this.get(jobId);
    if (job.info.state === "running" && !job.controller.signal.aborted) {
      job.info.error = "Background cancelled";
      job.controller.abort(new Error(job.info.error));
    }
    await job.completion;
    return { ...job.info };
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.jobs.keys()].map((jobId) => this.cancel(jobId)));
  }
  private get(jobId: string): OwnedJob {
    const job = this.jobs.get(jobId);
    if (!job)
      throw new Error("Unknown job in this session; jobs cannot be recovered after restart");
    return job;
  }
}
