import "./globals.css";
import type { Metadata, Viewport } from "next";
import NavBar from "@/components/NavBar";
import Background from "@/components/Background";
import WelcomeVoice from "@/components/WelcomeVoice";
import ScrollReveal from "@/components/ScrollReveal";
import PWARegister from "@/components/PWARegister";

export const metadata: Metadata = {
  title: "MATA AI · Plataforma de Inteligencia Artificial",
  description: "Chat, voz, imágenes, video, música, código y agentes — todo en una sola plataforma.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MATA AI" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* Monetag site verification */}
        <meta name="monetag" content="888a781f19beb9e50100493eb93dd36d" />
        {/* Monetag rewarded SDK — expone window.show_11216716() */}
        <script src="https://5gvci.com/act/files/tag.min.js?z=11216716" data-cfasync="false" async />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Source+Serif+4:ital,wght@0,300;0,400;1,300;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PWARegister />
        <Background />
        <WelcomeVoice />
        <ScrollReveal />
        <NavBar />
        <main className="relative z-10 pt-20 sm:pt-22 pb-16 min-h-screen">{children}</main>
        <footer className="relative z-10 border-t border-white/[0.06] py-8 text-center space-y-3">
          <span className="block text-xs text-white/25 tracking-widest uppercase">
            MATA AI © 2026 &nbsp;·&nbsp; Plataforma modular de inteligencia artificial
          </span>
          <nav className="flex items-center justify-center gap-4 text-xs text-white/40">
            <a href="/terms" className="hover:text-white/70 transition-colors">Términos</a>
            <span className="text-white/15">·</span>
            <a href="/privacy" className="hover:text-white/70 transition-colors">Privacidad</a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
