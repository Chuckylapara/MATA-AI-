"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken } from "@/lib/api";
import { gallery } from "@/services/storage";
import { memory } from "@/services/memory";

type Me = { email: string; full_name: string | null; role: string; tier: string; credits: number };
const TIER_LABEL: Record<string, string> = { free: "Free", pro: "Pro", business: "Business" };

const tools = [
  { href: "/avatar",           icon: "🎙", title: "Asistente en vivo", desc: "Habla por voz en tiempo real." },
  { href: "/chat",             icon: "💬", title: "Chat AI",            desc: "Conversación inteligente con memoria." },
  { href: "/studio?tab=image", icon: "🎨", title: "Imágenes",           desc: "Genera arte con IA." },
  { href: "/studio?tab=video", icon: "🎬", title: "Video",              desc: "Texto a video (beta)." },
  { href: "/studio?tab=code",  icon: "⚡", title: "Código",             desc: "Genera y corrige código." },
  { href: "/studio?tab=agent", icon: "🧠", title: "Agente",             desc: "Automatiza tareas." },
];

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [convoCount, setConvoCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [memCount, setMemCount] = useState(0);
  const [loggedIn, setLoggedIn] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoggedIn(false); return; }
    api.me().then(setMe).catch(() => setLoggedIn(false));
    api.tiers().then(setTiers).catch(() => {});
    api.listConversations().then((c: any[]) => setConvoCount(c.length)).catch(() => {});
    setImageCount(gallery.list().length);
    setMemCount(memory.list().length);
  }, []);

  if (!loggedIn) return (
    <div className="max-w-md mx-auto px-4 pt-8">
      <div className="liquid-glass-strong rounded-[1.75rem] p-10 text-center">
        <div className="text-4xl mb-4">🔐</div>
        <h1 className="font-display font-semibold text-2xl text-white mb-2">Tu Dashboard</h1>
        <p className="text-white/45 text-sm mb-8">Inicia sesión para ver tu uso, plan y estadísticas.</p>
        <Link href="/login" className="btn px-8 py-3 inline-block">Iniciar sesión</Link>
      </div>
    </div>
  );

  if (!me) return (
    <div className="flex items-center justify-center h-64">
      <div className="dots"><span/><span/><span/></div>
    </div>
  );

  const tierInfo = tiers[me.tier] || {};
  const monthly = tierInfo.monthly_credits || 100;
  const used = Math.max(0, monthly - me.credits);
  const pct = Math.min(100, Math.round((used / monthly) * 100));

  return (
    <div className="px-4 lg:px-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-10 reveal">
        <p className="text-white/40 text-sm tracking-wide mb-1">Bienvenido de vuelta,</p>
        <h1 className="font-display font-semibold text-4xl text-white tracking-tight">
          {me.full_name || me.email.split("@")[0]}
        </h1>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 reveal">
        {[
          { icon:"💬", label:"Conversaciones", val: convoCount, href:"/chat" },
          { icon:"🎨", label:"Imágenes",        val: imageCount,  href:"/gallery" },
          { icon:"🧠", label:"Memorias",        val: memCount },
          { icon:"💎", label:"Créditos",        val: me.credits.toLocaleString() },
        ].map(s => {
          const inner = (
            <div className="glass-neon rounded-2xl p-5 text-center h-full">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className="neon-text font-display font-semibold text-3xl">{s.val}</div>
              <div className="text-white/40 text-xs tracking-widest uppercase mt-1">{s.label}</div>
            </div>
          );
          return s.href
            ? <Link key={s.label} href={s.href}>{inner}</Link>
            : <div key={s.label}>{inner}</div>;
        })}
      </div>

      {/* Plan card + limit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8 reveal">
        <div className="liquid-glass-strong rounded-2xl p-7 lg:col-span-2">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-xs tracking-widest uppercase text-white/40 mb-1">Plan actual</p>
              <div className="flex items-center gap-3">
                <h2 className="font-display font-semibold text-2xl text-white">
                  {TIER_LABEL[me.tier] || me.tier}
                </h2>
                <span className={`pill ${me.tier !== "free" ? "text-emerald-300" : ""}`}>
                  {me.tier === "free" ? "Gratis" : "✓ Premium"}
                </span>
              </div>
            </div>
            {me.tier === "free" && (
              <Link href="/billing" className="btn text-sm px-5 py-2">🚀 Mejorar</Link>
            )}
          </div>

          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-white/45">Créditos usados</span>
              <span className="text-white font-medium">{used.toLocaleString()} / {monthly.toLocaleString()}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${pct}%`, background: "linear-gradient(90deg,#22d3ee,#a855f7,#ec4899)" }}
              />
            </div>
            <p className="text-white/35 text-xs mt-2">{me.credits.toLocaleString()} créditos disponibles</p>
          </div>
        </div>

        <div className="liquid-glass rounded-2xl p-6 flex flex-col justify-center gap-2.5">
          <p className="text-xs tracking-widest uppercase text-white/40 mb-1">Tu plan incluye</p>
          <p className="text-white/70 text-sm">⚡ {tierInfo.rate_limit_per_min || "—"} solicitudes/min</p>
          <p className="text-white/70 text-sm">🤖 {tierInfo.premium_models ? "Todos los modelos" : "Modelos base"}</p>
          <p className="text-white/70 text-sm">💎 {monthly.toLocaleString()} créditos/mes</p>
        </div>
      </div>

      {/* Tools */}
      <div className="reveal">
        <p className="text-xs tracking-[0.25em] uppercase text-white/40 mb-4">TUS HERRAMIENTAS</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((t, i) => (
            <Link key={t.title} href={t.href}
              className="card tilt reveal group block"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <div className="w-11 h-11 rounded-xl bg-white/[0.07] flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform">
                {t.icon}
              </div>
              <h3 className="font-display font-medium text-white text-sm mb-1">{t.title}</h3>
              <p className="text-white/40 text-xs">{t.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
