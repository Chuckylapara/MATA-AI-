"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function AdminPage() {
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.adminOverview(), api.adminUsers()])
      .then(([o, u]) => { setOverview(o); setUsers(u); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-400">Admin access required: {error}</p>;
  if (!overview) return <p className="text-zinc-500">Loading…</p>;

  const stat = (label: string, value: any) => (
    <div className="card">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Admin Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stat("Total users", overview.total_users)}
        {stat("MRR", `$${overview.mrr_usd}`)}
        {stat("Credits spent", overview.total_credits_spent)}
        {stat("Generations", overview.total_generations)}
      </div>

      <h2 className="mb-2 mt-8 text-lg font-semibold">Credits by module</h2>
      <div className="card">
        <pre className="text-sm">{JSON.stringify(overview.credits_by_module, null, 2)}</pre>
      </div>

      <h2 className="mb-2 mt-8 text-lg font-semibold">Users</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-400">
            <tr><th>Email</th><th>Role</th><th>Tier</th><th>Credits</th><th>Active</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-zinc-800">
                <td className="py-1">{u.email}</td><td>{u.role}</td><td>{u.tier}</td>
                <td>{u.credits}</td><td>{u.is_active ? "✓" : "✗"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
