"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken } from "@/lib/api";

const TIER_ICONS: Record<string, string> = { free: "🌱", pro: "⚡", business: "🚀" };
const TIER_HIGHLIGHTS: Record<string, boolean> = { pro: true };
const PACK_ICONS: Record<string, string> = { small: "🔹", medium: "🔷", large: "💎" };

export default function BillingPage() {
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [packs, setPacks] = useState<Record<string, any>>({});
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    api.tiers().then(setTiers).catch(() => {});
    api.creditPacks().then((d: any) => { setPacks(d.packs || {}); setPaypalEnabled(!!d.paypal_enabled); }).catch(() => {});
    handlePayPalReturn();
  }, []);

  function cleanUrl() { window.history.replaceState({}, "", "/billing"); }

  function handlePayPalReturn() {
    const p = new URLSearchParams(window.location.search);
    const status = p.get("status");
    if (status === "cancel") { setMsg("Pago cancelado. No se te cobró nada."); cleanUrl(); return; }
    if (status !== "success") return;
    const kind = p.get("kind");
    if (kind === "pack") {
      const orderId = p.get("token");
      if (!orderId) return;
      setMsg("Confirmando tu pago…");
      api.paypalCapture(orderId)
        .then((r: any) => setMsg(`✓ ¡Pago confirmado! Se añadieron ${(r.credits_added || 0).toLocaleString()} créditos a tu cuenta.`))
        .catch((e: any) => setMsg(`⚠️ ${e.message}`))
        .finally(cleanUrl);
    } else if (kind === "sub") {
      const subId = p.get("subscription_id");
      if (!subId) return;
      setMsg("Activando tu suscripción…");
      api.paypalSyncSubscription(subId)
        .then((r: any) => setMsg(`✓ ¡Suscripción ${r.tier} activada! Ya tienes tus créditos.`))
        .catch((e: any) => setMsg(`⚠️ ${e.message}`))
        .finally(cleanUrl);
    }
  }

  async function choosePlan(tier: string) {
    if (!getToken()) { window.location.href = "/login"; return; }
    setMsg(""); setLoading(tier);
    try {
      if (paypalEnabled) {
        const res = await api.paypalSubscribe(tier);
        if (res.approval_url) { window.location.href = res.approval_url; return; }
      } else {
        const res = await api.checkout(tier);
        if (res.checkout_url) { window.location.href = res.checkout_url; return; }
        setMsg(`✓ Plan ${tier} activado. Créditos añadidos.`);
      }
    } catch (err: any) {
      setMsg(err.message);
    } finally { setLoading(null); }
  }

  async function buyPack(pack: string) {
    if (!getToken()) { window.location.href = "/login"; return; }
    setMsg(""); setLoading(`pack-${pack}`);
    try {
      const res = await api.paypalOrder(pack);
      if (res.approval_url) { window.location.href = res.approval_url; return; }
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
          Invierte menos de lo que{" "}
          <em className="font-serif" style={{fontFamily:"'Source Serif 4', serif", fontStyle:'italic', color:'rgba(255,255,255,0.7)'}}>
            ganas
          </em>
        </h1>
        <p className="text-white/45 text-base max-w-md mx-auto">
          Un solo video editado por un freelancer cuesta más que un mes entero
          de Mata AI. Empieza gratis y sube de plan cuando ya estés produciendo.
        </p>
      </div>

      {msg && (
        <div className="liquid-glass rounded-2xl p-4 text-center text-white/80 text-sm mb-8 max-w-md mx-auto"
             style={{boxShadow:'inset 0 0 0 1px rgba(34,211,238,0.3)'}}>
          {msg}
        </div>
      )}

      <EarnCredits />

      {/* Subscription tiers */}
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
                  Video, voz, imágenes y música con IA
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
                  onClick={() => choosePlan(name)}
                  className={highlight ? "btn w-full py-3 text-sm" : "btn-glass w-full py-3 text-sm"}
                >
                  {loading === name
                    ? <span className="dots"><span/><span/><span/></span>
                    : paypalEnabled ? "Suscribirme con PayPal" : `Elegir ${name} →`}
                </button>
              ) : (
                <div className="py-3 text-center text-white/30 text-sm">Plan actual</div>
              )}
            </div>
          );
        })}
      </div>

      {/* One-time credit packs */}
      {Object.keys(packs).length > 0 && (
        <div className="mt-16 reveal">
          <div className="text-center mb-8">
            <p className="text-xs tracking-[0.3em] uppercase text-white/40 mb-2">SIN SUSCRIPCIÓN</p>
            <h2 className="font-display font-semibold text-2xl lg:text-3xl text-white tracking-tight">
              ¿Prefieres pagar una sola vez?
            </h2>
            <p className="text-white/45 text-sm max-w-md mx-auto mt-2">
              Compra créditos sueltos sin compromiso mensual. Nunca caducan.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {Object.entries(packs).map(([key, p]) => (
              <div key={key} className="liquid-glass rounded-[1.5rem] p-7 flex flex-col text-center">
                <div className="text-3xl mb-3">{PACK_ICONS[key] || "✨"}</div>
                <h3 className="font-display font-semibold text-lg text-white mb-1">{p.label}</h3>
                <div className="flex items-baseline justify-center gap-1 mb-1">
                  <span className="font-display font-semibold text-4xl text-white">${p.price_usd}</span>
                </div>
                <p className="neon-text font-display font-semibold text-lg mb-6">
                  {p.credits.toLocaleString()} créditos
                </p>
                <button
                  disabled={!!loading}
                  onClick={() => buyPack(key)}
                  className="btn-glass w-full py-3 text-sm mt-auto"
                >
                  {loading === `pack-${key}`
                    ? <span className="dots"><span/><span/><span/></span>
                    : "Comprar con PayPal"}
                </button>
              </div>
            ))}
          </div>
          {!paypalEnabled && (
            <p className="text-center text-amber-300/70 text-xs mt-6">
              ⚙️ Conecta tu cuenta PayPal en el backend para activar los pagos.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-white/30 text-xs mt-12">
        <span>✓ Cancela cuando quieras</span>
        <span>✓ Sin tarifas ocultas</span>
        <span>✓ Empieza gratis, sin tarjeta</span>
        <span>✓ Pago seguro con PayPal</span>
      </div>

      {!getToken() && (
        <p className="text-center text-white/35 text-xs mt-6">
          <Link href="/login" className="text-cyan-400/80 hover:text-cyan-400">Inicia sesión</Link> para suscribirte o comprar créditos.
        </p>
      )}
    </div>
  );
}

const MONETAG_ZONE = 11216716;            // anuncio dentro de la app (SDK)

// "Mira un anuncio → gana créditos". El anuncio de Monetag se muestra DENTRO de la
// app vía show_<zona>(); los créditos se otorgan solo cuando el anuncio termina.
// NUNCA saca al usuario a otra web: si el SDK no está disponible, se avisa.
function EarnCredits() {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (getToken()) api.adRewardStatus().then(setStatus).catch(() => {});
  }, []);

  // Espera a que el SDK de Monetag defina la función show_<zona> (hasta ~12s).
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      if (typeof (window as any)[`show_${MONETAG_ZONE}`] === "function") {
        setReady(true);
        clearInterval(id);
      } else if (++tries > 24) {
        clearInterval(id);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  async function grant() {
    const r = await api.rewardAd();
    setStatus((s: any) => ({ ...s, remaining_today: r.remaining_today, used_today: r.used_today }));
    setMsg(`✓ +${r.granted} créditos. Saldo: ${r.balance}. Te quedan ${r.remaining_today} anuncios hoy.`);
  }

  async function watch() {
    if (!getToken()) { window.location.href = "/login"; return; }
    const show = (window as any)[`show_${MONETAG_ZONE}`];
    if (typeof show !== "function") {
      setMsg("⚠️ El anuncio no está disponible ahora (desactiva el bloqueador de anuncios e intenta de nuevo).");
      return;
    }
    setMsg(""); setBusy(true);
    try {
      await show();        // muestra el anuncio DENTRO de la app; resuelve al terminar
      await grant();       // otorga créditos solo al terminar
    } catch (e: any) {
      setMsg(`⚠️ ${e?.message || "No se completó el anuncio. Intenta de nuevo."}`);
    } finally {
      setBusy(false);
    }
  }

  const remaining = status?.remaining_today ?? null;

  return (
    <div className="liquid-glass rounded-2xl p-5 mb-8 max-w-2xl mx-auto flex flex-col sm:flex-row items-center gap-4 reveal"
         style={{ boxShadow: "inset 0 0 0 1px rgba(34,211,238,0.25)" }}>
      <div className="text-3xl">🎁</div>
      <div className="flex-1 text-center sm:text-left">
        <div className="text-white font-medium">Gana créditos gratis</div>
        <div className="text-white/50 text-sm mt-0.5">
          Mira un anuncio corto y recibe {status?.credits_per_ad ?? 5} créditos.
          {remaining !== null && ` Te quedan ${remaining} hoy.`}
        </div>
        {msg && <div className="text-cyan-300/90 text-xs mt-1">{msg}</div>}
      </div>
      <button
        onClick={watch}
        disabled={remaining === 0 || busy || !ready}
        className="btn text-sm px-5 py-2.5 shrink-0 disabled:opacity-50"
      >
        {busy ? "Mostrando anuncio…" : !ready ? "Preparando…" : remaining === 0 ? "Límite de hoy" : "🎬 Ver anuncio"}
      </button>
    </div>
  );
}
