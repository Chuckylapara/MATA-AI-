import "./globals.css";
import type { Metadata } from "next";
import { Orbitron, Rajdhani } from "next/font/google";
import Link from "next/link";
import Background from "@/components/Background";
import WelcomeVoice from "@/components/WelcomeVoice";
import ScrollReveal from "@/components/ScrollReveal";

const display = Orbitron({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-display" });
const body = Rajdhani({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "MATA AI · Plataforma de Inteligencia Artificial",
  description: "Chat, voz, imágenes, video, música, código y agentes — todo en una sola plataforma futurista.",
};

const links = [
  { href: "/", label: "Inicio" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/avatar", label: "En vivo" },
  { href: "/chat", label: "Chat" },
  { href: "/studio", label: "Studio" },
  { href: "/gallery", label: "Galería" },
  { href: "/billing", label: "Planes" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body>
        <Background />
        <WelcomeVoice />
        <ScrollReveal />
        <nav className="sticky top-0 z-50 flex items-center gap-5 border-b border-white/10 bg-black/30 px-6 py-3 backdrop-blur-xl">
          <Link href="/" className="font-display text-xl font-extrabold neon-text">
            MATA&nbsp;AI
          </Link>
          <div className="ml-auto flex items-center gap-5">
            {links.slice(1).map((l) => (
              <Link key={l.href} href={l.href} className="nav-link">
                {l.label}
              </Link>
            ))}
            <Link href="/login" className="btn !px-4 !py-1.5 text-sm">
              Cuenta
            </Link>
          </div>
        </nav>
        <main className="relative z-10 mx-auto max-w-6xl p-6">{children}</main>
        <footer className="relative z-10 mt-16 border-t border-white/10 py-6 text-center text-xs text-zinc-500">
          MATA AI © 2026 · Plataforma modular de inteligencia artificial
        </footer>
      </body>
    </html>
  );
}
