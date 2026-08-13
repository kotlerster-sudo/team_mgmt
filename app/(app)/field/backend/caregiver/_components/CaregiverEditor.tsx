"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Plus, Users } from "lucide-react";

type Practice = { id: string; code: string; subcategory: string; shortLabel: string; fullText: string; trainingModule: number | null; sortOrder: number; isActive: boolean };
type Category = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; practices: Practice[] };

export function CaregiverEditor({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState(categories[0]?.id ?? "");
  const cat = categories.find((c) => c.id === activeId) ?? categories[0];

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed");
      router.refresh();
      return res.json().catch(() => ({}));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  const patchCat = (id: string, body: unknown) => call(`/api/admin/caregiver-practices/categories/${id}`, "PATCH", body);
  const patchPr = (id: string, body: unknown) => call(`/api/admin/caregiver-practices/practices/${id}`, "PATCH", body);
  const addCat = async () => {
    const code = prompt("Category code (e.g. FN):")?.trim().toUpperCase();
    if (!code) return;
    const name = prompt("Category name:")?.trim();
    if (!name) return;
    await call(`/api/admin/caregiver-practices`, "POST", { code, name });
  };
  const addPractice = async () => {
    if (!cat) return;
    const code = prompt("Practice code (e.g. FN-10):")?.trim().toUpperCase();
    if (!code) return;
    const subcategory = prompt("Subcategory (grouping within the category):")?.trim() || "General";
    const shortLabel = prompt("Short label (shown in the drill):")?.trim();
    if (!shortLabel) return;
    const fullText = prompt("Full text (portal wording):")?.trim() || shortLabel;
    await call(`/api/admin/caregiver-practices/practices`, "POST", { code, categoryId: cat.id, subcategory, shortLabel, fullText });
  };

  const subs = new Map<string, Practice[]>();
  for (const p of cat?.practices ?? []) subs.set(p.subcategory, [...(subs.get(p.subcategory) ?? []), p]);

  return (
    <div className="max-w-5xl mx-auto px-5 py-6">
      <div className="mb-5">
        <Link href="/field/backend" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"><ChevronLeft size={16} /> Backend</Link>
        <h1 className="mt-2 flex items-center gap-2 text-lg font-semibold text-stone-900"><Users size={18} className="text-stone-400" /> Caregiver practices</h1>
        <p className="mt-0.5 text-sm text-stone-500">The observation catalog used by the caregiver-practices visit form. {categories.reduce((n, c) => n + c.practices.length, 0)} practices in {categories.length} categories.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[13rem_1fr]">
        {/* Category list */}
        <div className="space-y-1">
          {categories.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${c.id === activeId ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-50"} ${!c.isActive ? "opacity-50" : ""}`}>
              <span className="truncate"><span className="font-mono text-xs opacity-70">{c.code}</span> {c.name}</span>
              <span className="text-xs opacity-60">{c.practices.length}</span>
            </button>
          ))}
          <button onClick={addCat} disabled={busy} className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-stone-600 hover:text-stone-900"><Plus size={13} /> Add category</button>
        </div>

        {/* Practices for the selected category */}
        {cat && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-stone-400">{cat.code}</span>
                <input defaultValue={cat.name} onBlur={(e) => e.target.value !== cat.name && patchCat(cat.id, { name: e.target.value })} className="rounded border border-transparent px-1 py-0.5 font-medium text-stone-900 hover:border-stone-200 focus:border-stone-300 focus:outline-none" />
              </div>
              <div className="flex items-center gap-3 text-xs text-stone-500">
                <label className="flex items-center gap-1"><span>order</span><input type="number" defaultValue={cat.sortOrder} onBlur={(e) => patchCat(cat.id, { sortOrder: Number(e.target.value) })} className="w-16 rounded border border-stone-200 px-1 py-0.5" /></label>
                <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={cat.isActive} onChange={(e) => patchCat(cat.id, { isActive: e.target.checked })} /> active</label>
              </div>
            </div>

            {[...subs.entries()].map(([sub, list]) => (
              <div key={sub}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{sub}</p>
                <div className="space-y-1.5">
                  {list.map((p) => (
                    <div key={p.id} className={`rounded-lg border border-stone-200 bg-white p-2.5 ${!p.isActive ? "opacity-50" : ""}`}>
                      <div className="flex items-start gap-2">
                        <span className="mt-1 font-mono text-[11px] text-stone-400">{p.code}</span>
                        <div className="flex-1 space-y-1">
                          <input defaultValue={p.shortLabel} onBlur={(e) => e.target.value !== p.shortLabel && patchPr(p.id, { shortLabel: e.target.value })} className="w-full rounded border border-transparent px-1 py-0.5 text-sm font-medium text-stone-800 hover:border-stone-200 focus:border-stone-300 focus:outline-none" />
                          <textarea defaultValue={p.fullText} onBlur={(e) => e.target.value !== p.fullText && patchPr(p.id, { fullText: e.target.value })} rows={2} className="w-full resize-y rounded border border-stone-100 px-1.5 py-1 text-xs text-stone-600 hover:border-stone-200 focus:border-stone-300 focus:outline-none" />
                          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                            <label className="flex items-center gap-1"><span>subcat</span><input defaultValue={p.subcategory} onBlur={(e) => e.target.value !== p.subcategory && patchPr(p.id, { subcategory: e.target.value })} className="w-32 rounded border border-stone-200 px-1 py-0.5" /></label>
                            <label className="flex items-center gap-1"><span>training module</span><input type="number" defaultValue={p.trainingModule ?? ""} onBlur={(e) => patchPr(p.id, { trainingModule: e.target.value === "" ? null : Number(e.target.value) })} className="w-14 rounded border border-stone-200 px-1 py-0.5" /></label>
                            <label className="flex items-center gap-1"><span>order</span><input type="number" defaultValue={p.sortOrder} onBlur={(e) => patchPr(p.id, { sortOrder: Number(e.target.value) })} className="w-14 rounded border border-stone-200 px-1 py-0.5" /></label>
                            <label className="flex items-center gap-1"><input type="checkbox" defaultChecked={p.isActive} onChange={(e) => patchPr(p.id, { isActive: e.target.checked })} /> active</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={addPractice} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"><Plus size={13} /> Add practice</button>
          </div>
        )}
      </div>
    </div>
  );
}
