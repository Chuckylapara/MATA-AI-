"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ensureSession, getToken } from "@/lib/api";

// Lets people use MATA AI without creating an account: on the first visit a private guest
// session is created automatically. Pages that read the session on mount reload once.
export default function GuestSession() {
  const path = usePathname();
  useEffect(() => {
    if (getToken()) return;
    ensureSession().then((ok) => {
      if (ok && !path?.startsWith("/nexus") && !path?.startsWith("/login")) window.location.reload();
    });
  }, [path]);
  return null;
}
