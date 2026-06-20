import type {
  EventLog,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeSession,
  RuntimeSessionCreateOptions,
  RuntimeSessionStore,
} from "./types.js";

export interface TenantScopeOptions {
  tenantId: string;
}

export class TenantScopedRuntimeSessionStore implements RuntimeSessionStore {
  constructor(
    private readonly inner: RuntimeSessionStore,
    private readonly options: TenantScopeOptions,
  ) {}

  create(options: RuntimeSessionCreateOptions = {}): RuntimeSession {
    return this.inner.create({
      ...options,
      metadata: this.withTenant(options.metadata),
    });
  }

  get(id: string): RuntimeSession | undefined {
    const session = this.inner.get(id);
    return session && this.belongsToTenant(session) ? session : undefined;
  }

  update(session: RuntimeSession): RuntimeSession {
    if (!this.belongsToTenant(session)) {
      throw new Error(
        `Runtime session ${session.id} does not belong to tenant ${this.options.tenantId}.`,
      );
    }
    return this.inner.update({
      ...session,
      metadata: this.withTenant(session.metadata),
    });
  }

  list(): RuntimeSession[] {
    return this.inner.list().filter((session) => this.belongsToTenant(session));
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    return this.inner.delete(id);
  }

  private withTenant(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    return { ...metadata, tenantId: this.options.tenantId };
  }

  private belongsToTenant(session: RuntimeSession): boolean {
    return session.metadata["tenantId"] === this.options.tenantId;
  }
}

export class TenantScopedEventLog implements EventLog {
  constructor(
    private readonly inner: EventLog,
    private readonly options: TenantScopeOptions,
  ) {}

  record(type: RuntimeEventType, data: Record<string, unknown> = {}): RuntimeEvent {
    return this.inner.record(type, { ...data, tenantId: this.options.tenantId });
  }

  list(): RuntimeEvent[] {
    return this.inner.list().filter((event) => event.data["tenantId"] === this.options.tenantId);
  }

  count(): number {
    return this.list().length;
  }

  clear(): void {
    throw new Error("Tenant-scoped event logs do not support partial clear.");
  }
}

export function createTenantScopedRuntimeSessionStore(
  inner: RuntimeSessionStore,
  tenantId: string,
): RuntimeSessionStore {
  return new TenantScopedRuntimeSessionStore(inner, { tenantId });
}

export function createTenantScopedEventLog(inner: EventLog, tenantId: string): EventLog {
  return new TenantScopedEventLog(inner, { tenantId });
}
