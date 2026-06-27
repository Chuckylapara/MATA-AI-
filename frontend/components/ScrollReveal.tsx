"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Adds `.reveal-in` to any `.reveal` element when it scrolls into view.
export default function ScrollReveal() {
  const pathname = usePathname();
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("reveal-in");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    // Query after the route's DOM has painted.
    const t = setTimeout(() => {
      document.querySelectorAll(".reveal:not(.reveal-in)").forEach((el) => obs.observe(el));
    }, 50);
    return () => {
      clearTimeout(t);
      obs.disconnect();
    };
  }, [pathname]);
  return null;
}
