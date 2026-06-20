import { randomUUID } from "node:crypto";
import type {
  AsyncEventLog,
  AsyncRuntimeSessionStore,
  EventLog,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeSession,
  RuntimeSessionCreateOptions,
  RuntimeSessionStore,
} from "./types.js";
import type { RuntimeHostMode } from "./context.js";

export interface PostgresQueryClient {
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface PostgresRuntimeStoreOptions {
  tenantId?: string;
  hostMode?: RuntimeHostMode;
}

export interface RuntimeAuditRecord {
  id: string;
  tenantId: string;
  type: string;
  timestamp: string;
  subject?: string;
  data: Record<string, unknown>;
}

export interface RuntimeAuditStore {
  record(input: {
    type: string;
    subject?: string;
    data?: Record<string, unknown>;
  }): Promise<RuntimeAuditRecord>;
  list(): Promise<RuntimeAuditRecord[]>;
}

interface SessionRow {
  id: string;
  created_at: string | Date;
  updated_at: string | Date;
  mode: RuntimeSession["mode"];
  messages: RuntimeSession["messages"] | string;
  instructions: string | null;
  metadata: RuntimeSession["metadata"] | string | null;
}

interface EventRow {
  id: string;
  type: RuntimeEventType;
  timestamp: string | Date;
  data: Record<string, unknown> | string | null;
}

function createSessionId(): string {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value;
}

function dateToIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToSession(row: SessionRow): RuntimeSession {
  return {
    id: row.id,
    createdAt: dateToIso(row.created_at),
    updatedAt: dateToIso(row.updated_at),
    mode: row.mode,
    messages: parseJson(row.messages, []),
    instructions: row.instructions ?? undefined,
    metadata: parseJson(row.metadata, {}),
  };
}

function rowToEvent(row: EventRow): RuntimeEvent {
  return {
    id: row.id,
    type: row.type,
    timestamp: dateToIso(row.timestamp),
    data: parseJson(row.data, {}),
  };
}

function persistBestEffort(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function assertPostgresSyncStoreNotHosted(options: PostgresRuntimeStoreOptions): void {
  if (options.hostMode === "hosted") {
    throw new Error(
      "Postgres sync runtime stores are local/cache-compatible only. Use async hosted Postgres stores in hosted mode.",
    );
  }
}

function requireTenantId(options: PostgresRuntimeStoreOptions): string {
  if (!options.tenantId) {
    throw new Error("Postgres hosted runtime stores require tenantId.");
  }
  return options.tenantId;
}

export class PostgresRuntimeSessionStore implements RuntimeSessionStore {
  private sessions = new Map<string, RuntimeSession>();

  constructor(
    private readonly client: PostgresQueryClient,
    private readonly options: PostgresRuntimeStoreOptions = {},
  ) {
    assertPostgresSyncStoreNotHosted(options);
  }

  create(options: RuntimeSessionCreateOptions = {}): RuntimeSession {
    const now = new Date().toISOString();
    const session: RuntimeSession = {
      id: options.id ?? createSessionId(),
      createdAt: now,
      updatedAt: now,
      mode: options.mode ?? "ask",
      messages: options.messages ? options.messages.map((message) => ({ ...message })) : [],
      instructions: options.instructions,
      metadata: { ...options.metadata },
    };

    persistBestEffort(
      this.client.query(
        `insert into coco_runtime_sessions
        (id, tenant_id, created_at, updated_at, mode, messages, instructions, metadata)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
       on conflict (id) do update set
        tenant_id = excluded.tenant_id,
        updated_at = excluded.updated_at,
        mode = excluded.mode,
        messages = excluded.messages,
        instructions = excluded.instructions,
        metadata = excluded.metadata`,
        [
          session.id,
          this.options.tenantId ?? null,
          session.createdAt,
          session.updatedAt,
          session.mode,
          JSON.stringify(session.messages),
          session.instructions ?? null,
          JSON.stringify(session.metadata),
        ],
      ),
    );
    this.sessions.set(session.id, structuredClone(session));

    return structuredClone(session);
  }

  get(id: string): RuntimeSession | undefined {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  update(session: RuntimeSession): RuntimeSession {
    const updated: RuntimeSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      messages: session.messages.map((message) => ({ ...message })),
      metadata: { ...session.metadata },
    };
    this.sessions.set(updated.id, structuredClone(updated));
    persistBestEffort(
      this.client.query(
        `update coco_runtime_sessions
       set updated_at = $2, mode = $3, messages = $4::jsonb, instructions = $5, metadata = $6::jsonb
       where id = $1`,
        [
          updated.id,
          updated.updatedAt,
          updated.mode,
          JSON.stringify(updated.messages),
          updated.instructions ?? null,
          JSON.stringify(updated.metadata),
        ],
      ),
    );
    return structuredClone(updated);
  }

  list(): RuntimeSession[] {
    return [...this.sessions.values()].map((session) => structuredClone(session));
  }

  delete(id: string): boolean {
    const deleted = this.sessions.delete(id);
    persistBestEffort(this.client.query("delete from coco_runtime_sessions where id = $1", [id]));
    return deleted;
  }
}

export class AsyncPostgresRuntimeSessionStore implements AsyncRuntimeSessionStore {
  private readonly tenantId: string;

  constructor(
    private readonly client: PostgresQueryClient,
    options: PostgresRuntimeStoreOptions,
  ) {
    this.tenantId = requireTenantId(options);
  }

  async create(options: RuntimeSessionCreateOptions = {}): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    const session: RuntimeSession = {
      id: options.id ?? createSessionId(),
      createdAt: now,
      updatedAt: now,
      mode: options.mode ?? "ask",
      messages: options.messages ? options.messages.map((message) => ({ ...message })) : [],
      instructions: options.instructions,
      metadata: { ...options.metadata, tenantId: this.tenantId },
    };

    const result = await this.client.query(
      `insert into coco_runtime_sessions
        (id, tenant_id, created_at, updated_at, mode, messages, instructions, metadata)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
       on conflict (id) do update set
        updated_at = excluded.updated_at,
        mode = excluded.mode,
        messages = excluded.messages,
        instructions = excluded.instructions,
        metadata = excluded.metadata
       where coco_runtime_sessions.tenant_id = excluded.tenant_id`,
      [
        session.id,
        this.tenantId,
        session.createdAt,
        session.updatedAt,
        session.mode,
        JSON.stringify(session.messages),
        session.instructions ?? null,
        JSON.stringify(session.metadata),
      ],
    );
    if (result.rowCount === 0) {
      throw new Error(`Runtime session id is already owned by another tenant: ${session.id}`);
    }

    return structuredClone(session);
  }

  async get(id: string): Promise<RuntimeSession | undefined> {
    const result = await this.client.query<SessionRow>(
      `select * from coco_runtime_sessions
       where id = $1 and tenant_id = $2
       limit 1`,
      [id, this.tenantId],
    );
    const row = result.rows[0];
    return row ? rowToSession(row) : undefined;
  }

  async update(session: RuntimeSession): Promise<RuntimeSession> {
    const updated: RuntimeSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      messages: session.messages.map((message) => ({ ...message })),
      metadata: { ...session.metadata, tenantId: this.tenantId },
    };
    const result = await this.client.query(
      `update coco_runtime_sessions
       set updated_at = $3, mode = $4, messages = $5::jsonb, instructions = $6, metadata = $7::jsonb
       where id = $1 and tenant_id = $2`,
      [
        updated.id,
        this.tenantId,
        updated.updatedAt,
        updated.mode,
        JSON.stringify(updated.messages),
        updated.instructions ?? null,
        JSON.stringify(updated.metadata),
      ],
    );
    if (result.rowCount === 0) {
      throw new Error(`Runtime session not found for tenant ${this.tenantId}: ${updated.id}`);
    }
    return structuredClone(updated);
  }

  async list(): Promise<RuntimeSession[]> {
    const result = await this.client.query<SessionRow>(
      `select * from coco_runtime_sessions
       where tenant_id = $1
       order by updated_at desc`,
      [this.tenantId],
    );
    return result.rows.map(rowToSession);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.client.query(
      "delete from coco_runtime_sessions where id = $1 and tenant_id = $2",
      [id, this.tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

/**
 * Async helper for hosted products that need to inspect persisted sessions.
 * RuntimeSessionStore remains sync for local runtime compatibility.
 */
export function createPostgresRuntimeSessionQueries(
  client: PostgresQueryClient,
  options: PostgresRuntimeStoreOptions = {},
) {
  return {
    async get(id: string): Promise<RuntimeSession | undefined> {
      const result = await client.query<SessionRow>(
        `select * from coco_runtime_sessions
         where id = $1 and ($2::text is null or tenant_id = $2)
         limit 1`,
        [id, options.tenantId ?? null],
      );
      const row = result.rows[0];
      return row ? rowToSession(row) : undefined;
    },
    async list(): Promise<RuntimeSession[]> {
      const result = await client.query<SessionRow>(
        `select * from coco_runtime_sessions
         where ($1::text is null or tenant_id = $1)
         order by updated_at desc`,
        [options.tenantId ?? null],
      );
      return result.rows.map(rowToSession);
    },
  };
}

export class PostgresEventLog implements EventLog {
  private events: RuntimeEvent[] = [];

  constructor(
    private readonly client: PostgresQueryClient,
    private readonly options: PostgresRuntimeStoreOptions = {},
  ) {
    assertPostgresSyncStoreNotHosted(options);
  }

  record(type: RuntimeEventType, data: Record<string, unknown> = {}): RuntimeEvent {
    const event: RuntimeEvent = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.events.push(event);
    persistBestEffort(
      this.client.query(
        `insert into coco_runtime_events (id, tenant_id, type, timestamp, data)
       values ($1, $2, $3, $4, $5::jsonb)`,
        [
          event.id,
          this.options.tenantId ?? null,
          event.type,
          event.timestamp,
          JSON.stringify(event.data),
        ],
      ),
    );
    return event;
  }

  list(): RuntimeEvent[] {
    return [...this.events];
  }

  count(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }
}

export class AsyncPostgresEventLog implements AsyncEventLog {
  private readonly tenantId: string;

  constructor(
    private readonly client: PostgresQueryClient,
    options: PostgresRuntimeStoreOptions,
  ) {
    this.tenantId = requireTenantId(options);
  }

  async record(type: RuntimeEventType, data: Record<string, unknown> = {}): Promise<RuntimeEvent> {
    const event: RuntimeEvent = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      data: { ...data, tenantId: this.tenantId },
    };
    await this.client.query(
      `insert into coco_runtime_events (id, tenant_id, type, timestamp, data)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [event.id, this.tenantId, event.type, event.timestamp, JSON.stringify(event.data)],
    );
    return event;
  }

  async list(): Promise<RuntimeEvent[]> {
    return listPostgresRuntimeEvents(this.client, { tenantId: this.tenantId });
  }

  async count(): Promise<number> {
    const result = await this.client.query<{ count: string | number }>(
      "select count(*)::int as count from coco_runtime_events where tenant_id = $1",
      [this.tenantId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async clear(): Promise<void> {
    await this.client.query("delete from coco_runtime_events where tenant_id = $1", [
      this.tenantId,
    ]);
  }
}

export class PostgresRuntimeAuditStore implements RuntimeAuditStore {
  private readonly tenantId: string;

  constructor(
    private readonly client: PostgresQueryClient,
    options: PostgresRuntimeStoreOptions,
  ) {
    this.tenantId = requireTenantId(options);
  }

  async record(input: {
    type: string;
    subject?: string;
    data?: Record<string, unknown>;
  }): Promise<RuntimeAuditRecord> {
    const record: RuntimeAuditRecord = {
      id: randomUUID(),
      tenantId: this.tenantId,
      type: input.type,
      subject: input.subject,
      timestamp: new Date().toISOString(),
      data: { ...input.data },
    };
    await this.client.query(
      `insert into coco_runtime_audit_events
        (id, tenant_id, type, subject, timestamp, data)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        record.id,
        record.tenantId,
        record.type,
        record.subject ?? null,
        record.timestamp,
        JSON.stringify(record.data),
      ],
    );
    return record;
  }

  async list(): Promise<RuntimeAuditRecord[]> {
    const result = await this.client.query<{
      id: string;
      tenant_id: string;
      type: string;
      subject: string | null;
      timestamp: string | Date;
      data: Record<string, unknown> | string | null;
    }>(
      `select * from coco_runtime_audit_events
       where tenant_id = $1
       order by timestamp asc`,
      [this.tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      type: row.type,
      subject: row.subject ?? undefined,
      timestamp: dateToIso(row.timestamp),
      data: parseJson(row.data, {}),
    }));
  }
}

export function createPostgresRuntimeSessionStore(
  client: PostgresQueryClient,
  options?: PostgresRuntimeStoreOptions,
): RuntimeSessionStore {
  return new PostgresRuntimeSessionStore(client, options);
}

export function createPostgresEventLog(
  client: PostgresQueryClient,
  options?: PostgresRuntimeStoreOptions,
): EventLog {
  return new PostgresEventLog(client, options);
}

export function createAsyncPostgresRuntimeSessionStore(
  client: PostgresQueryClient,
  options: PostgresRuntimeStoreOptions,
): AsyncRuntimeSessionStore {
  return new AsyncPostgresRuntimeSessionStore(client, options);
}

export function createAsyncPostgresEventLog(
  client: PostgresQueryClient,
  options: PostgresRuntimeStoreOptions,
): AsyncEventLog {
  return new AsyncPostgresEventLog(client, options);
}

export function createPostgresRuntimeAuditStore(
  client: PostgresQueryClient,
  options: PostgresRuntimeStoreOptions,
): RuntimeAuditStore {
  return new PostgresRuntimeAuditStore(client, options);
}

export async function listPostgresRuntimeEvents(
  client: PostgresQueryClient,
  options: PostgresRuntimeStoreOptions & { sessionId?: string } = {},
): Promise<RuntimeEvent[]> {
  const result = await client.query<EventRow>(
    `select * from coco_runtime_events
     where ($1::text is null or tenant_id = $1)
       and ($2::text is null or data->>'sessionId' = $2)
     order by timestamp asc`,
    [options.tenantId ?? null, options.sessionId ?? null],
  );
  return result.rows.map(rowToEvent);
}
