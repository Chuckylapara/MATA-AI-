"use client";
import { useEffect, useRef } from "react";

// Animated, mouse-reactive particle field with glow + connecting lines.
// Tuned for a premium, futuristic "AI platform" feel.
export default function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const COUNT = 64;
    const pts: { x: number; y: number; vx: number; vy: number; r: number; hue: number }[] = [];
    const mouse = { x: -9999, y: -9999, active: false };

    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function seed() {
      pts.length = 0;
      for (let i = 0; i < COUNT; i++) {
        pts.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.32, vy: (Math.random() - 0.5) * 0.32,
          r: 1.1 + Math.random() * 1.8,
          hue: Math.random() < 0.5 ? 190 : 268, // cyan or violet
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);

      // Soft glow halo following the cursor
      if (mouse.active) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 220);
        g.addColorStop(0, "rgba(34,211,238,0.10)");
        g.addColorStop(1, "rgba(34,211,238,0)");
        ctx.fillStyle = g;
        ctx.fillRect(mouse.x - 220, mouse.y - 220, 440, 440);
      }

      for (const p of pts) {
        // Gentle attraction toward the cursor when nearby (parallax depth)
        if (mouse.active) {
          const dx = mouse.x - p.x, dy = mouse.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 200 * 200) {
            const f = (1 - Math.sqrt(d2) / 200) * 0.015;
            p.vx += dx * f * 0.02; p.vy += dy * f * 0.02;
          }
        }
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.99; p.vy *= 0.99;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }

      // Connecting lines (gradient-tinted by distance)
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.hypot(dx, dy);
          if (d < 140) {
            const a = (1 - d / 140) * 0.22;
            ctx.strokeStyle = `rgba(120,160,255,${a})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.stroke();
          }
        }
      }

      // Glowing dots
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},90%,68%,0.9)`;
        ctx.shadowColor = `hsla(${p.hue},90%,60%,0.9)`;
        ctx.shadowBlur = 10;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    }

    resize(); seed(); frame();
    const onResize = () => { resize(); seed(); };
    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; };
    const onLeave = () => { mouse.active = false; mouse.x = mouse.y = -9999; };
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseout", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return (
    <>
      <div className="bg-fx" />
      <div className="bg-grid" />
      <canvas ref={ref} style={{ position: "fixed", inset: 0, zIndex: -1, opacity: 0.8 }} />
      <div className="bg-grain" />
    </>
  );
}
