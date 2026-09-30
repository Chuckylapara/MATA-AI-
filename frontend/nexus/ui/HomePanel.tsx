"use client";
// Personal command center: today, tasks, projects, pending confirmations, recent activity, system status.
import { useEffect, useState } from "react";
import { nexus } from "@/nexus/core/api";
import { Badge, Btn, Empty, Panel, clock, fmtTime, statusTone } from "@/nexus/ui/kit";

export default function HomePanel({ onClose, onOpen, name }: { onClose: () => void; onOpen: (s: string) => void; name: string | null }) {
  const [data, setData] = useState<any>({ tasks: [], pending: [], projects: [], feed: [], notes: [], health: null, ints: [] });
  useEffect(() => {
    Promise.allSettled([nexus.tasks(), nexus.pending(), nexus.memories(undefined, "project"), nexus.feed(),
      nexus.notifications(), nexus.health(), nexus.integrations()]).then((r) => {
      const v = (i: number, d: any) => (r[i].status === "fulfilled" ? (r[i] as any).value : d);
      setData({ tasks: v(0, []), pending: v(1, []), projects: v(2, { items: [] }).items, feed: v(3, []),
        notes: v(4, []), health: v(5, null), ints: v(6, []) });
    });
  }, []);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const upcoming = data.tasks.filter((t: any) => t.status === "active").slice(0, 5);
  const comms = data.ints.filter((i: any) => i.category === "communication");
  const research = data.feed.filter((f: any) => /web_search|research/.test(f.message)).slice(0, 4);

  const Card = ({ title, action, children }: any) => (
    <div className="nx-card">
      <div className="flex items-center mb-2">
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">{title}</h3>
        {action && <button onClick={action} className="ml-auto text-[10px] nx-mono text-cyan-300/80 hover:text-cyan-200">OPEN →</button>}
      </div>
      {children}
    </div>
  );

  return (
    <Panel title="Command center" subtitle={`${name ? `Hola ${name} · ` : ""}${today}`} onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card title="Waiting for you">
          {!data.pending.length ? <Empty>No actions awaiting confirmation.</Empty> : (
            <ul className="space-y-1">{data.pending.map((p: any) => <li key={p.id} className="text-xs text-amber-200">{p.tool} · {p.reason}</li>)}</ul>
          )}
        </Card>
        <Card title="Tasks & automations" action={() => onOpen("tasks")}>
          {!upcoming.length ? <Empty>Nothing scheduled.</Empty> : (
            <ul className="space-y-1">{upcoming.map((t: any) => <li key={t.id} className="text-xs text-slate-300">{t.title} <span className="text-slate-500">· {fmtTime(t.next_run_at)}</span></li>)}</ul>
          )}
        </Card>
        <Card title="Projects" action={() => onOpen("projects")}>
          {!data.projects.length ? <Empty>Tell NEXUS what you're building and it will remember.</Empty> : (
            <ul className="space-y-1">{data.projects.slice(0, 5).map((p: any) => <li key={p.id} className="text-xs text-slate-300">{p.content}</li>)}</ul>
          )}
        </Card>
        <Card title="Messages & calendar" action={() => onOpen("communication")}>
          <div className="flex flex-wrap gap-1.5">
            {comms.map((i: any) => <Badge key={i.id} tone={statusTone(i.status)}>{i.name}: {i.status.toLowerCase()}</Badge>)}
          </div>
        </Card>
        <Card title="Recent research" action={() => onOpen("web")}>
          {!research.length ? <Empty>No research yet.</Empty> : (
            <ul className="space-y-1">{research.map((f: any) => <li key={f.id} className="text-xs text-slate-300">{clock(f.created_at)} · {f.message}</li>)}</ul>
          )}
        </Card>
        <Card title="Notifications">
          {!data.notes.length ? <Empty>None.</Empty> : (
            <ul className="space-y-1">{data.notes.slice(0, 4).map((n: any) => <li key={n.id} className="text-xs text-slate-300">{n.title}</li>)}</ul>
          )}
        </Card>
        <Card title="Recent files" action={() => onOpen("files")}><Empty>File intelligence is planned (phase 27).</Empty></Card>
        <Card title="System status" action={() => onOpen("system")}>
          {data.health ? (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={statusTone(data.health.overall)}>{data.health.overall}</Badge>
              {data.health.checks.filter((c: any) => c.status !== "READY").slice(0, 4).map((c: any) => <Badge key={c.name} tone={statusTone(c.status)}>{c.name}</Badge>)}
            </div>
          ) : <Empty>Loading…</Empty>}
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => onOpen("memory")}>Memory</Btn><Btn onClick={() => onOpen("security")}>Security</Btn>
        <Btn onClick={() => onOpen("vision")}>Vision</Btn><Btn onClick={() => onOpen("settings")}>Settings</Btn>
      </div>
    </Panel>
  );
}
