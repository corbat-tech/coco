import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { getRuntimeTurn } from "./turn-transcript.js";
import type { RuntimeSession, RuntimeSessionCreateOptions, RuntimeSessionStore } from "./types.js";

function createSessionId(): string {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneSession(session: RuntimeSession): RuntimeSession {
  return structuredClone(session);
}

export class InMemoryRuntimeSessionStore implements RuntimeSessionStore {
  private sessions = new Map<string, RuntimeSession>();

  create(options: RuntimeSessionCreateOptions = {}): RuntimeSession {
    if (options.id && this.sessions.has(options.id))
      throw new Error(`Runtime session already exists: ${options.id}`);
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

    this.sessions.set(session.id, cloneSession(session));
    return cloneSession(session);
  }

  get(id: string): RuntimeSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  update(session: RuntimeSession): RuntimeSession {
    const updated: RuntimeSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      messages: session.messages.map((message) => ({ ...message })),
      metadata: { ...session.metadata },
    };
    this.sessions.set(updated.id, cloneSession(updated));
    return cloneSession(updated);
  }

  list(): RuntimeSession[] {
    return [...this.sessions.values()].map(cloneSession);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
}

interface RuntimeSessionFile {
  version: 1;
  sessions: RuntimeSession[];
}

const SessionFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(
    z
      .object({
        id: z.string().min(1),
        createdAt: z.string(),
        updatedAt: z.string(),
        mode: z.enum(["ask", "plan", "build", "debug", "review", "architect"]),
        messages: z.array(
          z
            .object({
              role: z.enum(["user", "assistant", "system"]),
              content: z.union([z.string(), z.array(z.object({ type: z.string() }).passthrough())]),
            })
            .passthrough(),
        ),
        metadata: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  ),
});

export class FileRuntimeSessionStore implements RuntimeSessionStore {
  private sessions = new Map<string, RuntimeSession>();

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.sessions = this.readSessionsFromDisk();
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

    const sessions = this.readSessionsFromDisk();
    if (sessions.has(session.id)) throw new Error(`Runtime session already exists: ${session.id}`);
    sessions.set(session.id, cloneSession(session));
    this.sessions = sessions;
    this.persist(sessions);
    return cloneSession(session);
  }

  get(id: string): RuntimeSession | undefined {
    this.sessions = this.readSessionsFromDisk();
    const session = this.sessions.get(id);
    return session ? cloneSession(session) : undefined;
  }

  update(session: RuntimeSession): RuntimeSession {
    const updated: RuntimeSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      messages: session.messages.map((message) => ({ ...message })),
      metadata: { ...session.metadata },
    };
    const sessions = this.readSessionsFromDisk();
    sessions.set(updated.id, cloneSession(updated));
    this.sessions = sessions;
    this.persist(sessions);
    return cloneSession(updated);
  }

  list(): RuntimeSession[] {
    this.sessions = this.readSessionsFromDisk();
    return [...this.sessions.values()].map(cloneSession);
  }

  delete(id: string): boolean {
    const sessions = this.readSessionsFromDisk();
    const deleted = sessions.delete(id);
    this.sessions = sessions;
    if (deleted) this.persist(sessions);
    return deleted;
  }

  private readSessionsFromDisk(): Map<string, RuntimeSession> {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return new Map();
      }
      throw error;
    }
    const parsed = JSON.parse(raw) as RuntimeSessionFile;
    if (!SessionFileSchema.safeParse(parsed).success)
      throw new Error(`Corrupt or unsupported runtime session store format: ${this.filePath}`);
    if (new Set(parsed.sessions.map((session) => session.id)).size !== parsed.sessions.length)
      throw new Error(`Duplicate runtime session IDs in store: ${this.filePath}`);
    for (const session of parsed.sessions) getRuntimeTurn(session);
    return new Map(parsed.sessions.map((session) => [session.id, cloneSession(session)]));
  }

  private persist(sessions: Map<string, RuntimeSession>): void {
    const payload: RuntimeSessionFile = {
      version: 1,
      sessions: [...sessions.values()].map(cloneSession),
    };
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tempPath, JSON.stringify(payload, null, 2) + "\n", {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
      renameSync(tempPath, this.filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
  }
}

export function createRuntimeSessionStore(): RuntimeSessionStore {
  return new InMemoryRuntimeSessionStore();
}

export function createFileRuntimeSessionStore(filePath: string): RuntimeSessionStore {
  return new FileRuntimeSessionStore(filePath);
}
