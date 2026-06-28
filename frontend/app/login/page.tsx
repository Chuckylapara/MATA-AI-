"use client";
import { useEffect, useState } from "react";
import { api, getToken, logout } from "@/lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getToken()) api.me().then(setMe).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (mode === "login") await api.login({ email, password });
      else await api.register({ email, password });
      setMe(await api.me());
    } catch (err: any) {
      setError(err.message || "Error inesperado");
    } finally { setLoading(false); }
  }

  if (me) return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm relative z-10">
        <div className="liquid-glass-strong rounded-[1.75rem] p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center mx-auto mb-5 text-2xl">
            👤
          </div>
          <h2 className="font-display font-semibold text-xl text-white mb-1">Sesión activa</h2>
          <p className="text-white/50 text-sm mb-1">{me.email}</p>
          <div className="flex justify-center gap-3 mt-2 mb-6">
            <span className="pill">{me.role}</span>
            <span className="pill">{me.tier}</span>
            <span className="pill">💎 {me.credits}</span>
          </div>
          <button className="btn w-full py-3" onClick={() => { logout(); setMe(null); }}>
            Cerrar sesión
          </button>
        </div>
        <p className="text-center text-white/25 text-xs mt-4">Admin: admin@mata.ai / admin12345</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="orb w-96 h-96 bg-violet-600/20 pointer-events-none" style={{position:'fixed', top:'-5rem', left:'30%'}} />
      <div className="orb w-64 h-64 bg-cyan-500/15 pointer-events-none" style={{position:'fixed', bottom:'5rem', right:'20%', animationDelay:'5s'}} />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 via-purple-700 to-cyan-600 flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-violet-500/40">
            <span className="text-white font-bold text-2xl" style={{fontFamily:'Poppins'}}>M</span>
          </div>
          <h1 className="font-display font-semibold text-3xl text-white tracking-tight">
            {mode === "login" ? "Bienvenido de vuelta" : "Crear cuenta"}
          </h1>
          <p className="text-white/40 text-sm mt-2">
            {mode === "login" ? "Accede a tu plataforma de IA" : "Empieza gratis, sin tarjeta de crédito"}
          </p>
        </div>

        <div className="liquid-glass-strong rounded-[1.75rem] p-8">
          {/* Tabs */}
          <div className="liquid-glass rounded-full p-1 flex mb-7">
            {(["login","register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                  mode === m ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {m === "login" ? "Iniciar sesión" : "Registrarse"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-white/45 mb-1.5 block tracking-wide uppercase">Email</label>
              <input className="input" type="email" placeholder="tu@email.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs text-white/45 mb-1.5 block tracking-wide uppercase">Contraseña</label>
              <input className="input" type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>

            {error && (
              <div className="liquid-glass rounded-xl p-3 text-red-300 text-sm text-center"
                   style={{boxShadow:'inset 0 0 0 1px rgba(248,113,113,0.3)'}}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn w-full py-3.5 mt-1 text-sm">
              {loading
                ? <span className="dots"><span/><span/><span/></span>
                : mode === "login" ? "Entrar →" : "Crear cuenta →"}
            </button>
          </form>

          <p className="text-center text-white/25 text-xs mt-6">
            Al continuar aceptas los Términos de servicio de MATA AI
          </p>
        </div>

        <p className="text-center text-white/20 text-xs mt-4">Admin demo: admin@mata.ai / admin12345</p>
      </div>
    </div>
  );
}
