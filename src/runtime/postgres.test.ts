import { describe, expect, it } from "vitest";
import {
  createAsyncPostgresEventLog,
  createAsyncPostgresRuntimeSessionStore,
  createPostgresEventLog,
  createPostgresRuntimeAuditStore,
  createPostgresRuntimeSessionStore,
  type PostgresQueryClient,
} from "./postgres.js";
import { createEventLog } from "./event-log.js";
import { createRuntimeSessionStore } from "./runtime-session-store.js";
import {
  createTenantScopedEventLog,
  createTenantScopedRuntimeSessionStore,
} from "./tenant-scope.js";

function createMemoryPostgresClient(): PostgresQueryClient {
  const sessions: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];

  return {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

      if (normalized.startsWith("insert into coco_runtime_sessions")) {
        const row = {
          id: params[0],
          tenant_id: params[1],
          created_at: params[2],
          updated_at: params[3],
          mode: params[4],
          messages: params[5],
          instructions: params[6],
          metadata: params[7],
        };
        const index = sessions.findIndex((session) => session["id"] === row.id);
        if (index >= 0 && sessions[index]?.["tenant_id"] === row.tenant_id) sessions[index] = row;
        else if (index >= 0) return { rows: [], rowCount: 0 };
        else sessions.push(row);
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith("select * from coco_runtime_sessions where id = $1")) {
        return {
          rows: sessions.filter(
            (session) => session["id"] === params[0] && session["tenant_id"] === params[1],
          ),
        };
      }

      if (normalized.startsWith("select * from coco_runtime_sessions where tenant_id = $1")) {
        return {
          rows: sessions.filter((session) => session["tenant_id"] === params[0]),
        };
      }

      if (normalized.startsWith("update coco_runtime_sessions")) {
        const index = sessions.findIndex(
          (session) => session["id"] === params[0] && session["tenant_id"] === params[1],
        );
        if (index < 0) return { rows: [], rowCount: 0 };
        sessions[index] = {
          ...sessions[index],
          updated_at: params[2],
          mode: params[3],
          messages: params[4],
          instructions: params[5],
          metadata: params[6],
        };
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith("delete from coco_runtime_sessions")) {
        const index = sessions.findIndex(
          (session) => session["id"] === params[0] && session["tenant_id"] === params[1],
        );
        if (index < 0) return { rows: [], rowCount: 0 };
        sessions.splice(index, 1);
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith("insert into coco_runtime_events")) {
        events.push({
          id: params[0],
          tenant_id: params[1],
          type: params[2],
          timestamp: params[3],
          data: params[4],
        });
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith("select count(*)::int as count from coco_runtime_events")) {
        return {
          rows: [
            {
              count: events.filter((event) => event["tenant_id"] === params[0]).length,
            },
          ],
        };
      }

      if (normalized.startsWith("delete from coco_runtime_events")) {
        const before = events.length;
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (events[index]?.["tenant_id"] === params[0]) events.splice(index, 1);
        }
        return { rows: [], rowCount: before - events.length };
      }

      if (normalized.startsWith("select * from coco_runtime_events")) {
        return {
          rows: events.filter((event) => {
            const tenantMatches = params[0] === null || event["tenant_id"] === params[0];
            const data = JSON.parse(String(event["data"])) as Record<string, unknown>;
            const sessionMatches = params[1] === null || data["sessionId"] === params[1];
            return tenantMatches && sessionMatches;
          }),
        };
      }

      if (normalized.startsWith("insert into coco_runtime_audit_events")) {
        audits.push({
          id: params[0],
          tenant_id: params[1],
          type: params[2],
          subject: params[3],
          timestamp: params[4],
          data: params[5],
        });
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith("select * from coco_runtime_audit_events")) {
        return {
          rows: audits.filter((audit) => audit["tenant_id"] === params[0]),
        };
      }

      throw new Error(`Unhandled SQL in test client: ${sql}`);
    },
  };
}

describe("hosted postgres runtime stores", () => {
  it("rejects sync Postgres stores in hosted mode", () => {
    const client = createMemoryPostgresClient();

    expect(() =>
      createPostgresRuntimeSessionStore(client, { tenantId: "tenant-a", hostMode: "hosted" }),
    ).toThrow("Postgres sync runtime stores are local/cache-compatible only");
    expect(() =>
      createPostgresEventLog(client, { tenantId: "tenant-a", hostMode: "hosted" }),
    ).toThrow("Postgres sync runtime stores are local/cache-compatible only");
  });

  it("isolates async sessions, events, and audit records by tenant", async () => {
    const client = createMemoryPostgresClient();
    const sessionsA = createAsyncPostgresRuntimeSessionStore(client, { tenantId: "tenant-a" });
    const sessionsB = createAsyncPostgresRuntimeSessionStore(client, { tenantId: "tenant-b" });
    const eventsA = createAsyncPostgresEventLog(client, { tenantId: "tenant-a" });
    const eventsB = createAsyncPostgresEventLog(client, { tenantId: "tenant-b" });
    const auditA = createPostgresRuntimeAuditStore(client, { tenantId: "tenant-a" });
    const auditB = createPostgresRuntimeAuditStore(client, { tenantId: "tenant-b" });

    const sessionA = await sessionsA.create({ id: "rt_a", metadata: { channel: "whatsapp" } });
    const sessionB = await sessionsB.create({ id: "rt_b" });
    await eventsA.record("turn.completed", { sessionId: sessionA.id });
    await eventsB.record("turn.completed", { sessionId: sessionB.id });
    await auditA.record({ type: "policy.block", subject: "tool.execute" });
    await auditB.record({ type: "policy.allow", subject: "turn.run" });

    expect(await sessionsA.get(sessionB.id)).toBeUndefined();
    expect((await sessionsA.list()).map((session) => session.id)).toEqual(["rt_a"]);
    expect(await sessionsA.delete(sessionB.id)).toBe(false);
    await expect(sessionsA.update(sessionB)).rejects.toThrow(
      "Runtime session not found for tenant tenant-a: rt_b",
    );
    expect(await eventsA.count()).toBe(1);
    expect((await eventsA.list()).map((event) => event.data["sessionId"])).toEqual(["rt_a"]);
    expect((await auditA.list()).map((record) => record.type)).toEqual(["policy.block"]);
  });

  it("does not let another tenant claim an existing hosted session id", async () => {
    const client = createMemoryPostgresClient();
    const sessionsA = createAsyncPostgresRuntimeSessionStore(client, { tenantId: "tenant-a" });
    const sessionsB = createAsyncPostgresRuntimeSessionStore(client, { tenantId: "tenant-b" });

    await sessionsA.create({ id: "rt_shared" });
    await expect(sessionsB.create({ id: "rt_shared" })).rejects.toThrow(
      "Runtime session id is already owned by another tenant: rt_shared",
    );
    expect(await sessionsB.get("rt_shared")).toBeUndefined();
    expect(await sessionsA.get("rt_shared")).toMatchObject({
      id: "rt_shared",
      metadata: { tenantId: "tenant-a" },
    });
  });

  it("propagates DB errors from hosted async stores", async () => {
    const failingClient: PostgresQueryClient = {
      async query() {
        throw new Error("db unavailable");
      },
    };
    const sessions = createAsyncPostgresRuntimeSessionStore(failingClient, {
      tenantId: "tenant-a",
    });
    const events = createAsyncPostgresEventLog(failingClient, { tenantId: "tenant-a" });

    await expect(sessions.create({ id: "rt_fail" })).rejects.toThrow("db unavailable");
    await expect(events.record("turn.failed", { sessionId: "rt_fail" })).rejects.toThrow(
      "db unavailable",
    );
  });

  it("requires tenant id for hosted async stores", () => {
    const client = createMemoryPostgresClient();

    expect(() => createAsyncPostgresRuntimeSessionStore(client, {})).toThrow(
      "Postgres hosted runtime stores require tenantId.",
    );
    expect(() => createAsyncPostgresEventLog(client, {})).toThrow(
      "Postgres hosted runtime stores require tenantId.",
    );
  });
});

describe("tenant-scoped runtime wrappers", () => {
  it("filters sync session stores and event logs by tenant", () => {
    const backingStore = createRuntimeSessionStore();
    const tenantAStore = createTenantScopedRuntimeSessionStore(backingStore, "tenant-a");
    const tenantBStore = createTenantScopedRuntimeSessionStore(backingStore, "tenant-b");
    const backingLog = createEventLog();
    const tenantALog = createTenantScopedEventLog(backingLog, "tenant-a");
    const tenantBLog = createTenantScopedEventLog(backingLog, "tenant-b");

    const sessionA = tenantAStore.create({ id: "rt_a" });
    const sessionB = tenantBStore.create({ id: "rt_b" });
    tenantALog.record("turn.completed", { sessionId: sessionA.id });
    tenantBLog.record("turn.completed", { sessionId: sessionB.id });

    expect(tenantAStore.get("rt_b")).toBeUndefined();
    expect(tenantAStore.list().map((session) => session.id)).toEqual(["rt_a"]);
    expect(tenantAStore.delete("rt_b")).toBe(false);
    expect(tenantALog.list().map((event) => event.data["sessionId"])).toEqual(["rt_a"]);
    expect(tenantALog.count()).toBe(1);
    expect(() => tenantALog.clear()).toThrow(
      "Tenant-scoped event logs do not support partial clear",
    );
  });
});
