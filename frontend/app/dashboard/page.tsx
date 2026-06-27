"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken } from "@/lib/api";
import { gallery } from "@/services/storage";
import { memory } from "@/services/memory";

type Me = { email: string; full_name: string | null; role: string; tier: string; credits: number };

const TIER_LABEL: Record<string, string> = { free: "Free", pro: "Pro", business: "Business" };

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [convoCount, setConvoCount] = useState(0);
  const [imageCount, setImageCount] = useState(0);
  const [memCount, setMemCount] = useState(0);
  const [loggedIn, setLoggedIn] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoggedIn(false);
      return;
    }
    api.me().then(setMe).catch(() => setLoggedIn(false));
    api.tiers().then(setTiers).catch(() => {});
    api.listConversations().then((c: any[]) => setConvoCount(c.length)).catch(() => {});
    setImageCount(gallery.list().length);
    setMemCount(memory.list().length);
  }, []);

  if (!loggedIn) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">Tu Dashboard</h1>
        <p className="mt-2 text-zinc-400">Inicia sesión para ver tu uso, plan y estadísticas.</p>
        <Link href="/login" className="btn mt-4 inline-block">Iniciar sesión</Link>
      </div>
    );
  }

  if (!me) return <p className="text-zinc-500">Cargando tu panel…</p>;

  const tierInfo = tiers[me.tier] || {};
  const monthly = tierInfo.monthly_credits || 100;
  const used = Math.max(0, monthly - me.credits);
  const pct = Math.min(100, Math.round((used / monthly) * 100));

  const stat = (icon: string, label: string, value: any, href?: string) => {
    const inner = (
      <div className="card reveal tilt h-full">
        <div className="text-2xl">{icon}</div>
        <div className="mt-2 text-3xl font-bold neon-text font-display">{value}</div>
        <div className="text-xs uppercase tracking-widest text-zinc-400">{label}</div>
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  };

  return (
    <div>
      <header className="mb-8 reveal">
        <p className="text-sm text-zinc-400">Bienvenido de nuevo,</p>
        <h1 className="font-display text-3xl font-bold">{me.full_name || me.email}</h1>
      </header>

      {/* Plan + credits */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card reveal lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-400">Plan actual</p>
              <p className="font-display text-2xl font-bold">
                {TIER_LABEL[me.tier] || me.tier}{" "}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${me.tier === "free" ? "bg-zinc-700" : "bg-emerald-500/30 text-emerald-300"}`}>
                  {me.tier === "free" ? "Gratis" : "Premium"}
                </span>
              </p>
            </div>
            {me.tier === "free" && <Link href="/billing" className="btn text-sm">🚀 Mejorar a Pro</Link>}
          </div>

          <div className="mt-5">
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-zinc-400">Créditos usados este ciclo</span>
              <span className="font-semibold">{used.toLocaleString()} / {monthly.toLocaleString()}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: "linear-gradient(90deg,#22d3ee,#a855f7,#ec4899)" }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500">{me.credits.toLocaleString()} créditos disponibles</p>
          </div>
        </div>

        <div className="card reveal flex flex-col justify-center">
          <p className="text-xs uppercase tracking-widest text-zinc-400">Límite de tu plan</p>
          <p className="mt-1 text-sm text-zinc-300">⚡ {tierInfo.rate_limit_per_min || "—"} solicitudes/min</p>
          <p className="text-sm text-zinc-300">🤖 {tierInfo.premium_models ? "Todos los modelos" : "Modelos base"}</p>
          <p className="text-sm text-zinc-300">💎 {monthly.toLocaleString()} créditos/mes</p>
        </div>
      </section>

      {/* Usage stats */}
      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stat("💬", "Conversaciones", convoCount, "/chat")}
        {stat("🎨", "Imágenes", imageCount, "/gallery")}
        {stat("🧠", "Memorias", memCount, "/chat")}
        {stat("💎", "Créditos", me.credits.toLocaleString())}
      </section>

      {/* Product launcher */}
      <section className="reveal">
        <h2 className="font-display mb-4 text-lg font-bold tracking-widest text-zinc-200">TUS HERRAMIENTAS</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/avatar", icon: "🤖", title: "Asistente en vivo", desc: "Habla por voz en tiempo real." },
            { href: "/chat", icon: "💬", title: "Chat AI", desc: "Conversación inteligente con memoria." },
            { href: "/studio?tab=image", icon: "🎨", title: "Imágenes", desc: "Genera arte con IA." },
            { href: "/studio?tab=video", icon: "🎬", title: "Video", desc: "Texto a video (beta)." },
            { href: "/studio?tab=code", icon: "⚡", title: "Código", desc: "Genera y corrige código." },
            { href: "/studio?tab=agent", icon: "🧠", title: "Agente", desc: "Automatiza tareas." },
          ].map((t) => (
            <Link key={t.title} href={t.href} className="card tilt reveal block">
              <div className="text-2xl">{t.icon}</div>
              <h3 className="font-display mt-2 font-bold">{t.title}</h3>
              <p className="text-sm text-zinc-400">{t.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
