"use client";

// Templates → pitstops → checklists → activities, edited as nested expandable rows. Edits mutate a
// local copy of the whole template and debounce-PUT the entire object to /api/admin/templates/[id]
// (which dual-writes JSON→relational). Full-object save keeps JSON + relational in lockstep.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditableText, EditableNumber, EditableSelect, RowDelete, AddRow, ExpandChevron } from "@/components/controlplane/cells";

type Activity = { title: string; completionType?: string; key?: string; dayOffset?: number };
type Checklist = { text: string; key?: string; completionType?: string; activities?: Activity[] };
type Pitstop = { title: string; type: string; notes?: string; slaDays?: number; startSlaDays?: number; recurrence?: string; repeatCount?: number; progressTag?: string; key?: string; checklist: Checklist[] };
type Template = { id: string; slug: string; name: string; description: string; category: string; icon: string; needsDomain: string | null; linkedFacilityLayerKey: string | null; sortOrder: number; parameters: unknown; pitstops: Pitstop[]; isActive: boolean };
type Opt = { value: string; label: string };

const CT: Opt[] = [{ value: "", label: "Checkbox" }, { value: "Activity", label: "Activity" }, { value: "Voice", label: "Voice" }, { value: "Upload", label: "Upload" }];
const RECUR: Opt[] = ["None", "Weekly", "Monthly", "Quarterly"].map((v) => ({ value: v, label: v }));
const PTYPE: Opt[] = ["Discussion", "Meeting", "Training", "Visit", "Review"].map((v) => ({ value: v, label: v }));

export default function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [domains, setDomains] = useState<Opt[]>([]);
  const [layers, setLayers] = useState<Opt[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { fetch("/api/admin/templates").then((r) => r.json()).then(setTemplates).catch(() => {}); }, []);
  useEffect(() => {
    fetch("/api/needs/formulas").then((r) => r.json()).then((r: { domain: string; label: string }[]) => setDomains((r ?? []).map((d) => ({ value: d.domain, label: d.label })))).catch(() => {});
    fetch("/api/admin/facility-layers").then((r) => r.json()).then((r: { layerKey: string; label: string }[]) => setLayers((r ?? []).map((l) => ({ value: l.layerKey, label: l.label })))).catch(() => {});
  }, []);

  const scheduleSave = (t: Template) => {
    clearTimeout(timers.current[t.id]);
    timers.current[t.id] = setTimeout(() => {
      fetch(`/api/admin/templates/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t) });
    }, 700);
  };
  const patch = (tid: string, mutate: (t: Template) => void) => {
    setTemplates((prev) => prev.map((t) => {
      if (t.id !== tid) return t;
      const next = structuredClone(t) as Template;
      mutate(next);
      scheduleSave(next);
      return next;
    }));
  };
  const tKey = (id: string, ...p: (string | number)[]) => `${id}:${p.join(":")}`;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-stone-400 mb-1">Goal templates → pitstops → checklists → activities. Edits autosave (~1s).</p>
      {templates.map((t) => (
        <div key={t.id} className="border border-stone-200 rounded-xl bg-white">
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setOpen((o) => ({ ...o, [t.id]: !o[t.id] }))}><ExpandChevron open={!!open[t.id]} /></button>
            <EditableText value={t.name} onSave={(v) => patch(t.id, (x) => { x.name = v; })} className="font-medium" />
            <EditableSelect value={t.needsDomain} options={domains} allowEmpty onSave={(v) => patch(t.id, (x) => { x.needsDomain = v; })} className="w-40" />
            <EditableSelect value={t.linkedFacilityLayerKey} options={layers} allowEmpty onSave={(v) => patch(t.id, (x) => { x.linkedFacilityLayerKey = v; })} className="w-40" />
            <span className="text-xs text-stone-400 shrink-0">{t.pitstops?.length ?? 0} pitstops</span>
          </div>
          {open[t.id] && (
            <div className="border-t border-stone-100 px-3 py-2 space-y-2">
              {(t.pitstops ?? []).map((p, pi) => {
                const pk = tKey(t.id, "p", pi);
                return (
                  <div key={pi} className="border border-stone-100 rounded-lg bg-stone-50/50">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <button onClick={() => setOpen((o) => ({ ...o, [pk]: !o[pk] }))}><ExpandChevron open={!!open[pk]} /></button>
                      <EditableText value={p.title} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].title = v; })} />
                      <EditableSelect value={p.type} options={PTYPE} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].type = v ?? "Discussion"; })} className="w-28" />
                      <EditableSelect value={p.recurrence ?? "None"} options={RECUR} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].recurrence = v ?? "None"; })} className="w-24" />
                      <span className="text-[10px] text-stone-400">SLA</span>
                      <EditableNumber value={p.slaDays ?? 0} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].slaDays = v ?? 0; })} className="w-14" />
                      <RowDelete onDelete={() => patch(t.id, (x) => { x.pitstops.splice(pi, 1); })} />
                    </div>
                    {open[pk] && (
                      <div className="px-3 pb-2 space-y-1">
                        {(p.checklist ?? []).map((c, ci) => {
                          const ck = tKey(t.id, "p", pi, "c", ci);
                          return (
                            <div key={ci} className="border-l-2 border-stone-200 pl-2">
                              <div className="flex items-center gap-2 py-0.5">
                                <button onClick={() => setOpen((o) => ({ ...o, [ck]: !o[ck] }))}><ExpandChevron open={!!open[ck]} /></button>
                                <EditableText value={c.text} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].checklist[ci].text = v; })} />
                                <EditableSelect value={c.completionType ?? ""} options={CT} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].checklist[ci].completionType = v ?? ""; })} className="w-24" />
                                <RowDelete onDelete={() => patch(t.id, (x) => { x.pitstops[pi].checklist.splice(ci, 1); })} />
                              </div>
                              {open[ck] && (
                                <div className="pl-5 py-0.5 space-y-1">
                                  {(c.activities ?? []).map((a, ai) => (
                                    <div key={ai} className="flex items-center gap-2">
                                      <span className="text-stone-300 text-xs">•</span>
                                      <EditableText value={a.title} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].checklist[ci].activities![ai].title = v; })} />
                                      <EditableSelect value={a.completionType ?? "Activity"} options={CT} onSave={(v) => patch(t.id, (x) => { x.pitstops[pi].checklist[ci].activities![ai].completionType = v ?? "Activity"; })} className="w-24" />
                                      <RowDelete onDelete={() => patch(t.id, (x) => { x.pitstops[pi].checklist[ci].activities!.splice(ai, 1); })} />
                                    </div>
                                  ))}
                                  <AddRow label="activity" onClick={() => patch(t.id, (x) => { const cl = x.pitstops[pi].checklist[ci]; (cl.activities ??= []).push({ title: "New activity", completionType: "Activity" }); })} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <AddRow label="checklist item" onClick={() => patch(t.id, (x) => { x.pitstops[pi].checklist.push({ text: "New checklist item", completionType: "Activity", activities: [] }); })} />
                      </div>
                    )}
                  </div>
                );
              })}
              <AddRow label="pitstop" onClick={() => patch(t.id, (x) => { (x.pitstops ??= []).push({ title: "New pitstop", type: "Discussion", checklist: [] }); })} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
