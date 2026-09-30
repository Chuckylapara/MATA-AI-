"use client";
import { useEffect } from "react";

// Registra el service worker para que MATA AI sea instalable y funcione offline.
// También se asegura de que, cuando publicamos una versión nueva, el teléfono
// la tome de inmediato (sin quedarse pegado en JS viejo cacheado).
export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/sw.js`)
      .then((reg) => {
        // Revisa si hay una versión nueva cada vez que se abre/enfoca la app.
        reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      })
      .catch(() => {});

    // Cuando el nuevo service worker toma el control, recarga una vez para
    // que se usen los archivos nuevos (evita quedarse con una versión vieja).
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }, []);
  return null;
}
