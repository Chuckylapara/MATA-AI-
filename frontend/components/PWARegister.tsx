"use client";
import { useEffect } from "react";

// Registra el service worker para que MATA AI sea instalable y funcione offline.
export default function PWARegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
