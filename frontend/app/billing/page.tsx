"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function BillingPage() {
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState("");

  useEffect(() => { api.tiers().then(setTiers).catch(() => {}); }, []);

  async function upgrade(tier: string) {
    setMsg("");
    try {
      const res = await api.checkout(tier);
      if (res.checkout_url) window.location.href = res.checkout_url;
      else setMsg(`Upgraded to ${tier} (mock mode). Credits granted.`);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Plans & Billing</h1>
      {msg && <p className="mb-4 text-sm text-green-400">{msg}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Object.entries(tiers).map(([name, t]) => (
          <div key={name} className="card">
            <h3 className="text-lg font-semibold capitalize">{name}</h3>
            <p className="my-2 text-2xl font-bold">${t.price_usd}<span className="text-sm text-zinc-400">/mo</span></p>
            <ul className="space-y-1 text-sm text-zinc-400">
              <li>{t.monthly_credits.toLocaleString()} credits / mo</li>
              <li>{t.rate_limit_per_min} req / min</li>
              <li>{t.premium_models ? "All models" : "Base models"}</li>
            </ul>
            {name !== "free" && <button className="btn mt-4 w-full" onClick={() => upgrade(name)}>Choose {name}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
