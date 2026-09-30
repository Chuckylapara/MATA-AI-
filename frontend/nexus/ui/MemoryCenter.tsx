"use client";
import { useCallback, useEffect, useState } from "react";
import { nexus } from "@/nexus/core/api";
import { Badge, Btn, Empty, ErrorLine, Field, Panel, fmtTime } from "@/nexus/ui/kit";

const TYPES = ["short_term", "conversation", "semantic", "personal", "preference", "project", "task", "relationship",
  "document", "work", "creative", "technical"];

interface Memory { id: string; type: string; content: string; importance: number; source: string; tags: string[];
  created_at: string; access_count: number; embedding_model: string | null; expires_at: string | null }

export default function MemoryCenter({ onClose, fixedType, title }: { onClose: () => void; fixedType?: string; title?: string }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState(fixedType ?? "");
  const [draft, setDraft] = useState({ content: "", type: fixedType ?? "semantic" });
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await nexus.memories(q || undefined, type || undefined);
      setItems(r.items); setEnabled(r.memory_enabled); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [q, type]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const exportJson = () => act(async () => {
    const data = await nexus.exportMemories();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nexus-memory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  return (
    <Panel title={title ?? "Memory Center"} onClose={onClose}
      subtitle="Everything NEXUS remembers about you. Nothing is hidden — edit, delete or export at any time."
      actions={<Badge tone={enabled ? "ok" : "warn"}>{enabled ? "memory on" : "memory off"}</Badge>}>
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => act(() => nexus.setMemoryEnabled(!enabled))} disabled={busy}>
          {enabled ? "Disable memory" : "Enable memory"}
        </Btn>
        <Btn onClick={exportJson} disabled={busy}>Export JSON</Btn>
        <Btn onClick={() => act(() => nexus.consolidate())} disabled={busy} title="Merge duplicates, drop expired">Consolidate</Btn>
        <Btn variant="danger" disabled={busy || !items.length} onClick={() => {
          if (confirm("Delete ALL memories permanently? This cannot be undone.")) act(() => nexus.deleteAllMemories());
        }}>Delete all</Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <input className="nx-input" placeholder="Semantic search… (e.g. “my company”)" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Search memory" />
        {!fixedType && (
          <select className="nx-input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      <form className="nx-card space-y-2" onSubmit={(e) => {
        e.preventDefault();
        if (!draft.content.trim()) return;
        act(async () => { await nexus.addMemory({ content: draft.content, type: draft.type }); setDraft({ ...draft, content: "" }); });
      }}>
        <Field label="Add a memory">
          <textarea className="nx-input min-h-[56px]" value={draft.content} placeholder="e.g. I'm building the VOIDSAINT website"
            onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </Field>
        <div className="flex gap-2">
          {!fixedType && (
            <select className="nx-input w-auto" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} aria-label="Memory type">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <Btn type="submit" variant="primary" disabled={busy || !draft.content.trim()}>Save</Btn>
        </div>
      </form>

      <ul className="space-y-2">
        {!items.length && <Empty>No memories {q ? "match this search" : "yet"}.</Empty>}
        {items.map((m) => (
          <li key={m.id} className="nx-card">
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              <Badge>{m.type}</Badge>
              <Badge tone="mute">{m.source}</Badge>
              <span className="nx-mono text-[10px] text-slate-500">imp {m.importance.toFixed(2)} · used {m.access_count}× · {fmtTime(m.created_at)}</span>
              {m.expires_at && <Badge tone="warn">expires {fmtTime(m.expires_at)}</Badge>}
            </div>
            {editing?.id === m.id ? (
              <div className="space-y-2">
                <textarea className="nx-input min-h-[56px]" value={editing.content} autoFocus
                  onChange={(e) => setEditing({ id: m.id, content: e.target.value })} />
                <div className="flex gap-2">
                  <Btn small variant="primary" onClick={() => act(async () => { await nexus.editMemory(m.id, { content: editing.content }); setEditing(null); })}>Save</Btn>
                  <Btn small onClick={() => setEditing(null)}>Cancel</Btn>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{m.content}</p>
            )}
            {editing?.id !== m.id && (
              <div className="flex gap-2 mt-2">
                <Btn small onClick={() => setEditing({ id: m.id, content: m.content })}>Edit</Btn>
                <Btn small variant="danger" onClick={() => act(() => nexus.deleteMemory(m.id))}>Delete</Btn>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
