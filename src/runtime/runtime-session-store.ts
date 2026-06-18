import type { RuntimeSession, RuntimeSessionCreateOptions, RuntimeSessionStore } from "./types.js";

function createSessionId(): string {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneSession(session: RuntimeSession): RuntimeSession {
  return {
    ...session,
    messages: session.messages.map((message) => ({ ...message })),
    metadata: { ...session.metadata },
  };
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

export function createRuntimeSessionStore(): RuntimeSessionStore {
  return new InMemoryRuntimeSessionStore();
}
