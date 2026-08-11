"use client";

// Catalogs → categories → items, edited as nested rows. Item's "tags checklist" dropdown sets the
// ref (templateSlug+checklistKey) that wires it to a template checklist. Debounced full-object PUT
// to /api/admin/catalogs/[id] (dual-writes JSON→relational, incl. the CatalogItemDef.checklistDefId FK).

import { useEffect, useRef, useState } from "react";
import { EditableText, EditableSelect, EditableCheckbox, RowDelete, AddRow, ExpandChevron } from "@/components/controlplane/cells";
import { CAREGIVER_PRACTICES_LAUNCHER_KEY } from "@/lib/caregiverPractices";

type Ref = { templateSlug: string; checklistKey: string };
type Item = { key?: string; text: string; completionType?: string; blocksSignoff?: boolean; ref?: Ref };
type Category = { key?: string; label: string; items: Item[] };
type Catalog = { id: string; slug: string; name: string; needsDomain: string | null; categories: Category[]; defaultCadenceCount: number | null; defaultCadencePeriod: string | null; isActive: boolean };
type Opt = { value: string; label: string };

const CT: Opt[] = [{ value: "", label: "Checkbox" }, { value: "Activity", label: "Activity" }, { value: "Voice", label: "Voice" }, { value: "Upload", label: "Upload" }];

export default function CatalogsTab() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [keyOpts, setKeyOpts] = useState<Opt[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { fetch("/api/admin/catalogs").then((r) => r.json()).then(setCatalogs).catch(() => {}); }, []);
  useEffect(() => {
    fetch("/api/admin/template-checklist-keys").then((r) => r.json()).then((tpls: { slug: string; name: string; items: { key: string; text: string }[] }[]) => {
      setKeyOpts((tpls ?? []).flatMap((t) => t.items.map((i) => ({ value: `${t.slug}::${i.key}`, label: `${t.name}: ${i.text}` }))));
    }).catch(() => {});
  }, []);

  const scheduleSave = (c: Catalog) => {
    clearTimeout(timers.current[c.id]);
    timers.current[c.id] = setTimeout(() => {
      fetch(`/api/admin/catalogs/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
    }, 700);
  };
  const patch = (cid: string, mutate: (c: Catalog) => void) => {
    setCatalogs((prev) => prev.map((c) => {
      if (c.id !== cid) return c;
      const next = structuredClone(c) as Catalog;
      mutate(next);
      scheduleSave(next);
      return next;
    }));
  };
  const k = (id: string, ...p: (string | number)[]) => `${id}:${p.join(":")}`;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-stone-400 mb-1">Visit catalogs → categories → items. &quot;Tags checklist&quot; wires an item to a template checklist. Autosaves (~1s).</p>
      {catalogs.map((c) => (
        <div key={c.id} className="border border-stone-200 rounded-xl bg-white">
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}><ExpandChevron open={!!open[c.id]} /></button>
            <EditableText value={c.name} onSave={(v) => patch(c.id, (x) => { x.name = v; })} className="font-medium" />
            <span className="text-xs text-stone-400 shrink-0">{c.needsDomain} · {(c.categories ?? []).length} cats</span>
          </div>
          {open[c.id] && (
            <div className="border-t border-stone-100 px-3 py-2 space-y-2">
              {(c.categories ?? []).map((cat, gi) => {
                const gk = k(c.id, "g", gi);
                return (
                  <div key={gi} className="border border-stone-100 rounded-lg bg-stone-50/50">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <button onClick={() => setOpen((o) => ({ ...o, [gk]: !o[gk] }))}><ExpandChevron open={!!open[gk]} /></button>
                      <EditableText value={cat.label} onSave={(v) => patch(c.id, (x) => { x.categories[gi].label = v; })} className="font-medium" />
                      <span className="text-xs text-stone-400">{(cat.items ?? []).length} items</span>
                      <RowDelete onDelete={() => patch(c.id, (x) => { x.categories.splice(gi, 1); })} />
                    </div>
                    {open[gk] && (
                      <div className="px-3 pb-2 space-y-1">
                        <div className="grid grid-cols-[1fr_7rem_5rem_1fr_2rem] gap-2 text-[10px] uppercase tracking-wider text-stone-400 px-1">
                          <span>Text</span><span>Type</span><span>Mandatory</span><span>Tags checklist</span><span></span>
                        </div>
                        {(cat.items ?? []).map((it, ii) => (
                          <div key={ii} className="grid grid-cols-[1fr_7rem_5rem_1fr_2rem] gap-2 items-center">
                            <EditableText value={it.text} onSave={(v) => patch(c.id, (x) => { x.categories[gi].items[ii].text = v; })} />
                            <EditableSelect value={it.completionType ?? "Activity"} options={CT} onSave={(v) => patch(c.id, (x) => { x.categories[gi].items[ii].completionType = v ?? "Activity"; })} />
                            <EditableCheckbox value={it.blocksSignoff ?? true} onSave={(v) => patch(c.id, (x) => { x.categories[gi].items[ii].blocksSignoff = v; })} />
                            {it.key === CAREGIVER_PRACTICES_LAUNCHER_KEY ? (
                              <span className="text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-2 py-1 truncate" title="This item opens the Caregiver Practices drill (managed in the Caregiver practices tab)">→ Caregiver Practices</span>
                            ) : (
                              <EditableSelect
                                value={it.ref ? `${it.ref.templateSlug}::${it.ref.checklistKey}` : null}
                                options={keyOpts}
                                allowEmpty
                                onSave={(v) => patch(c.id, (x) => {
                                  const item = x.categories[gi].items[ii];
                                  if (!v) delete item.ref;
                                  else { const [templateSlug, checklistKey] = v.split("::"); item.ref = { templateSlug, checklistKey }; }
                                })}
                              />
                            )}
                            <RowDelete onDelete={() => patch(c.id, (x) => { x.categories[gi].items.splice(ii, 1); })} />
                          </div>
                        ))}
                        <AddRow label="item" onClick={() => patch(c.id, (x) => { x.categories[gi].items.push({ text: "New item", completionType: "Activity", blocksSignoff: true }); })} />
                      </div>
                    )}
                  </div>
                );
              })}
              <AddRow label="category" onClick={() => patch(c.id, (x) => { (x.categories ??= []).push({ label: "New category", items: [] }); })} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
