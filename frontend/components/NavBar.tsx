"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/create",    label: "Crear video" },
  { href: "/clips",     label: "Clips" },
  { href: "/tools",     label: "Herramientas" },
  { href: "/avatar",    label: "En vivo" },
  { href: "/chat",      label: "Chat" },
  { href: "/studio",    label: "Studio" },
  { href: "/gallery",   label: "Galería" },
  { href: "/billing",   label: "Planes" },
];

export default function NavBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 px-3 sm:px-4 lg:px-6 py-2.5 sm:py-3">
        <div className="liquid-glass-strong rounded-[1.25rem] sm:rounded-[1.4rem] flex items-center gap-3 px-4 sm:px-5 py-2 sm:py-2.5 max-w-7xl mx-auto">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0" onClick={() => setOpen(false)}>
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-gradient-to-br from-violet-500 via-purple-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <span className="text-white font-bold text-xs" style={{fontFamily:"'Poppins',sans-serif"}}>M</span>
            </div>
            <span className="font-semibold text-base sm:text-[17px] tracking-tight text-white" style={{fontFamily:"'Poppins',sans-serif"}}>
              MATA{" "}
              <span style={{background:"linear-gradient(90deg,#67e8f9,#22d3ee)", WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent"}}>
                AI
              </span>
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden lg:flex items-center gap-0.5 ml-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-link px-3 py-1.5 rounded-full transition-all duration-200 text-sm ${
                  path?.startsWith(l.href) ? "bg-white/10 !text-white" : "hover:bg-white/5"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn-glass text-xs px-3 sm:px-4 py-1.5 rounded-full hidden sm:inline-flex">
              Cuenta
            </Link>
            <Link href="/avatar" className="btn text-xs px-3 sm:px-4 py-1.5 hidden sm:inline-flex">
              🎤 Hablar
            </Link>

            {/* Hamburger */}
            <button
              onClick={() => setOpen(!open)}
              className="lg:hidden w-8 h-8 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all"
              style={{background: open ? "rgba(255,255,255,0.1)" : "transparent"}}
              aria-label="Menú"
            >
              <span className={`block w-5 h-0.5 bg-white/80 rounded-full transition-all duration-300 ${open ? "rotate-45 translate-y-2" : ""}`} />
              <span className={`block w-5 h-0.5 bg-white/80 rounded-full transition-all duration-300 ${open ? "opacity-0" : ""}`} />
              <span className={`block w-5 h-0.5 bg-white/80 rounded-full transition-all duration-300 ${open ? "-rotate-45 -translate-y-2" : ""}`} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute top-16 left-3 right-3 liquid-glass-strong rounded-2xl p-4 flex flex-col gap-1"
            onClick={e => e.stopPropagation()}
          >
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`nav-link px-4 py-3 rounded-xl text-sm transition-all ${
                  path?.startsWith(l.href) ? "bg-white/10 !text-white" : "hover:bg-white/5"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="border-t border-white/10 my-2" />
            <Link href="/login" onClick={() => setOpen(false)} className="btn-glass text-sm py-2.5 text-center rounded-xl">
              Cuenta
            </Link>
            <Link href="/avatar" onClick={() => setOpen(false)} className="btn text-sm py-2.5 text-center">
              🎤 Hablar con Mata
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
