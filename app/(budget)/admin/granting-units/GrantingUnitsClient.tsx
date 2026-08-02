"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createGrantingUnit, renameGrantingUnit, updateGrantingUnit, toggleGrantingUnit } from "./actions";

type Unit = {
  id: string; name: string; kind: string; registryCity: string; isActive: boolean;
  budgetCount: number; partnerCount: number;
};

const KINDS = [
  { value: "geo", label: "Focus geography" },
  { value: "thematic", label: "Thematic team" },
  { value: "operational", label: "Operational team" },
];

export default function GrantingUnitsClient({ units, registryCities }: { units: Unit[]; registryCities: string[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addKind, setAddKind] = useState("geo");
  const [addRegistry, setAddRegistry] = useState(registryCities[0] ?? "Bangalore");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const run = (fn: () => Promise<void>) =>
    start(async () => { setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/budget/dashboard" className="text-xs text-stone-400 hover:text-stone-600">← Dashboard</Link>
        <h1 className="text-xl font-semibold text-stone-900">Granting units</h1>
        <p className="text-sm text-stone-500">
          Offices, travelling thematic teams and operational teams that make grants. Budgets, grantees and the
          cost registry are all organised by these.
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-stone-500 flex-1 min-w-[12rem]">Name
          <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Delhi, Livelihoods team"
            className="mt-1 block w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-stone-500">Kind
          <select value={addKind} onChange={(e) => setAddKind(e.target.value)} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500">Cost registry
          <select value={addRegistry} onChange={(e) => setAddRegistry(e.target.value)} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm">
            {registryCities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button disabled={pending || !addName.trim()}
          onClick={() => run(async () => { await createGrantingUnit({ name: addName, kind: addKind, registryCity: addRegistry }); setAddName(""); })}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">Add unit</button>
      </div>
      <p className="-mt-4 text-xs text-stone-400">
        A new unit generates budgets from the chosen registry&apos;s standard costs until it has its own.
      </p>
      {err && <div className="text-xs text-red-600">{err}</div>}

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
        {units.map((u) => (
          <div key={u.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {editing === u.id ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 rounded border border-stone-300 px-2 py-1 text-sm" />
                  <button disabled={pending} onClick={() => run(async () => { await renameGrantingUnit(u.id, editName); setEditing(null); })} className="text-xs text-sky-600 hover:underline">Save</button>
                  <button onClick={() => setEditing(null)} className="text-xs text-stone-400">Cancel</button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm font-medium ${u.isActive ? "text-stone-900" : "text-stone-400 line-through"}`}>{u.name}</span>
                  <span className="text-xs text-stone-400">{u.budgetCount} budget{u.budgetCount === 1 ? "" : "s"} · {u.partnerCount} grantee{u.partnerCount === 1 ? "" : "s"}</span>
                  <button onClick={() => { setEditing(u.id); setEditName(u.name); }} className="text-xs text-stone-500 hover:text-stone-800">Rename</button>
                  <button disabled={pending} onClick={() => run(async () => { await toggleGrantingUnit(u.id, !u.isActive); })} className="text-xs text-stone-400 hover:text-stone-700">
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-stone-500">
              <label className="flex items-center gap-1">Kind
                <select value={u.kind} disabled={pending} onChange={(e) => run(async () => { await updateGrantingUnit(u.id, { kind: e.target.value }); })}
                  className="rounded border border-stone-300 px-1.5 py-0.5 text-xs">
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">Cost registry
                <select value={u.registryCity} disabled={pending} onChange={(e) => run(async () => { await updateGrantingUnit(u.id, { registryCity: e.target.value }); })}
                  className="rounded border border-stone-300 px-1.5 py-0.5 text-xs">
                  {registryCities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
