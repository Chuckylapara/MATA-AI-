"use client";
import Link from "next/link";

const modules = [
  { href: "/avatar",          icon: "🎙", label: "Asistente en vivo",      desc: "Habla por voz con Mata en tiempo real." },
  { href: "/chat",            icon: "💬", label: "Chat Inteligente",        desc: "Conversación natural en streaming con IA." },
  { href: "/studio?tab=image",icon: "🎨", label: "Generador de Imágenes",   desc: "Crea fotos con IA a partir de texto." },
  { href: "/studio?tab=video",icon: "🎬", label: "Generador de Video",      desc: "Texto a video con arquitectura async." },
  { href: "/studio?tab=music",icon: "🎵", label: "Generador de Música",     desc: "Composición musical desde una descripción." },
  { href: "/studio?tab=code", icon: "⚡", label: "Generador de Código",     desc: "Genera, explica y corrige código." },
  { href: "/studio?tab=agent",icon: "🧠", label: "Agente Autónomo",         desc: "Automatiza tareas usando herramientas." },
  { href: "/billing",         icon: "🚀", label: "Planes",                  desc: "Freemium y premium con motor de créditos." },
];

const stats = [
  { num: "3 min", label: "De idea a video" },
  { num: "8+",    label: "Herramientas IA" },
  { num: "$0",    label: "Para empezar" },
  { num: "24/7",  label: "Producción auto" },
];

const pills = ["Sin cámara", "Sin editar", "Sin mostrar rostro", "100% IA"];

export default function Home() {
  return (
    <div className="min-h-screen">

      {/* ── HERO ──────────────────────────────────────────── */}
      <section className="relative flex flex-col lg:flex-row min-h-[calc(100vh-96px)] px-4 lg:px-8 gap-6 pb-8">

        {/* Ambient orbs */}
        <div className="orb w-[600px] h-[600px] bg-purple-600/20 -top-40 -left-20 pointer-events-none" style={{position:'absolute'}} />
        <div className="orb w-[400px] h-[400px] bg-cyan-500/15 top-20 right-10 pointer-events-none" style={{position:'absolute', animationDelay:'4s'}} />
        <div className="orb w-[300px] h-[300px] bg-pink-500/10 bottom-20 left-1/3 pointer-events-none" style={{position:'absolute', animationDelay:'8s'}} />

        {/* ─ Left Panel ─ */}
        <div className="relative flex-1 flex flex-col min-h-[70vh] lg:min-h-0">
          {/* Glass overlay */}
          <div className="liquid-glass-strong absolute inset-0 rounded-[2rem]" />

          <div className="relative z-10 flex flex-col h-full p-8 lg:p-10">

            {/* Top badge */}
            <div className="flex items-center justify-between">
              <span className="pill">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                CREA · PUBLICA · MONETIZA
              </span>
              <span className="pill">Empieza gratis</span>
            </div>

            {/* Hero center */}
            <div className="flex-1 flex flex-col items-start justify-center mt-10">
              {/* Logo mark */}
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 via-purple-700 to-cyan-600 flex items-center justify-center mb-8 shadow-2xl shadow-violet-500/40">
                <span className="text-white font-bold text-3xl" style={{fontFamily:'Poppins'}}>M</span>
              </div>

              {/* Headline */}
              <h1 className="font-display font-semibold text-5xl lg:text-6xl xl:text-7xl leading-[1.1] tracking-[-0.04em] text-white mb-6">
                Crea contenido que<br />
                <em className="font-serif not-italic" style={{color:'rgba(255,255,255,0.7)', fontFamily:"'Source Serif 4', Georgia, serif", fontStyle:'italic'}}>
                  se vuelve viral
                </em>{" "}
                con IA
              </h1>

              <p className="text-white/60 text-base lg:text-lg font-light leading-relaxed max-w-md mb-10">
                Convierte una idea en un video completo&nbsp;— guion, imágenes,
                voz y música&nbsp;— en minutos. Publica, crece y monetiza sin
                equipo ni cámara.
              </p>

              {/* CTA */}
              <div className="flex flex-wrap gap-4 mb-10">
                <Link href="/studio" className="btn text-sm px-7 py-3">
                  <span>✨</span> Crear mi primer video gratis
                </Link>
                <Link href="/billing" className="btn-glass text-sm px-7 py-3">
                  Ver planes
                </Link>
              </div>

              {/* Capability pills */}
              <div className="flex flex-wrap gap-2">
                {pills.map(p => (
                  <span key={p} className="pill">{p}</span>
                ))}
              </div>
            </div>

            {/* Bottom quote */}
            <div className="mt-10 pt-8 border-t border-white/[0.07]">
              <p className="text-[10px] tracking-[0.25em] uppercase text-white/40 mb-2">VISIÓN MATA AI</p>
              <p className="text-white/70 text-sm leading-relaxed">
                "Imaginamos un mundo donde{" "}
                <em className="font-serif text-white/90" style={{fontFamily:"'Source Serif 4', serif", fontStyle:'italic'}}>
                  la IA habla, crea y actúa
                </em>{" "}
                como tú lo necesitas."
              </p>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[10px] tracking-[0.2em] uppercase text-white/35">MATA AI TEAM</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            </div>
          </div>
        </div>

        {/* ─ Right Panel (desktop only) ─ */}
        <div className="hidden lg:flex flex-col w-[44%] gap-4">

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4">
            {stats.map(s => (
              <div key={s.label} className="liquid-glass-strong rounded-2xl p-5 text-center reveal">
                <div className="neon-text font-display font-semibold text-3xl mb-1">{s.num}</div>
                <div className="text-white/45 text-xs tracking-widest uppercase">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Feature cards */}
          <div className="liquid-glass-strong rounded-[2rem] p-5 flex flex-col gap-4 flex-1 reveal">
            <p className="text-xs tracking-widest uppercase text-white/40 px-1">CAPACIDADES</p>

            <div className="grid grid-cols-2 gap-3 flex-1">
              {[
                { icon:"🎙", name:"Voz Neural",    desc:"Lip sync en tiempo real con IA" },
                { icon:"🧠", name:"Agentes",       desc:"Automatización autónoma de tareas" },
                { icon:"🎨", name:"Creación",      desc:"Imágenes, video y música con IA" },
                { icon:"💬", name:"Chat Pro",      desc:"Streaming con memoria contextual" },
              ].map(c => (
                <div key={c.name} className="glass-neon rounded-2xl p-4 flex flex-col gap-2">
                  <div className="text-2xl">{c.icon}</div>
                  <div className="text-white font-medium text-sm">{c.name}</div>
                  <div className="text-white/45 text-xs leading-relaxed">{c.desc}</div>
                </div>
              ))}
            </div>

            {/* Bottom CTA card */}
            <div className="liquid-glass rounded-2xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center text-2xl shrink-0">
                🚀
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium text-sm">Empieza gratis</div>
                <div className="text-white/45 text-xs mt-0.5">Sin tarjeta de crédito requerida</div>
              </div>
              <Link href="/billing" className="btn-glass text-xs px-4 py-2 shrink-0">Ver planes</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── MÓDULOS ────────────────────────────────────────── */}
      <section className="px-4 lg:px-8 py-16">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-xs tracking-[0.25em] uppercase text-white/40 mb-2">PLATAFORMA COMPLETA</p>
            <h2 className="font-display font-semibold text-3xl lg:text-4xl text-white tracking-tight">
              Todos los módulos
            </h2>
          </div>
          <Link href="/studio" className="pill hidden md:inline-flex">Ver todos →</Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {modules.map((m, i) => (
            <Link
              key={m.href + m.label}
              href={m.href}
              className="card tilt reveal block group"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              {/* Icon */}
              <div className="w-12 h-12 rounded-xl bg-white/[0.07] flex items-center justify-center text-2xl mb-4
                              group-hover:scale-110 transition-transform duration-300">
                {m.icon}
              </div>
              <h3 className="font-display font-medium text-white text-base mb-1.5">{m.label}</h3>
              <p className="text-white/45 text-xs leading-relaxed">{m.desc}</p>

              {/* Arrow */}
              <div className="mt-4 text-white/25 group-hover:text-cyan-400 transition-colors text-xs tracking-wider">
                Abrir →
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── BOTTOM CTA ─────────────────────────────────────── */}
      <section className="px-4 lg:px-8 py-8">
        <div className="liquid-glass-strong rounded-[2rem] p-10 lg:p-16 text-center relative overflow-hidden">
          {/* bg glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 via-transparent to-cyan-600/10 pointer-events-none" />

          <p className="text-xs tracking-[0.3em] uppercase text-white/40 mb-4 relative z-10">EMPIEZA HOY</p>
          <h2 className="font-display font-semibold text-4xl lg:text-5xl text-white tracking-tight mb-4 relative z-10">
            Tu primer video,{" "}
            <em className="font-serif" style={{fontFamily:"'Source Serif 4', serif", fontStyle:'italic', color:'rgba(255,255,255,0.75)'}}>
              gratis hoy
            </em>
          </h2>
          <p className="text-white/50 text-base max-w-md mx-auto mb-10 relative z-10">
            Crea contenido listo para publicar en minutos. Sin tarjeta de crédito.
            Sube de plan solo cuando ya estés generando.
          </p>
          <div className="flex flex-wrap justify-center gap-4 relative z-10">
            <Link href="/login" className="btn px-10 py-3.5 text-base">Comenzar gratis</Link>
            <Link href="/dashboard" className="btn-glass px-8 py-3.5 text-base">Ver dashboard</Link>
          </div>
        </div>
      </section>

    </div>
  );
}
