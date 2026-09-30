"use client";
// Client-side event bus mirroring the server's typed events. Modules (avatar, voice,
// vision, UI) react independently without importing each other.

export type BusEvent =
  | "USER_SPOKE" | "USER_INTERRUPTED" | "CAMERA_ENABLED" | "CAMERA_DISABLED" | "MIC_ENABLED" | "MIC_DISABLED"
  | "SEARCH_STARTED" | "SEARCH_COMPLETED" | "TOOL_STARTED" | "TOOL_COMPLETED" | "MEMORY_CREATED"
  | "MEMORY_RETRIEVED" | "TASK_STARTED" | "TASK_COMPLETED" | "TASK_FAILED" | "AVATAR_STATE_CHANGED"
  | "CONFIRMATION_REQUIRED" | "ERROR";

type Handler = (data: any) => void;

class Bus {
  private subs = new Map<string, Set<Handler>>();
  private log: { name: string; data: any; ts: number }[] = [];

  on(name: BusEvent | "*", fn: Handler): () => void {
    if (!this.subs.has(name)) this.subs.set(name, new Set());
    this.subs.get(name)!.add(fn);
    return () => this.subs.get(name)?.delete(fn);
  }

  emit(name: BusEvent, data: any = {}) {
    this.log.push({ name, data, ts: Date.now() });
    if (this.log.length > 300) this.log.shift();
    for (const key of [name, "*"]) {
      this.subs.get(key)?.forEach((fn) => {
        try { fn(key === "*" ? { name, data } : data); } catch (e) { console.error("[nexus bus]", name, e); }
      });
    }
  }

  recent(n = 50) { return this.log.slice(-n); }
}

export const bus = new Bus();
