import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EventLog, RuntimeEvent, RuntimeEventType } from "./types.js";

export class InMemoryEventLog implements EventLog {
  private events: RuntimeEvent[] = [];

  record(type: RuntimeEventType, data: Record<string, unknown> = {}): RuntimeEvent {
    const event: RuntimeEvent = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    this.events.push(event);
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

export class FileEventLog implements EventLog {
  private memory = new InMemoryEventLog();
  private writable = true;

  constructor(private readonly filePath: string) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      this.writable = false;
    }
  }

  record(type: RuntimeEventType, data: Record<string, unknown> = {}): RuntimeEvent {
    const event = this.memory.record(type, data);
    if (this.writable) {
      try {
        appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf-8");
      } catch {
        this.writable = false;
      }
    }
    return event;
  }

  list(): RuntimeEvent[] {
    if (!this.writable) return this.memory.list();

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return raw
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as RuntimeEvent];
          } catch {
            return [];
          }
        });
    } catch {
      return this.memory.list();
    }
  }

  count(): number {
    return this.list().length;
  }

  clear(): void {
    this.memory.clear();
    if (this.writable) {
      try {
        writeFileSync(this.filePath, "", "utf-8");
      } catch {
        this.writable = false;
      }
    }
  }
}

export function createEventLog(): EventLog {
  return new InMemoryEventLog();
}

export function createFileEventLog(filePath: string): EventLog {
  return new FileEventLog(filePath);
}
