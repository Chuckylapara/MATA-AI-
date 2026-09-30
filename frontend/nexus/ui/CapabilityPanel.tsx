"use client";
// Honest panels for capability areas: shows which integrations are really configured,
// which are NOT CONFIGURED (with setup steps) and which are PLANNED — no fake buttons.
import { useEffect, useState } from "react";
import { nexus } from "@/nexus/core/api";
import { Badge, Btn, Empty, ErrorLine, Panel, statusTone } from "@/nexus/ui/kit";

export interface CapabilityDef {
  title: string;
  subtitle: string;
  categories: string[];
  agents: string[];
  phase?: number;
  quick?: { label: string; prompt: string }[];
}

export const CAPABILITIES: Record<string, CapabilityDef> = {
  web: {
    title: "Web intelligence", subtitle: "Multi-source research with citations. External pages are treated as untrusted data.",
    categories: ["search"], agents: ["research", "web", "browser"],
    quick: [
      { label: "Research a topic", prompt: "Investiga toda la información que exista sobre " },
      { label: "Find a movie", prompt: "Busca la película " },
      { label: "Weather", prompt: "¿Qué tiempo hace en " },
    ],
  },
  social: {
    title: "Social media control center", subtitle: "Drafts, scheduling, publishing and analytics through official APIs only.",
    categories: ["social"], agents: ["social"], phase: 13,
    quick: [{ label: "Draft a caption", prompt: "Escríbeme un caption para Instagram sobre " }],
  },
  creator: {
    title: "Creator mode", subtitle: "NEXUS as production manager: research → script → scenes → assets → edit plan → publish.",
    categories: [], agents: ["content", "creative", "website"], phase: 15,
    quick: [
      { label: "YouTube video plan", prompt: "Crea el plan completo de un video de YouTube sobre " },
      { label: "Content campaign", prompt: "Diseña una campaña de contenido de una semana para " },
    ],
  },
  files: {
    title: "Files", subtitle: "Document understanding (PDF, DOCX, CSV, XLSX, images…). Private files are never sent out without authorization.",
    categories: [], agents: [], phase: 27,
  },
  communication: {
    title: "Communication", subtitle: "Email, messaging and calendar. NEXUS drafts; sending always shows the message and asks for confirmation.",
    categories: ["communication"], agents: ["communication"], phase: 12,
    quick: [{ label: "Draft an email", prompt: "Escribe un email a " }],
  },
};

export default function CapabilityPanel({ id, onClose, onPrompt }: { id: string; onClose: () => void; onPrompt: (p: string) => void }) {
  const def = CAPABILITIES[id];
  const [ints, setInts] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([nexus.integrations(), nexus.agents()])
      .then(([i, a]) => { setInts(i); setAgents(a); })
      .catch((e) => setError(e.message));
  }, [id]);
  if (!def) return null;
  const mine = ints.filter((i) => def.categories.includes(i.category));
  const myAgents = agents.filter((a) => def.agents.includes(a.name));

  return (
    <Panel title={def.title} subtitle={def.subtitle} onClose={onClose}>
      <ErrorLine error={error} />
      {def.quick && (
        <div className="flex flex-wrap gap-2">
          {def.quick.map((q) => <Btn key={q.label} variant="primary" onClick={() => onPrompt(q.prompt)}>{q.label}</Btn>)}
        </div>
      )}
      {myAgents.length > 0 && (
        <div>
          <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Agents</h3>
          <ul className="space-y-1.5">
            {myAgents.map((a) => (
              <li key={a.name} className="text-xs text-slate-300 flex flex-wrap gap-2 items-center">
                <Badge tone={statusTone(a.status)}>{a.status}</Badge><span className="nx-mono">{a.name}</span>
                <span className="text-slate-500">{a.description}{a.phase && a.status !== "ready" ? ` (phase ${a.phase})` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Integrations</h3>
        {!mine.length && <Empty>{def.phase ? `This area is planned for phase ${def.phase}. Nothing here is simulated.` : "No integrations for this area."}</Empty>}
        <ul className="space-y-2">
          {mine.map((i) => (
            <li key={i.id} className="nx-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-100">{i.name}</span>
                <Badge tone={statusTone(i.status)}>{i.status === "PLANNED" ? "Planned" : i.status === "CONFIGURED" ? "Connected" : "Integration not configured"}</Badge>
                <Badge tone="mute">{i.cost}</Badge>
              </div>
              {!i.configured && i.setup?.length > 0 && (
                <ol className="list-decimal ml-5 mt-2 text-[11px] text-slate-400 space-y-0.5">
                  {i.setup.map((s: string) => <li key={s}>{s}</li>)}
                </ol>
              )}
              <a className="text-[11px] text-cyan-300/80 hover:text-cyan-200" href={i.docs_url} target="_blank" rel="noreferrer">Documentation ↗</a>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
