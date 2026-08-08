"use client";

/**
 * Admin taxonomy editor for caregiver practices (creche visit observation).
 * Browse categories → practices grouped by subcategory; toggle active, edit
 * label/full-text/module/subcategory, and add practices/categories. The DB is
 * the source of truth after the initial seed.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronDown, ChevronRight, Plus, Loader2, EyeOff, Eye, Pencil, Check, X } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

type Practice = {
  id: string; code: string; subcategory: string; shortLabel: string; fullText: string;
  trainingModule: number | null; sortOrder: number; isActive: boolean;
};
type Category = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; practices: Practice[] };

export default function CaregiverPracticesSettings() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";

  const [cats, setCats] = useState<Category[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/caregiver-practices?all=1");
    if (r.ok) setCats((await r.json()).categories);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (session && !isAdmin) router.replace("/settings"); }, [session, isAdmin, router]);
  if (!isAdmin) return null;

  const patchPractice = async (id: string, data: Record<string, unknown>) => {
    setBusy(true);
    await fetch(`/api/admin/caregiver-practices/practices/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    await load();
    setBusy(false);
    setEditing(null);
  };
  const patchCategory = async (id: string, data: Record<string, unknown>) => {
    setBusy(true);
    await fetch(`/api/admin/caregiver-practices/categories/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    await load();
    setBusy(false);
  };

  const total = cats?.reduce((n, c) => n + c.practices.length, 0) ?? 0;

  return (
    <SurfaceProvider id="settings.caregiver_practices">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div>
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">
            <ChevronLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-lg font-semibold text-stone-900 mt-1">Caregiver Practices</h1>
          <p className="text-sm text-stone-500">{cats?.length ?? 0} categories · {total} practices · edited here, captured on creche visits.</p>
        </div>

        {cats === null ? (
          <div className="grid place-items-center py-10 text-stone-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {cats.map((c) => {
              const isOpen = open === c.id;
              const bySub = new Map<string, Practice[]>();
              for (const p of c.practices) bySub.set(p.subcategory, [...(bySub.get(p.subcategory) ?? []), p]);
              return (
                <div key={c.id} className={`border rounded-xl bg-white overflow-hidden ${c.isActive ? "border-stone-200" : "border-stone-200 opacity-60"}`}>
                  <div className="w-full flex items-center gap-2 px-3 py-2.5">
                    <button onClick={() => setOpen(isOpen ? null : c.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-stone-400" /> : <ChevronRight className="w-4 h-4 text-stone-400" />}
                      <span className="text-sm font-semibold text-stone-800 truncate">{c.name}</span>
                      <span className="text-[11px] text-stone-400">{c.code} · {c.practices.length}</span>
                    </button>
                    <button
                      onClick={() => patchCategory(c.id, { isActive: !c.isActive })}
                      disabled={busy}
                      title={c.isActive ? "Deactivate" : "Activate"}
                      className="p-1 rounded-lg hover:bg-stone-100 text-stone-400"
                    >
                      {c.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-stone-100 p-2 space-y-3">
                      {[...bySub.entries()].map(([sub, practices]) => (
                        <div key={sub}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-1 mb-1">{sub}</p>
                          <div className="space-y-1">
                            {practices.map((p) => (
                              <PracticeRow
                                key={p.id}
                                p={p}
                                editing={editing === p.id}
                                busy={busy}
                                onEdit={() => setEditing(p.id)}
                                onCancel={() => setEditing(null)}
                                onSave={(data) => patchPractice(p.id, data)}
                                onToggle={() => patchPractice(p.id, { isActive: !p.isActive })}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                      {adding === c.id ? (
                        <AddPracticeRow categoryId={c.id} onDone={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />
                      ) : (
                        <button onClick={() => setAdding(c.id)} className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 px-1 py-1">
                          <Plus className="w-3.5 h-3.5" /> Add practice
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SurfaceProvider>
  );
}

function PracticeRow({
  p, editing, busy, onEdit, onCancel, onSave, onToggle,
}: {
  p: Practice; editing: boolean; busy: boolean;
  onEdit: () => void; onCancel: () => void; onSave: (d: Record<string, unknown>) => void; onToggle: () => void;
}) {
  const [shortLabel, setShort] = useState(p.shortLabel);
  const [fullText, setFull] = useState(p.fullText);
  const [subcategory, setSub] = useState(p.subcategory);
  const [module, setModule] = useState<string>(p.trainingModule?.toString() ?? "");

  if (editing) {
    return (
      <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-2 space-y-1.5">
        <input value={shortLabel} onChange={(e) => setShort(e.target.value)} placeholder="Short label" className="w-full text-xs rounded border border-stone-200 px-2 py-1" />
        <textarea value={fullText} onChange={(e) => setFull(e.target.value)} rows={2} placeholder="Full text" className="w-full text-xs rounded border border-stone-200 px-2 py-1 resize-none" />
        <div className="flex gap-1.5">
          <input value={subcategory} onChange={(e) => setSub(e.target.value)} placeholder="Subcategory" className="flex-1 text-xs rounded border border-stone-200 px-2 py-1" />
          <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Module" className="w-20 text-xs rounded border border-stone-200 px-2 py-1" />
        </div>
        <div className="flex justify-end gap-1.5">
          <button onClick={onCancel} className="px-2 py-1 text-xs text-stone-500 rounded hover:bg-stone-100"><X className="w-3.5 h-3.5" /></button>
          <button
            onClick={() => onSave({ shortLabel, fullText, subcategory, trainingModule: module.trim() === "" ? null : Number(module) })}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-sky-600 text-white rounded hover:bg-sky-700"
          >
            <Check className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border border-stone-100 ${p.isActive ? "" : "opacity-50"}`}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-stone-800">{p.shortLabel} <span className="text-[10px] text-stone-300">{p.code}</span></p>
        <p className="text-[11px] text-stone-500 truncate">{p.fullText}</p>
      </div>
      <button onClick={onEdit} className="p-1 rounded hover:bg-stone-100 text-stone-400 shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
      <button onClick={onToggle} disabled={busy} className="p-1 rounded hover:bg-stone-100 text-stone-400 shrink-0" title={p.isActive ? "Deactivate" : "Activate"}>
        {p.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function AddPracticeRow({ categoryId, onDone, onCancel }: { categoryId: string; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [shortLabel, setShort] = useState("");
  const [fullText, setFull] = useState("");
  const [subcategory, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/admin/caregiver-practices/practices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, code, shortLabel, fullText, subcategory }),
    });
    setBusy(false);
    if (r.ok) onDone();
    else setErr((await r.json().catch(() => ({})))?.error ?? "Failed");
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2 space-y-1.5">
      <div className="flex gap-1.5">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. FN-16)" className="w-32 text-xs rounded border border-stone-200 px-2 py-1" />
        <input value={subcategory} onChange={(e) => setSub(e.target.value)} placeholder="Subcategory" className="flex-1 text-xs rounded border border-stone-200 px-2 py-1" />
      </div>
      <input value={shortLabel} onChange={(e) => setShort(e.target.value)} placeholder="Short label" className="w-full text-xs rounded border border-stone-200 px-2 py-1" />
      <textarea value={fullText} onChange={(e) => setFull(e.target.value)} rows={2} placeholder="Full text" className="w-full text-xs rounded border border-stone-200 px-2 py-1 resize-none" />
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="px-2 py-1 text-xs text-stone-500 rounded hover:bg-stone-100">Cancel</button>
        <button onClick={submit} disabled={busy || !code || !shortLabel || !fullText || !subcategory} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
        </button>
      </div>
    </div>
  );
}
