"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Gauge, Check } from "lucide-react";
import type { CatalogItem } from "@/lib/catalogDb";

type TplChecklist = { key: string; text: string; completionType: string; hasIndicator: boolean };
type TplPitstop = { title: string; key: string; checklist: TplChecklist[] };
type Tpl = { slug: string; name: string; pitstops: TplPitstop[] };

const COMPLETION_TYPES = [
  { value: "Activity", label: "Activity" },
  { value: "Voice", label: "Voice note" },
  { value: "Upload", label: "Upload" },
  { value: "", label: "Checkbox" },
];

const ctLabel = (v: string) => COMPLETION_TYPES.find((c) => c.value === v)?.label ?? "Activity";

/**
 * Picks goal-template checklist items to tag into a catalog category. Two modes:
 *  - "From template": check existing checklist items (the indicator-binding unit) → tagged as
 *     linked CatalogItems (ref). Ticking them on a visit fires their indicators + real completionType.
 *  - "New activity": authors a new checklist item straight into the goal template, then tags it.
 */
export function TemplatePicker({
  domain, taggedRefs, onAdd, onClose,
}: {
  domain: string | null;
  taggedRefs: Set<string>; // "slug::key" already in this category
  onAdd: (items: CatalogItem[]) => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Which goal template this catalog tags from. Multiple templates can share a domain (e.g. a
  // setup template + an "existing"/monitoring one) — visit catalogs want the monitoring one.
  const [tplSlug, setTplSlug] = useState("");

  const [nPs, setNPs] = useState("");
  const [nText, setNText] = useState("");
  const [nCt, setNCt] = useState("Activity");

  useEffect(() => {
    if (!domain) { setLoading(false); return; }
    fetch(`/api/admin/catalogs/template-items?domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [domain]);

  const indicatorCount = (t: Tpl) => t.pitstops.flatMap((p) => p.checklist).filter((c) => c.hasIndicator).length;
  const itemCount = (t: Tpl) => t.pitstops.reduce((n, p) => n + p.checklist.length, 0);

  // Default to the template richest in indicators (the monitoring template a live-centre catalog
  // usually wants), else the one already tagged here, else the first. Indicator-first on purpose:
  // when items were mis-tagged to a setup template, we still steer toward the right one.
  useEffect(() => {
    if (!templates.length || tplSlug) return;
    const withInd = [...templates].sort((a, b) => indicatorCount(b) - indicatorCount(a))[0];
    const tagged = [...taggedRefs][0]?.split("::")[0];
    const fromTags = tagged ? templates.find((t) => t.slug === tagged) : null;
    setTplSlug((indicatorCount(withInd) > 0 ? withInd : fromTags ?? templates[0]).slug);
  }, [templates, tplSlug, taggedRefs]);

  const selTpl = templates.find((t) => t.slug === tplSlug) ?? null;

  const metaByRef = useMemo(() => {
    const m = new Map<string, { text: string; completionType: string; slug: string; key: string }>();
    for (const t of templates) for (const p of t.pitstops) for (const c of p.checklist) {
      m.set(`${t.slug}::${c.key}`, { text: c.text, completionType: c.completionType, slug: t.slug, key: c.key });
    }
    return m;
  }, [templates]);

  const toggle = (ref: string) =>
    setSelected((s) => { const n = new Set(s); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });

  const addSelected = () => {
    const items: CatalogItem[] = [];
    for (const ref of selected) {
      const meta = metaByRef.get(ref);
      if (!meta) continue;
      items.push({
        key: meta.key, text: meta.text, completionType: meta.completionType, blocksSignoff: true,
        ref: { templateSlug: meta.slug, checklistKey: meta.key },
      });
    }
    if (items.length) onAdd(items);
    onClose();
  };

  const addNew = async () => {
    if (!tplSlug || !nPs || !nText.trim()) return;
    setBusy(true); setErr("");
    const res = await fetch("/api/admin/catalogs/template-items", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateSlug: tplSlug, pitstopKey: nPs, text: nText.trim(), completionType: nCt }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(data?.error ?? "Failed to add activity"); return; }
    onAdd([{
      key: data.checklistKey, text: data.text, completionType: data.completionType, blocksSignoff: true,
      ref: { templateSlug: data.templateSlug, checklistKey: data.checklistKey },
    }]);
    onClose();
  };

  const newPitstops = selTpl?.pitstops ?? [];

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-800 flex-1">Add activities from the {domain ?? "—"} template</h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
        </div>

        {!domain ? (
          <p className="p-6 text-sm text-stone-400 text-center">Set this catalog&apos;s programme domain first.</p>
        ) : (
          <>
            <div className="flex gap-1 px-4 pt-3">
              {(["existing", "new"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${tab === t ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"}`}
                >
                  {t === "existing" ? "From template" : "New activity"}
                </button>
              ))}
            </div>

            {/* Goal-template selector — shared by both tabs */}
            {templates.length > 0 && (
              <div className="px-4 pt-3">
                <label className="block text-xs font-medium text-stone-500 mb-1">Goal template to tag from</label>
                <select
                  className="w-full px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white"
                  value={tplSlug}
                  onChange={(e) => { setTplSlug(e.target.value); setNPs(""); setSelected(new Set()); }}
                >
                  {templates.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name} · {itemCount(t)} items{indicatorCount(t) > 0 ? ` · ${indicatorCount(t)} indicators` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {loading ? (
                <p className="text-sm text-stone-400 text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</p>
              ) : tab === "existing" ? (
                !selTpl ? (
                  <p className="text-sm text-stone-400 text-center py-8">No goal template for this domain.</p>
                ) : (
                  <div className="space-y-2">
                    {selTpl.pitstops.map((p) => (
                      <div key={p.key} className="mb-1">
                        <p className="text-[11px] text-stone-400 mb-1">{p.title}</p>
                        <div className="space-y-1">
                          {p.checklist.map((c) => {
                            const ref = `${selTpl.slug}::${c.key}`;
                            const already = taggedRefs.has(ref);
                            return (
                              <label key={ref} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${already ? "border-stone-100 bg-stone-50 opacity-60" : "border-stone-200 bg-white cursor-pointer hover:border-stone-300"}`}>
                                <input
                                  type="checkbox"
                                  disabled={already}
                                  checked={already || selected.has(ref)}
                                  onChange={() => toggle(ref)}
                                  className="accent-stone-700"
                                />
                                <span className="text-sm text-stone-800 flex-1 min-w-0 truncate">{c.text}</span>
                                {c.hasIndicator && (
                                  <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 flex items-center gap-0.5">
                                    <Gauge className="w-2.5 h-2.5" /> indicator
                                  </span>
                                )}
                                <span className="text-[10px] text-stone-500 bg-stone-100 rounded-full px-1.5 py-0.5 shrink-0">{ctLabel(c.completionType)}</span>
                                {already && <Check className="w-3.5 h-3.5 text-stone-400 shrink-0" />}
                              </label>
                            );
                          })}
                          {p.checklist.length === 0 && <p className="text-[11px] text-stone-300 italic">No checklist items.</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Pitstop</label>
                    <select className="w-full px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white" value={nPs} onChange={(e) => setNPs(e.target.value)} disabled={!tplSlug}>
                      <option value="">— pick —</option>
                      {newPitstops.map((p) => <option key={p.key} value={p.key}>{p.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Activity</label>
                    <input className="w-full px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white" value={nText} onChange={(e) => setNText(e.target.value)} placeholder="What the RP does" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1">Completion type</label>
                    <select className="w-full px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg bg-white" value={nCt} onChange={(e) => setNCt(e.target.value)}>
                      {COMPLETION_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <p className="text-[11px] text-stone-400">Adds this to the goal template and tags it here. Existing live centres are unaffected.</p>
                  {err && <p className="text-xs text-red-600">{err}</p>}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-stone-100">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100 rounded-lg">Cancel</button>
              {tab === "existing" ? (
                <button onClick={addSelected} disabled={selected.size === 0} className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50">
                  Add {selected.size > 0 ? selected.size : ""} selected
                </button>
              ) : (
                <button onClick={addNew} disabled={busy || !tplSlug || !nPs || !nText.trim()} className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 inline-flex items-center gap-1">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add to template + tag
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
