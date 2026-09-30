"use client";
import { useCallback, useEffect, useState } from "react";
import { nexus } from "@/nexus/core/api";
import { Badge, Btn, Empty, ErrorLine, Field, Panel, fmtTime, statusTone } from "@/nexus/ui/kit";

const MODES = ["allow", "ask", "deny", "temporary", "trusted"] as const;

export default function SecurityCenter({ onClose }: { onClose: () => void }) {
  const [perms, setPerms] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState({ tool: "", key: "", value: "", description: "" });

  const load = useCallback(async () => {
    try {
      const [p, r, a, t] = await Promise.all([nexus.permissions(), nexus.rules(), nexus.audit(), nexus.tools()]);
      setPerms(p); setRules(r); setAudit(a); setTools(t); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<any>) => { try { await fn(); await load(); } catch (e: any) { setError(e.message); } };

  const highRisk = tools.filter((t) => t.risk === "high" && t.name !== "shopping_purchase");

  return (
    <Panel title="Security & Permissions" onClose={onClose}
      subtitle="Central permission manager, trusted automation rules and the full audit trail of autonomous actions.">
      <ErrorLine error={error} />
      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Permissions</h3>
        <ul className="divide-y divide-cyan-300/5">
          {perms.map((p) => (
            <li key={p.capability} className="py-2 flex flex-wrap items-center gap-2">
              <div className="min-w-[160px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="nx-mono text-xs text-slate-100">{p.capability}</span>
                  <Badge tone={statusTone(p.effective)}>{p.effective}</Badge>
                  {p.expires_at && <span className="nx-mono text-[10px] text-slate-500">until {fmtTime(p.expires_at)}</span>}
                </div>
                <p className="text-[11px] text-slate-500">{p.description}</p>
              </div>
              <select aria-label={`${p.capability} mode`} className="nx-input w-auto text-xs" value={p.mode}
                onChange={(e) => act(() => nexus.setPermission(p.capability, e.target.value, e.target.value === "temporary" ? 60 : undefined))}>
                {MODES.map((m) => <option key={m} value={m}>{m}{m === "temporary" ? " (60 min)" : ""}</option>)}
              </select>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500 mt-2">Camera and microphone also require your browser's permission and are never activated silently.</p>
      </div>

      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Trusted automation rules</h3>
        <p className="text-[11px] text-slate-500 mb-2">A rule lets one high-risk tool run without asking when its arguments match. Rules never apply after NEXUS has read external content in the same turn, and purchases can never be trusted.</p>
        <form className="nx-card grid grid-cols-1 sm:grid-cols-2 gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!rule.tool) return;
          act(async () => {
            await nexus.addRule({ tool: rule.tool, constraints: rule.key ? { [rule.key]: rule.value } : {}, description: rule.description || null });
            setRule({ tool: "", key: "", value: "", description: "" });
          });
        }}>
          <Field label="Tool">
            <select className="nx-input" value={rule.tool} onChange={(e) => setRule({ ...rule, tool: e.target.value })}>
              <option value="">Select…</option>
              {highRisk.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Only when (field = value)">
            <div className="flex gap-1"><input className="nx-input" placeholder="to" value={rule.key} onChange={(e) => setRule({ ...rule, key: e.target.value })} />
              <input className="nx-input" placeholder="juan@example.com" value={rule.value} onChange={(e) => setRule({ ...rule, value: e.target.value })} /></div>
          </Field>
          <Btn type="submit" variant="gold" disabled={!rule.tool}>Add rule</Btn>
        </form>
        <ul className="mt-2 space-y-1.5">
          {!rules.length && <Empty>No trusted rules. Every high-risk action asks first.</Empty>}
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <Badge tone="gold">{r.tool}</Badge><span className="nx-mono text-slate-400">{JSON.stringify(r.constraints)}</span>
              <Btn small variant="danger" onClick={() => act(() => nexus.deleteRule(r.id))}>Revoke</Btn>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Audit log</h3>
        {!audit.length && <Empty>No audited actions yet.</Empty>}
        <ul className="space-y-1">
          {audit.slice(0, 80).map((a) => (
            <li key={a.id} className="nx-mono text-[11px] text-slate-400 flex flex-wrap gap-x-2">
              <span className="text-slate-500">{fmtTime(a.created_at)}</span>
              <span className="text-slate-300">{a.actor}</span>
              <span className="text-cyan-200">{a.action}</span>
              {a.risk && <span>risk:{a.risk}</span>}
              <span className={a.outcome === "ok" ? "text-emerald-300" : a.outcome === "pending" ? "text-amber-300" : "text-rose-300"}>{a.outcome}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="nx-card border-rose-400/20">
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-rose-300 mb-1">Delete all personal data</h3>
        <p className="text-[11px] text-slate-400 mb-2">Removes your NEXUS profile, memories, tasks, permissions, rules and feed. Security audit rows are retained.</p>
        <Btn variant="danger" onClick={() => { if (confirm("Delete ALL your NEXUS data permanently?")) act(() => nexus.deleteAllData()); }}>Delete everything</Btn>
      </div>
    </Panel>
  );
}
