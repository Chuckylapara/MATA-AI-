"use client";
import { apiBase, getToken, refreshTokens } from "@/lib/api";

export class NexusApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const go = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    return fetch(`${apiBase()}/nexus${path}`, { ...init, headers });
  };
  let res = await go();
  if (res.status === 401 && (await refreshTokens())) res = await go();
  return res;
}

async function json<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new NexusApiError(res.status, typeof d.detail === "string" ? d.detail : `${res.status} ${res.statusText}`);
  }
  return res.json();
}

const body = (b: unknown) => JSON.stringify(b);

export type SSEHandler = (event: string, data: any) => void;

/** POST /nexus/converse and dispatch SSE events as they arrive. Returns an abort function. */
export function converse(text: string, conversationId: string | null, onEvent: SSEHandler,
                         channel: "text" | "voice" = "text"): { abort: () => void; done: Promise<void> } {
  const ctrl = new AbortController();
  const done = (async () => {
    const res = await send("/converse", {
      method: "POST", body: body({ text, conversation_id: conversationId, channel }), signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      onEvent("error", { code: `http_${res.status}`, message: d.detail || res.statusText });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let ev = "message", data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) ev = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        try { onEvent(ev, data ? JSON.parse(data) : {}); } catch { /* ignore malformed */ }
      }
    }
  })().catch((e) => {
    if ((e as Error).name !== "AbortError") onEvent("error", { code: "network", message: String(e) });
  });
  return { abort: () => ctrl.abort(), done };
}

export const nexus = {
  status: () => json("/status"),
  profile: () => json("/profile"),
  saveProfile: (p: any) => json("/profile", { method: "PUT", body: body(p) }),
  deleteAllData: () => json("/profile", { method: "DELETE" }),
  memories: (q?: string, type?: string) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (type) s.set("type", type);
    return json(`/memories?${s}`);
  },
  addMemory: (m: any) => json("/memories", { method: "POST", body: body(m) }),
  editMemory: (id: string, m: any) => json(`/memories/${id}`, { method: "PATCH", body: body(m) }),
  deleteMemory: (id: string) => json(`/memories/${id}`, { method: "DELETE" }),
  deleteAllMemories: () => json("/memories?confirm=true", { method: "DELETE" }),
  exportMemories: () => json("/memories/export"),
  consolidate: () => json("/memories/consolidate", { method: "POST" }),
  setMemoryEnabled: (enabled: boolean) => json("/memory-settings", { method: "PUT", body: body({ enabled }) }),
  permissions: () => json("/permissions"),
  setPermission: (cap: string, mode: string, minutes?: number) =>
    json(`/permissions/${cap}`, { method: "PUT", body: body({ mode, minutes }) }),
  rules: () => json("/trusted-rules"),
  addRule: (r: any) => json("/trusted-rules", { method: "POST", body: body(r) }),
  deleteRule: (id: string) => json(`/trusted-rules/${id}`, { method: "DELETE" }),
  pending: () => json("/actions/pending"),
  confirm: (id: string) => json(`/actions/${id}/confirm`, { method: "POST" }),
  reject: (id: string) => json(`/actions/${id}/reject`, { method: "POST" }),
  feed: () => json("/feed"),
  audit: () => json("/audit"),
  notifications: () => json("/notifications"),
  tasks: () => json("/tasks"),
  createTask: (t: any) => json("/tasks", { method: "POST", body: body(t) }),
  taskOp: (id: string, op: "pause" | "resume" | "run") => json(`/tasks/${id}/${op}`, { method: "POST" }),
  deleteTask: (id: string) => json(`/tasks/${id}`, { method: "DELETE" }),
  taskRuns: (id: string) => json(`/tasks/${id}/runs`),
  tools: () => json("/tools"),
  agents: () => json("/agents"),
  integrations: () => json("/integrations"),
  hardware: () => json("/system/hardware"),
  health: () => json("/system/health"),
  serverEvents: () => json("/system/events"),
  visionAsk: (question: string, image_b64: string, mime = "image/jpeg") =>
    json("/vision/ask", { method: "POST", body: body({ question, image_b64, mime }) }),
  clientEvent: (name: string, data: any = {}) =>
    json("/events", { method: "POST", body: body({ name, data }) }).catch(() => null),
};
