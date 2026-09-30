"use client";
import type { ReactNode } from "react";

export function Panel({ title, subtitle, children, actions, onClose }: {
  title: string; subtitle?: string; children: ReactNode; actions?: ReactNode; onClose?: () => void;
}) {
  return (
    <section className="nx-panel flex flex-col max-h-full min-h-0">
      <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-cyan-300/10">
        <div className="min-w-0">
          <h2 className="nx-mono text-[11px] tracking-[0.25em] text-cyan-300/90 uppercase">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {actions}
          {onClose && (
            <button onClick={onClose} aria-label="Close panel" className="nx-icon-btn">✕</button>
          )}
        </div>
      </header>
      <div className="overflow-y-auto min-h-0 px-5 py-4 space-y-4">{children}</div>
    </section>
  );
}

export function Btn({ children, onClick, variant = "ghost", disabled, title, type = "button", small }: {
  children: ReactNode; onClick?: () => void; variant?: "ghost" | "primary" | "danger" | "gold";
  disabled?: boolean; title?: string; type?: "button" | "submit"; small?: boolean;
}) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`nx-btn nx-btn-${variant} ${small ? "text-[11px] px-2.5 py-1" : "text-xs px-3.5 py-1.5"}`}>
      {children}
    </button>
  );
}

const TONE: Record<string, string> = {
  ok: "text-emerald-300 border-emerald-300/30 bg-emerald-400/10",
  warn: "text-amber-300 border-amber-300/30 bg-amber-400/10",
  err: "text-rose-300 border-rose-300/30 bg-rose-400/10",
  info: "text-cyan-300 border-cyan-300/30 bg-cyan-400/10",
  mute: "text-slate-400 border-slate-400/20 bg-slate-400/5",
  gold: "text-orange-300 border-orange-300/30 bg-orange-400/10",
};

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: keyof typeof TONE | string }) {
  return <span className={`nx-mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-wider uppercase ${TONE[tone] ?? TONE.info}`}>{children}</span>;
}

export function statusTone(s: string) {
  const u = (s || "").toUpperCase();
  if (["READY", "CONFIGURED", "OK", "ALLOW", "SUCCEEDED", "ACTIVE", "EXECUTED"].includes(u)) return "ok";
  if (["WARNING", "ASK", "TEMPORARY", "PENDING", "PAUSED", "PLANNED"].includes(u)) return "warn";
  if (["ERROR", "DENY", "FAILED", "DENIED", "REJECTED"].includes(u)) return "err";
  if (["NOT CONFIGURED", "NOT_CONFIGURED", "COMPLETED"].includes(u)) return "mute";
  if (u === "TRUSTED") return "gold";
  return "info";
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="nx-mono block text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500 italic">{children}</p>;
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</p>;
}

export function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function clock(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
