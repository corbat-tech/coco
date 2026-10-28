import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimeSessionStore,
  createFileRuntimeSessionStore,
} from "./runtime-session-store.js";
import { createAsyncPostgresRuntimeSessionStore, type PostgresQueryClient } from "./postgres.js";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("runtime session identity entropy", () => {
  it.each(["memory", "file", "postgres"])(
    "%s creates distinct session IDs even with a fixed clock and Math.random",
    async (type) => {
      const root = await mkdtemp(join(tmpdir(), "coco-session-entropy-"));
      temporary.push(root);
      const client: PostgresQueryClient = {
        async query() {
          return { rows: [], rowCount: 1 };
        },
      };
      const store =
        type === "memory"
          ? createRuntimeSessionStore()
          : type === "file"
            ? createFileRuntimeSessionStore(join(root, "sessions.json"))
            : createAsyncPostgresRuntimeSessionStore(client, { tenantId: "fixture" });
      vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      const insecure = vi.spyOn(Math, "random").mockReturnValue(0);
      const first = await store.create();
      const second = await store.create();
      expect(first.id).not.toBe(second.id);
      expect(insecure).not.toHaveBeenCalled();
      expect(first.id).toMatch(
        /^rt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect((await store.create({ id: "rt_existing-caller-id" })).id).toBe(
        "rt_existing-caller-id",
      );
    },
  );
});
