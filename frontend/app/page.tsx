import Link from "next/link";

const modules = [
  { href: "/avatar", icon: "🤖", title: "Asistente en vivo", desc: "Habla por voz con Mata en tiempo real, como una persona." },
  { href: "/chat", icon: "💬", title: "Chat Inteligente", desc: "Conversación natural en streaming con IA real." },
  { href: "/studio?tab=image", icon: "🎨", title: "Generador de Imágenes", desc: "Crea fotos con IA a partir de texto." },
  { href: "/studio?tab=video", icon: "🎬", title: "Generador de Video", desc: "Texto a video con arquitectura de jobs async." },
  { href: "/studio?tab=music", icon: "🎵", title: "Generador de Música", desc: "Composición musical desde una descripción." },
  { href: "/studio?tab=code", icon: "⚡", title: "Generador de Código", desc: "Genera, explica, revisa y corrige código." },
  { href: "/studio?tab=agent", icon: "🧠", title: "Agente Autónomo", desc: "Automatiza tareas usando herramientas y APIs." },
  { href: "/billing", icon: "🚀", title: "Planes", desc: "Freemium y premium con motor de créditos." },
];

export default function Home() {
  return (
    <div>
      {/* HERO */}
      <section className="flex flex-col items-center py-16 text-center">
        <span className="mb-6 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-xs font-semibold tracking-widest text-cyan-300">
          ◆ PLATAFORMA DE INTELIGENCIA ARTIFICIAL ◆
        </span>
        <div className="logo3d-wrap">
          <h1 className="logo3d">MATA AI</h1>
        </div>
        <p className="font-display mt-6 max-w-2xl text-lg text-zinc-300">
          El futuro de la IA, todo en un solo lugar:{" "}
          <span className="neon-text font-bold">voz, chat, imágenes, video, música, código y agentes.</span>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/avatar" className="btn text-base">🎤 Hablar con Mata</Link>
          <Link href="/studio" className="btn text-base" style={{ background: "linear-gradient(110deg,#ec4899,#a855f7)" }}>
            ✨ Crear ahora
          </Link>
        </div>
      </section>

      {/* MODULES */}
      <section className="py-8" style={{ perspective: "1200px" }}>
        <h2 className="font-display mb-8 text-center text-2xl font-bold tracking-widest text-zinc-200">
          MÓDULOS
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m, i) => (
            <Link
              key={m.href + m.title}
              href={m.href}
              className="card tilt reveal block"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <div className="mb-3 text-3xl">{m.icon}</div>
              <h3 className="font-display text-lg font-bold text-white">{m.title}</h3>
              <p className="mt-1 text-sm text-zinc-400">{m.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* STATS */}
      <section className="reveal mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["8", "Módulos de IA"],
          ["∞", "Conversaciones"],
          ["100%", "API-first"],
          ["3D", "Experiencia"],
        ].map(([n, l]) => (
          <div key={l} className="glass p-5 text-center">
            <div className="neon-text font-display text-3xl font-extrabold">{n}</div>
            <div className="mt-1 text-xs uppercase tracking-widest text-zinc-400">{l}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
