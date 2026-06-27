"use client";

// "AI thinking…" animated indicator — a pulsing orb with orbiting dots.
export default function Thinking({ label = "Mata está pensando…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-cyan-200">
      <style>{css}</style>
      <span className="think-orb" aria-hidden />
      <span className="think-label">{label}</span>
    </div>
  );
}

const css = `
.think-orb { position: relative; width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fff, #22d3ee 55%, #6d28d9);
  box-shadow: 0 0 14px #22d3ee; animation: thinkPulse 1.1s ease-in-out infinite; }
.think-orb::before, .think-orb::after { content:""; position:absolute; inset:-6px; border-radius:50%;
  border:1.5px solid rgba(34,211,238,.5); animation: thinkSpin 2.4s linear infinite; }
.think-orb::after { inset:-11px; border-color: rgba(168,85,247,.4); animation-duration: 3.6s; animation-direction: reverse; }
@keyframes thinkPulse { 0%,100% { transform: scale(.9); } 50% { transform: scale(1.12); } }
@keyframes thinkSpin { to { transform: rotate(360deg); } }
.think-label { background: linear-gradient(90deg,#67e8f9,#a78bfa,#67e8f9); background-size:200% auto;
  -webkit-background-clip:text; background-clip:text; color:transparent; animation: shimmer 2s linear infinite; }
@keyframes shimmer { to { background-position: 200% center; } }
`;
