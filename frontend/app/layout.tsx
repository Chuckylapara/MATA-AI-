import "./globals.css";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import Background from "@/components/Background";
import WelcomeVoice from "@/components/WelcomeVoice";
import ScrollReveal from "@/components/ScrollReveal";

export const metadata: Metadata = {
  title: "MATA AI · Plataforma de Inteligencia Artificial",
  description: "Chat, voz, imágenes, video, música, código y agentes — todo en una sola plataforma.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Source+Serif+4:ital,wght@0,300;0,400;1,300;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Background />
        <WelcomeVoice />
        <ScrollReveal />
        <NavBar />
        <main className="relative z-10 pt-20 sm:pt-22 pb-16 min-h-screen">{children}</main>
        <footer className="relative z-10 border-t border-white/[0.06] py-8 text-center">
          <span className="text-xs text-white/25 tracking-widest uppercase">
            MATA AI © 2026 &nbsp;·&nbsp; Plataforma modular de inteligencia artificial
          </span>
        </footer>
      </body>
    </html>
  );
}
