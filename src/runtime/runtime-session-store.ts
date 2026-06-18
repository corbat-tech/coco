import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
    const now = new Date().toISOString();
    const session: RuntimeSession = {
      id: options.id ?? createSessionId(),
      createdAt: now,
      updatedAt: now,
      mode: options.mode ?? "build",
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
      mode: options.mode ?? "build",
      messages: options.messages ? options.messages.map((message) => ({ ...message })) : [],
      instructions: options.instructions,
      metadata: { ...options.metadata },
    };

    const sessions = this.readSessionsFromDisk();
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
    if (!raw.trim()) return new Map();

    const parsed = JSON.parse(raw) as RuntimeSessionFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      throw new Error(`Unsupported runtime session store format: ${this.filePath}`);
    }
    return new Map(parsed.sessions.map((session) => [session.id, cloneSession(session)]));
  }

  private persist(sessions: Map<string, RuntimeSession>): void {
    const payload: RuntimeSessionFile = {
      version: 1,
      sessions: [...sessions.values()].map(cloneSession),
    };
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    renameSync(tempPath, this.filePath);
  }
}

export function createRuntimeSessionStore(): RuntimeSessionStore {
  return new InMemoryRuntimeSessionStore();
}

export function createFileRuntimeSessionStore(filePath: string): RuntimeSessionStore {
  return new FileRuntimeSessionStore(filePath);
}
