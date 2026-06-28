"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const TIER_ICONS: Record<string, string> = { free: "🌱", pro: "⚡", business: "🚀" };
const TIER_HIGHLIGHTS: Record<string, boolean> = { pro: true };

export default function BillingPage() {
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => { api.tiers().then(setTiers).catch(() => {}); }, []);

  async function upgrade(tier: string) {
    setMsg(""); setLoading(tier);
    try {
      const res = await api.checkout(tier);
      if (res.checkout_url) window.location.href = res.checkout_url;
      else setMsg(`✓ Plan ${tier} activado. Créditos añadidos.`);
    } catch (err: any) {
      setMsg(err.message);
    } finally { setLoading(null); }
  }

  return (
    <div className="px-4 lg:px-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center mb-14 reveal">
        <p className="text-xs tracking-[0.3em] uppercase text-white/40 mb-3">PRECIOS</p>
        <h1 className="font-display font-semibold text-4xl lg:text-5xl text-white tracking-tight mb-4">
          Elige tu{" "}
          <em className="font-serif" style={{fontFamily:"'Source Serif 4', serif", fontStyle:'italic', color:'rgba(255,255,255,0.7)'}}>
            plan ideal
          </em>
        </h1>
        <p className="text-white/45 text-base max-w-md mx-auto">
          Accede a todos los módulos de IA. Cancela cuando quieras.
        </p>
      </div>

      {msg && (
        <div className="liquid-glass rounded-2xl p-4 text-center text-white/80 text-sm mb-8 max-w-md mx-auto"
             style={{boxShadow:'inset 0 0 0 1px rgba(34,211,238,0.3)'}}>
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 reveal">
        {Object.entries(tiers).map(([name, t]) => {
          const highlight = TIER_HIGHLIGHTS[name];
          return (
            <div
              key={name}
              className={`relative flex flex-col ${
                highlight
                  ? "liquid-glass-strong rounded-[1.75rem] p-7 scale-105"
                  : "liquid-glass rounded-[1.5rem] p-7"
              }`}
            >
              {highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="pill bg-gradient-to-r from-violet-500/30 to-cyan-500/30 text-white text-[10px] px-4 py-1.5">
                    ✦ MÁS POPULAR
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="mb-6">
                <div className="text-3xl mb-3">{TIER_ICONS[name] || "🌟"}</div>
                <h3 className="font-display font-semibold text-xl text-white capitalize mb-1">{name}</h3>
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-semibold text-4xl text-white">${t.price_usd}</span>
                  <span className="text-white/40 text-sm">/mes</span>
                </div>
              </div>

              {/* Features */}
              <ul className="flex flex-col gap-3 mb-8 flex-1">
                <li className="flex items-center gap-2.5 text-sm text-white/65">
                  <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[10px]">✓</span>
                  {t.monthly_credits.toLocaleString()} créditos / mes
                </li>
                <li className="flex items-center gap-2.5 text-sm text-white/65">
                  <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[10px]">✓</span>
                  {t.rate_limit_per_min} solicitudes / min
                </li>
                <li className="flex items-center gap-2.5 text-sm text-white/65">
                  <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[10px]">✓</span>
                  {t.premium_models ? "Todos los modelos IA" : "Modelos base"}
                </li>
                <li className="flex items-center gap-2.5 text-sm text-white/65">
                  <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[10px]">✓</span>
                  Voz, chat, imágenes, código
                </li>
                {name !== "free" && (
                  <li className="flex items-center gap-2.5 text-sm text-white/65">
                    <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[10px]">✓</span>
                    Soporte prioritario
                  </li>
                )}
              </ul>

              {name !== "free" ? (
                <button
                  disabled={!!loading}
                  onClick={() => upgrade(name)}
                  className={highlight ? "btn w-full py-3 text-sm" : "btn-glass w-full py-3 text-sm"}
                >
                  {loading === name
                    ? <span className="dots"><span/><span/><span/></span>
                    : `Elegir ${name} →`}
                </button>
              ) : (
                <div className="py-3 text-center text-white/30 text-sm">Plan actual</div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-white/25 text-xs mt-10">
        Todos los precios en USD · Cancela cuando quieras · Sin tarifas ocultas
      </p>
    </div>
  );
}
