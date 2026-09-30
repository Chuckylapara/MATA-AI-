"use client";
import { useCallback, useEffect, useState } from "react";
import { nexus } from "@/nexus/core/api";
import { Badge, Btn, Empty, ErrorLine, Field, Panel, fmtTime, statusTone } from "@/nexus/ui/kit";

interface Task { id: string; title: string; kind: string; status: string; schedule: any; params: any;
  next_run_at: string | null; last_run_at: string | null; max_retries: number; timeout_s: number; timezone: string }
interface Run { id: string; status: string; attempt: number; error: string | null; output: any; started_at: string }

const GROUPS = [
  { key: "active", label: "Active & scheduled" }, { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" }, { key: "failed", label: "Failed" },
];

export default function AutomationCenter({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [notes, setNotes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", kind: "reminder", when: "in", minutes: 60, at: "", every: 60, query: "", url: "" });

  const load = useCallback(async () => {
    try {
      const [t, n] = await Promise.all([nexus.tasks(), nexus.notifications()]);
      setTasks(t); setNotes(n); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  const act = async (fn: () => Promise<any>) => { try { await fn(); await load(); } catch (e: any) { setError(e.message); } };

  const create = () => act(async () => {
    const body: any = { title: form.title, kind: form.kind, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (form.when === "in") body.in_minutes = Number(form.minutes);
    if (form.when === "at" && form.at) body.at = new Date(form.at).toISOString();
    if (form.when === "every") body.every_minutes = Number(form.every);
    if (form.kind === "web_search") body.query = form.query || form.title;
    if (form.kind === "monitor_url") body.url = form.url;
    await nexus.createTask(body);
    setForm({ ...form, title: "", query: "", url: "" });
  });

  const showRuns = async (id: string) => {
    if (runs[id]) { const r = { ...runs }; delete r[id]; setRuns(r); return; }
    try { setRuns({ ...runs, [id]: await nexus.taskRuns(id) }); } catch (e: any) { setError(e.message); }
  };

  return (
    <Panel title="Automation Center" onClose={onClose}
      subtitle="Reminders, recurring web searches and page monitors. Every run is logged, retried on failure and auditable.">
      <ErrorLine error={error} />
      <form className="nx-card space-y-3" onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) create(); }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Title"><input className="nx-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Call the supplier" /></Field>
          <Field label="Kind">
            <select className="nx-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="reminder">Reminder</option><option value="web_search">Web search</option><option value="monitor_url">Monitor a page</option>
            </select>
          </Field>
          {form.kind === "web_search" && <Field label="Query"><input className="nx-input" value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} placeholder="AI news" /></Field>}
          {form.kind === "monitor_url" && <Field label="URL"><input className="nx-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>}
          <Field label="When">
            <div className="flex gap-2">
              <select className="nx-input w-auto" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })}>
                <option value="in">In</option><option value="at">At</option><option value="every">Every</option>
              </select>
              {form.when === "in" && <input type="number" min={1} className="nx-input" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: +e.target.value })} aria-label="minutes" />}
              {form.when === "at" && <input type="datetime-local" className="nx-input" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />}
              {form.when === "every" && <input type="number" min={15} className="nx-input" value={form.every} onChange={(e) => setForm({ ...form, every: +e.target.value })} aria-label="minutes" />}
              {form.when !== "at" && <span className="self-center text-xs text-slate-400">min</span>}
            </div>
          </Field>
        </div>
        <Btn type="submit" variant="primary" disabled={!form.title.trim() || (form.kind === "monitor_url" && !form.url)}>Create task</Btn>
      </form>

      {GROUPS.map((g) => {
        const list = tasks.filter((t) => t.status === g.key);
        return (
          <div key={g.key}>
            <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">{g.label} ({list.length})</h3>
            {!list.length && <Empty>None.</Empty>}
            <ul className="space-y-2">
              {list.map((t) => (
                <li key={t.id} className="nx-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-100">{t.title}</span>
                    <Badge>{t.kind}</Badge>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    <span className="nx-mono text-[10px] text-slate-500">
                      {t.schedule?.type === "interval" ? `every ${t.schedule.every_minutes} min` : "once"} · next {fmtTime(t.next_run_at)} · last {fmtTime(t.last_run_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {t.status === "active" && <Btn small onClick={() => act(() => nexus.taskOp(t.id, "pause"))}>Pause</Btn>}
                    {(t.status === "paused" || t.status === "failed") && <Btn small onClick={() => act(() => nexus.taskOp(t.id, "resume"))}>Resume</Btn>}
                    <Btn small onClick={() => act(() => nexus.taskOp(t.id, "run"))}>Run now</Btn>
                    <Btn small onClick={() => showRuns(t.id)}>{runs[t.id] ? "Hide history" : "History"}</Btn>
                    <Btn small variant="danger" onClick={() => act(() => nexus.deleteTask(t.id))}>Delete</Btn>
                  </div>
                  {runs[t.id] && (
                    <ul className="mt-2 space-y-1">
                      {!runs[t.id].length && <Empty>No runs yet.</Empty>}
                      {runs[t.id].map((r) => (
                        <li key={r.id} className="nx-mono text-[11px] text-slate-400">
                          {fmtTime(r.started_at)} · <span className={r.status === "succeeded" ? "text-emerald-300" : "text-rose-300"}>{r.status}</span> · attempt {r.attempt}
                          {r.error && <span className="text-rose-300"> · {r.error}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Notifications</h3>
        {!notes.length && <Empty>No notifications.</Empty>}
        <ul className="space-y-1.5">
          {notes.slice(0, 12).map((n) => (
            <li key={n.id} className="text-xs text-slate-300"><span className="nx-mono text-slate-500">{fmtTime(n.created_at)}</span> · {n.title}
              {n.body && <span className="block text-slate-500 whitespace-pre-wrap">{n.body}</span>}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
