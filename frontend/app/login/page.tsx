"use client";
import { useEffect, useState } from "react";
import { api, getToken, logout } from "@/lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getToken()) api.me().then(setMe).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "login") await api.login({ email, password });
      else await api.register({ email, password });
      setMe(await api.me());
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (me) {
    return (
      <div className="card max-w-md">
        <h2 className="text-xl font-bold">Signed in</h2>
        <p className="mt-2 text-sm text-zinc-400">{me.email}</p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>Role: <b>{me.role}</b></li>
          <li>Tier: <b>{me.tier}</b></li>
          <li>Credits: <b>{me.credits}</b></li>
        </ul>
        <button className="btn mt-4" onClick={() => { logout(); setMe(null); }}>Log out</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card max-w-md space-y-3">
      <h2 className="text-xl font-bold">{mode === "login" ? "Log in" : "Create account"}</h2>
      <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" type="password" placeholder="Password (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn w-full" type="submit">{mode === "login" ? "Log in" : "Sign up"}</button>
      <button type="button" className="text-sm text-zinc-400 underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Register" : "Have an account? Log in"}
      </button>
      <p className="text-xs text-zinc-500">Seeded admin: admin@mata.ai / admin12345</p>
    </form>
  );
}
