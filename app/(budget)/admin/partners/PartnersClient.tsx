"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createGrantPartner, renameGrantPartner, toggleGrantPartner, importGrantPartnersFromOrgs, linkGrantPartnerLogin, unlinkGrantPartnerLogin, reassignGrantPartnerCity } from "../../budget/actions";

type Login = { userId: string; email: string; name: string | null };
type Partner = { id: string; name: string; city: string; isActive: boolean; budgetCount: number; logins: Login[] };
type Candidate = { email: string; name: string | null };
type Unit = { id: string; name: string };

export default function PartnersClient({ partners, units, candidates = [] }: { partners: Partner[]; units: Unit[]; candidates?: Candidate[] }) {
  const unitNames = units.map((u) => u.name);
  const firstUnit = unitNames[0] ?? "Bangalore";
  const [pending, start] = useTransition();
  const [addCity, setAddCity] = useState<string>(firstUnit);
  const [addName, setAddName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [moveCity, setMoveCity] = useState<string>(firstUnit);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [importCity, setImportCity] = useState<string>(firstUnit);

  const run = (fn: () => Promise<void>) => start(async () => { setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } });

  return (
    <div className="space-y-6">
      {/* Suggestions for the "Link login account" inputs — unlinked partner accounts. */}
      <datalist id="partner-accounts">
        {candidates.map((c) => (
          <option key={c.email} value={c.email}>{c.name ? `${c.name} — ${c.email}` : c.email}</option>
        ))}
      </datalist>
      <div>
        <Link href="/budget/dashboard" className="text-xs text-stone-400 hover:text-stone-600">← Dashboard</Link>
        <h1 className="text-xl font-semibold text-stone-900">Grant partners</h1>
        <p className="text-sm text-stone-500">Grantee organisations. Budgets are assigned a partner; the dashboard aggregates by it.</p>
      </div>

      {/* Add */}
      <div className="rounded-xl border border-stone-200 bg-white p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-stone-500">City
          <select value={addCity} onChange={(e) => setAddCity(e.target.value)} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm">
            {unitNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-500 flex-1 min-w-[12rem]">Name
          <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. CFAR" className="mt-1 block w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
        </label>
        <button disabled={pending || !addName.trim()} onClick={() => run(async () => { await createGrantPartner(addCity, addName); setAddName(""); })}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">Add partner</button>
      </div>

      {/* Pull from Settings → Partners */}
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[14rem]">
          <div className="text-sm font-medium text-stone-700">Pull from Settings partners</div>
          <p className="text-xs text-stone-500 mt-0.5">Copies every active org from Settings → Partners into the chosen city. Skips names that already exist here.</p>
        </div>
        <label className="text-xs text-stone-500">City
          <select value={importCity} onChange={(e) => setImportCity(e.target.value)} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm">
            {unitNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button disabled={pending} onClick={() => run(async () => { setNote(null); const r = await importGrantPartnersFromOrgs(importCity); setNote(`${r.added} added to ${importCity} (${r.total} settings partners checked).`); })}
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-50">Pull partners</button>
      </div>
      {note && <div className="text-xs text-emerald-700">{note}</div>}
      {err && <div className="text-xs text-red-600">{err}</div>}

      {/* List by granting unit */}
      {unitNames.map((city) => {
        const rows = partners.filter((p) => p.city === city);
        if (rows.length === 0) return null;
        return (
          <section key={city}>
            <h2 className="text-sm font-semibold text-stone-700 mb-2">{city}</h2>
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
              {rows.map((p) => (
                <div key={p.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {editing === p.id ? (
                      <>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 rounded border border-stone-300 px-2 py-1 text-sm" />
                        <button disabled={pending} onClick={() => run(async () => { await renameGrantPartner(p.id, editName); setEditing(null); })} className="text-xs text-sky-600 hover:underline">Save</button>
                        <button onClick={() => setEditing(null)} className="text-xs text-stone-400">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 text-sm ${p.isActive ? "text-stone-900" : "text-stone-400 line-through"}`}>{p.name}</span>
                        <span className="text-xs text-stone-400">{p.budgetCount} budget{p.budgetCount === 1 ? "" : "s"}</span>
                        <button onClick={() => { setEditing(p.id); setEditName(p.name); }} className="text-xs text-stone-500 hover:text-stone-800">Rename</button>
                        <button onClick={() => { setMoving(p.id); setMoveCity(unitNames.find((c) => c !== p.city) ?? firstUnit); }} className="text-xs text-stone-500 hover:text-stone-800">Move</button>
                        <button disabled={pending} onClick={() => run(async () => { await toggleGrantPartner(p.id, !p.isActive); })} className="text-xs text-stone-400 hover:text-stone-700">
                          {p.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </>
                    )}
                  </div>
                  {/* Login accounts — a grantee can hold several */}
                  <div className="mt-1.5 space-y-1 text-xs">
                    {p.logins.map((l) => (
                      <div key={l.userId} className="flex flex-wrap items-center gap-2">
                        <span className="text-stone-400">Login:</span>
                        <span className="text-stone-600">{l.email}</span>
                        {l.name && <span className="text-stone-400">{l.name}</span>}
                        <button disabled={pending} onClick={() => run(async () => { await unlinkGrantPartnerLogin(l.userId); })} className="text-stone-400 hover:text-red-600">Unlink</button>
                      </div>
                    ))}
                    {linking === p.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input list="partner-accounts" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} placeholder="partner account email" className="rounded border border-stone-300 px-2 py-1 text-xs w-full sm:w-56" />
                        <button disabled={pending || !linkEmail.trim()} onClick={() => run(async () => { await linkGrantPartnerLogin(p.id, linkEmail); setLinking(null); setLinkEmail(""); })} className="text-sky-600 hover:underline">Link</button>
                        <button onClick={() => { setLinking(null); setLinkEmail(""); }} className="text-stone-400">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setLinking(p.id); setLinkEmail(""); }} className="text-stone-400 hover:text-stone-700">
                        {p.logins.length > 0 ? "+ Add another login" : "+ Link login account"}
                      </button>
                    )}
                  </div>
                  {/* Move to another city */}
                  {moving === p.id && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-stone-400">Move to</span>
                      <select value={moveCity} onChange={(e) => setMoveCity(e.target.value)} className="rounded border border-stone-300 px-2 py-1 text-xs">
                        {unitNames.filter((c) => c !== p.city).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {p.budgetCount > 0 && <span className="text-stone-400">— moves {p.budgetCount} budget{p.budgetCount === 1 ? "" : "s"} too</span>}
                      <button disabled={pending} onClick={() => run(async () => { await reassignGrantPartnerCity(p.id, moveCity); setMoving(null); })} className="text-sky-600 hover:underline">Confirm</button>
                      <button onClick={() => setMoving(null)} className="text-stone-400">Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {partners.length === 0 && <div className="text-center py-12 text-sm text-stone-400">No partners yet — add one above.</div>}
    </div>
  );
}
