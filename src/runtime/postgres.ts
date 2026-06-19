import { randomUUID } from "node:crypto";
import type {
  EventLog,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeSession,
  RuntimeSessionCreateOptions,
  RuntimeSessionStore,
} from "./types.js";

export interface PostgresQueryClient {
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface PostgresRuntimeStoreOptions {
  tenantId?: string;
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

export class PostgresRuntimeSessionStore implements RuntimeSessionStore {
  private sessions = new Map<string, RuntimeSession>();

  constructor(
    private readonly client: PostgresQueryClient,
    private readonly options: PostgresRuntimeStoreOptions = {},
  ) {}

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
  ) {}

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
