"use client";
import type { PendingAction } from "@/nexus/core/types";
import { Btn } from "@/nexus/ui/kit";

const LABELS: Record<string, string> = {
  email_send: "Send email", memory_forget: "Delete memory", shopping_purchase: "Purchase", social_publish: "Publish post",
};

export default function ConfirmDialog({ action, onConfirm, onReject, busy }: {
  action: PendingAction; onConfirm: () => void; onReject: () => void; busy: boolean;
}) {
  const p = (action.preview ?? {}) as Record<string, any>;
  const rows = Object.entries(p).filter(([k]) => k !== "type");
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="nx-confirm-title"
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="nx-panel w-full max-w-md border-amber-300/30">
        <div className="px-5 pt-5 pb-3 border-b border-amber-300/15">
          <p className="nx-mono text-[10px] tracking-[0.25em] uppercase text-amber-300">Confirmation required</p>
          <h2 id="nx-confirm-title" className="text-lg text-slate-100 mt-1">{LABELS[action.tool] ?? action.tool}</h2>
          <p className="text-xs text-slate-400 mt-1">{action.reason}</p>
        </div>
        <dl className="px-5 py-4 space-y-2 text-sm">
          {rows.length === 0 && <p className="text-slate-400 text-xs">No preview available.</p>}
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[88px_1fr] gap-2">
              <dt className="nx-mono text-[10px] uppercase tracking-wider text-slate-500 pt-0.5">{k}</dt>
              <dd className="text-slate-200 whitespace-pre-wrap break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <Btn onClick={onReject} disabled={busy}>Cancel</Btn>
          <Btn variant="gold" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : "Confirm"}</Btn>
        </div>
      </div>
    </div>
  );
}
