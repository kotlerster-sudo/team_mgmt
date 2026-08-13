"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Plus, Trash2, ArrowUp, ArrowDown, RefreshCw, Database, X, ListChecks, Users } from "lucide-react";

type SetupRow = { id: string; order: number; stepKey: string; title: string; slaDays: number | null; startSlaDays: number | null; blockedByKey: string | null; formKind: string | null; formSchema: any };
type VisitRow = { id: string; order: number; stepKey: string; title: string; mandatory: boolean; formKind: string | null; formSchema: any };
type Domain = {
  config: { domain: string; label: string; unit: string; overallSlaDays: number | null; cadenceCount: number | null; cadencePeriod: string | null; hasLivePhase: boolean; isActive: boolean };
  setupSteps: SetupRow[]; visitSteps: VisitRow[];
  counts: { interventions: number; setupSteps: number; visitRecipe: number; visits: number; openFollowups: number };
};

const FORM_KINDS = ["", "checklist", "questionnaire", "caregiver_practices"];

export function BackendConsole({ domains, available }: { domains: Domain[]; available: { domain: string; label: string; unit: string }[] }) {
  const router = useRouter();
  const [active, setActive] = useState(domains[0]?.config.domain ?? "");
  const [busy, setBusy] = useState(false);
  const [formEditor, setFormEditor] = useState<{ kind: "setup" | "visit"; step: SetupRow | VisitRow } | null>(null);
  const [addingDomain, setAddingDomain] = useState(false);
  const d = domains.find((x) => x.config.domain === active) ?? domains[0];

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed");
      const j = await res.json().catch(() => ({}));
      router.refresh();
      return j;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div className="p-6 text-sm text-stone-500">No domains configured.</div>;
  const patchDomain = (body: unknown) => call(`/api/field/admin/domain/${d.config.domain}`, "PATCH", body);
  const patchStep = (kind: "setup" | "visit", id: string, body: unknown) => call(`/api/field/admin/step/${id}`, "PATCH", { kind, ...(body as object) });
  const delStep = (kind: "setup" | "visit", id: string) => call(`/api/field/admin/step/${id}?kind=${kind}`, "DELETE");
  const addStep = (kind: "setup" | "visit") => call(`/api/field/admin/step`, "POST", { op: "create", kind, domain: d.config.domain, title: "New step" });
  const reorder = (kind: "setup" | "visit", ids: string[]) => call(`/api/field/admin/step`, "POST", { op: "reorder", kind, domain: d.config.domain, orderedIds: ids });

  const move = (kind: "setup" | "visit", rows: { id: string }[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    reorder(kind, ids);
  };

  return (
    <div className="max-w-4xl mx-auto px-5 py-6 space-y-6">
      <div>
        <Link href="/field" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"><ChevronLeft size={16} /> Field</Link>
        <h1 className="mt-2 flex items-center gap-2 text-lg font-semibold text-stone-900"><Database size={18} className="text-stone-400" /> Field backend</h1>
        <p className="mt-0.5 text-sm text-stone-500">The config that drives the RP frontend. Six tables, all editable here.</p>
      </div>

      {/* Model legend */}
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600 space-y-1">
        <p><b>FieldDomainConfig</b> → per-domain cadence, overall SLA, geo unit.</p>
        <p><b>SetupStepTemplate</b> → ordered setup steps (SLA + blocked-by + form) → materialise into <b>FieldStep(Setup)</b>.</p>
        <p><b>VisitStepTemplate</b> → recurring visit steps (mandatory + form) → materialise into <b>FieldStep(Visit)</b>.</p>
        <p><b>FieldVisit</b> / <b>FieldVisitStep</b> → each cadence visit + its per-step ticks.</p>
        <p className="pt-1 text-stone-400">Template edits apply to new interventions. Use “Resync to live” to push edits onto existing interventions.</p>
      </div>

      {/* Shared catalogs / actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/field/backend/caregiver" className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"><Users size={14} /> Caregiver practices</Link>
      </div>

      {/* Domain tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {domains.map((dm) => (
          <button key={dm.config.domain} onClick={() => setActive(dm.config.domain)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${dm.config.domain === active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"} ${!dm.config.isActive ? "opacity-50" : ""}`}>{dm.config.label}</button>
        ))}
        <button onClick={() => setAddingDomain(true)} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-500 hover:bg-stone-50"><Plus size={14} /> Add domain</button>
      </div>

      {/* Live-data snapshot */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[["Interventions", d.counts.interventions], ["Setup steps", d.counts.setupSteps], ["Visit recipe", d.counts.visitRecipe], ["Visits logged", d.counts.visits], ["Open follow-ups", d.counts.openFollowups]].map(([l, v]) => (
          <div key={l as string} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-center">
            <div className="text-lg font-semibold text-stone-900">{v as number}</div>
            <div className="text-[11px] text-stone-500">{l as string}</div>
          </div>
        ))}
      </div>

      {/* Domain config */}
      <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">Domain config <span className="ml-1 font-mono text-xs text-stone-400">{d.config.domain}</span></h2>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-stone-500"><input type="checkbox" defaultChecked={d.config.isActive} onChange={(e) => patchDomain({ isActive: e.target.checked })} /> active</label>
            <button disabled={busy} onClick={async () => { if (!confirm(`Delete domain "${d.config.label}"? Only works if it has no interventions.`)) return; const r = await call(`/api/field/admin/domain/${d.config.domain}`, "DELETE"); if (r?.ok) setActive(domains.find((x) => x.config.domain !== d.config.domain)?.config.domain ?? ""); }} className="text-stone-400 hover:text-red-500">Delete</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Label"><input defaultValue={d.config.label} onBlur={(e) => e.target.value !== d.config.label && patchDomain({ label: e.target.value })} className="inp" /></Field>
          <Field label="Geo unit"><select defaultValue={d.config.unit} onChange={(e) => patchDomain({ unit: e.target.value })} className="inp"><option value="settlement">settlement</option><option value="cluster">cluster</option></select></Field>
          <Field label="Overall SLA (days)"><input type="number" defaultValue={d.config.overallSlaDays ?? ""} onBlur={(e) => patchDomain({ overallSlaDays: e.target.value === "" ? null : Number(e.target.value) })} className="inp" /></Field>
          <Field label="Cadence count"><input type="number" defaultValue={d.config.cadenceCount ?? ""} onBlur={(e) => patchDomain({ cadenceCount: e.target.value === "" ? null : Number(e.target.value) })} className="inp" /></Field>
          <Field label="Cadence period"><select defaultValue={d.config.cadencePeriod ?? ""} onChange={(e) => patchDomain({ cadencePeriod: e.target.value || null })} className="inp"><option value="">—</option><option value="week">week</option><option value="month">month</option></select></Field>
          <Field label="Has live phase"><label className="flex h-9 items-center gap-2 text-sm text-stone-600"><input type="checkbox" defaultChecked={d.config.hasLivePhase} onChange={(e) => patchDomain({ hasLivePhase: e.target.checked })} /> live cadence</label></Field>
        </div>
      </section>

      {/* Setup steps */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">Setup steps <span className="text-stone-400">({d.setupSteps.length})</span></h2>
          <div className="flex gap-2">
            <button disabled={busy} onClick={async () => { if (!confirm("Push setup-template changes onto existing interventions? Completion state is preserved.")) return; const r = await call(`/api/field/admin/resync-setup`, "POST", { domain: d.config.domain }); if (r?.ok) alert(`Resynced ${r.goals} interventions · +${r.added} / ~${r.updated} / -${r.removed}`); }} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"><RefreshCw size={12} /> Resync to live</button>
            <button disabled={busy} onClick={() => addStep("setup")} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"><Plus size={13} /> Add</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-stone-100 text-left text-[11px] uppercase text-stone-400">
              <th className="px-2 py-2">#</th><th className="px-2">Title</th><th className="px-2">SLA</th><th className="px-2">Start</th><th className="px-2">Blocked by</th><th className="px-2">Form</th><th className="px-2"></th>
            </tr></thead>
            <tbody>
              {d.setupSteps.map((s, i) => (
                <tr key={s.id} className="border-b border-stone-50">
                  <td className="px-2 py-1.5 whitespace-nowrap text-stone-400">
                    <span className="mr-1">{i + 1}</span>
                    <button disabled={busy || i === 0} onClick={() => move("setup", d.setupSteps, i, -1)} className="text-stone-300 hover:text-stone-600 disabled:opacity-30"><ArrowUp size={12} /></button>
                    <button disabled={busy || i === d.setupSteps.length - 1} onClick={() => move("setup", d.setupSteps, i, 1)} className="text-stone-300 hover:text-stone-600 disabled:opacity-30"><ArrowDown size={12} /></button>
                  </td>
                  <td className="px-2"><input defaultValue={s.title} onBlur={(e) => e.target.value !== s.title && patchStep("setup", s.id, { title: e.target.value })} className="w-56 rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none" /></td>
                  <td className="px-2"><input type="number" defaultValue={s.slaDays ?? ""} onBlur={(e) => patchStep("setup", s.id, { slaDays: e.target.value === "" ? null : Number(e.target.value) })} className="w-14 rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none" /></td>
                  <td className="px-2"><input type="number" defaultValue={s.startSlaDays ?? ""} onBlur={(e) => patchStep("setup", s.id, { startSlaDays: e.target.value === "" ? null : Number(e.target.value) })} className="w-14 rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none" /></td>
                  <td className="px-2">
                    <select defaultValue={s.blockedByKey ?? ""} onChange={(e) => patchStep("setup", s.id, { blockedByKey: e.target.value || null })} className="max-w-[10rem] rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none">
                      <option value="">—</option>
                      {d.setupSteps.filter((o) => o.id !== s.id).map((o) => <option key={o.id} value={o.stepKey}>{o.title}</option>)}
                    </select>
                  </td>
                  <td className="px-2"><FormCell value={s.formKind} schema={s.formSchema} onChange={(v) => patchStep("setup", s.id, { formKind: v })} onEdit={() => setFormEditor({ kind: "setup", step: s })} /></td>
                  <td className="px-2"><button disabled={busy} onClick={() => confirm("Delete this step?") && delStep("setup", s.id)} className="text-stone-300 hover:text-red-500"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Visit steps */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">Visit steps <span className="text-stone-400">({d.visitSteps.length})</span></h2>
          <div className="flex gap-2">
            <button disabled={busy} onClick={async () => { const r = await call(`/api/field/admin/resync-visit`, "POST", { domain: d.config.domain }); if (r?.ok) alert(`Resynced ${r.goals} interventions · +${r.added} / ~${r.updated} / -${r.removed}`); }} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"><RefreshCw size={12} /> Resync to live</button>
            <button disabled={busy} onClick={() => addStep("visit")} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"><Plus size={13} /> Add</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-stone-100 text-left text-[11px] uppercase text-stone-400">
              <th className="px-2 py-2">#</th><th className="px-2">Title</th><th className="px-2">Required</th><th className="px-2">Form</th><th className="px-2"></th>
            </tr></thead>
            <tbody>
              {d.visitSteps.map((s, i) => (
                <tr key={s.id} className="border-b border-stone-50">
                  <td className="px-2 py-1.5 whitespace-nowrap text-stone-400">
                    <span className="mr-1">{i + 1}</span>
                    <button disabled={busy || i === 0} onClick={() => move("visit", d.visitSteps, i, -1)} className="text-stone-300 hover:text-stone-600 disabled:opacity-30"><ArrowUp size={12} /></button>
                    <button disabled={busy || i === d.visitSteps.length - 1} onClick={() => move("visit", d.visitSteps, i, 1)} className="text-stone-300 hover:text-stone-600 disabled:opacity-30"><ArrowDown size={12} /></button>
                  </td>
                  <td className="px-2"><input defaultValue={s.title} onBlur={(e) => e.target.value !== s.title && patchStep("visit", s.id, { title: e.target.value })} className="w-64 rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none" /></td>
                  <td className="px-2"><input type="checkbox" defaultChecked={s.mandatory} onChange={(e) => patchStep("visit", s.id, { mandatory: e.target.checked })} /></td>
                  <td className="px-2"><FormCell value={s.formKind} schema={s.formSchema} onChange={(v) => patchStep("visit", s.id, { formKind: v })} onEdit={() => setFormEditor({ kind: "visit", step: s })} /></td>
                  <td className="px-2"><button disabled={busy} onClick={() => confirm("Delete this step?") && delStep("visit", s.id)} className="text-stone-300 hover:text-red-500"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {addingDomain && (
        <AddDomainModal
          available={available}
          busy={busy}
          onClose={() => setAddingDomain(false)}
          onCreate={async (body) => { const r = await call(`/api/field/admin/domain`, "POST", body); if (r?.ok) { setActive(r.domain); setAddingDomain(false); } }}
        />
      )}

      {formEditor && (
        <FormItemsModal
          step={formEditor.step}
          kind={formEditor.kind}
          busy={busy}
          onClose={() => setFormEditor(null)}
          onSave={async (schema) => { await patchStep(formEditor.kind, formEditor.step.id, { formSchema: schema }); setFormEditor(null); }}
        />
      )}

      <style>{`.inp{height:2.25rem;width:100%;border:1px solid rgb(231 229 228);border-radius:0.5rem;padding:0 0.6rem;font-size:0.875rem;outline:none}.inp:focus{border-color:rgb(168 162 158)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>{children}</label>;
}

// Create a new /field domain. Pick a needsDomain (so interventions link) or type one.
function AddDomainModal({ available, busy, onClose, onCreate }: { available: { domain: string; label: string; unit: string }[]; busy: boolean; onClose: () => void; onCreate: (body: unknown) => void }) {
  const [domain, setDomain] = useState(available[0]?.domain ?? "");
  const picked = available.find((a) => a.domain === domain);
  const [label, setLabel] = useState(available[0]?.label ?? "");
  const [unit, setUnit] = useState(available[0]?.unit ?? "settlement");
  const [cadenceCount, setCadenceCount] = useState<string>("1");
  const [cadencePeriod, setCadencePeriod] = useState("month");
  const [overallSlaDays, setOverallSlaDays] = useState<string>("");
  const [hasLivePhase, setHasLivePhase] = useState(true);

  const onPick = (dm: string) => {
    setDomain(dm);
    const a = available.find((x) => x.domain === dm);
    if (a) { setLabel(a.label); setUnit(a.unit); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between"><h3 className="text-base font-semibold text-stone-900">Add domain</h3><button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={20} /></button></div>
        <div className="space-y-3">
          <Field label="Domain (needsDomain key)">
            {available.length > 0 ? (
              <select value={domain} onChange={(e) => onPick(e.target.value)} className="inp">{available.map((a) => <option key={a.domain} value={a.domain}>{a.label} ({a.domain})</option>)}</select>
            ) : (
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. ChildrenCentre" className="inp" />
            )}
          </Field>
          <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} className="inp" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Geo unit"><select value={unit} onChange={(e) => setUnit(e.target.value)} className="inp"><option value="settlement">settlement</option><option value="cluster">cluster</option></select></Field>
            <Field label="Overall SLA (days)"><input type="number" value={overallSlaDays} onChange={(e) => setOverallSlaDays(e.target.value)} className="inp" /></Field>
            <Field label="Cadence count"><input type="number" value={cadenceCount} onChange={(e) => setCadenceCount(e.target.value)} className="inp" /></Field>
            <Field label="Cadence period"><select value={cadencePeriod} onChange={(e) => setCadencePeriod(e.target.value)} className="inp"><option value="month">month</option><option value="week">week</option></select></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={hasLivePhase} onChange={(e) => setHasLivePhase(e.target.checked)} /> has a live (visit) phase {picked ? `— ${picked.label}` : ""}</label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Cancel</button>
          <button disabled={busy || !domain} onClick={() => onCreate({ domain, label, unit, cadenceCount: cadenceCount === "" ? null : Number(cadenceCount), cadencePeriod, overallSlaDays: overallSlaDays === "" ? null : Number(overallSlaDays), hasLivePhase })} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">Create</button>
        </div>
      </div>
    </div>
  );
}

function FormCell({ value, schema, onChange, onEdit }: { value: string | null; schema: any; onChange: (v: string | null) => void; onEdit: () => void }) {
  const count = schema?.items?.length ?? schema?.fields?.length ?? 0;
  const editable = value === "checklist" || value === "questionnaire";
  return (
    <span className="inline-flex items-center gap-1">
      <select defaultValue={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none">
        {FORM_KINDS.map((k) => <option key={k} value={k}>{k || "—"}</option>)}
      </select>
      {(editable || value === "caregiver_practices") && (
        <button onClick={onEdit} title="Edit form" className="inline-flex items-center gap-0.5 rounded border border-stone-200 px-1 py-0.5 text-[10px] text-stone-500 hover:bg-stone-50">
          <ListChecks size={11} />{count > 0 ? count : ""}
        </button>
      )}
    </span>
  );
}

// Editor for a step's form contents. Checklist → items (text/category/non-neg/NA);
// questionnaire → fields; caregiver_practices → managed in the practices catalog.
function FormItemsModal({ step, kind, busy, onClose, onSave }: { step: SetupRow | VisitRow; kind: "setup" | "visit"; busy: boolean; onClose: () => void; onSave: (schema: any) => void }) {
  const formKind = step.formKind;
  const [schema, setSchema] = useState<any>(() => JSON.parse(JSON.stringify(step.formSchema ?? (formKind === "checklist" ? { scored: false, items: [] } : { fields: [] }))));

  const items: any[] = schema.items ?? [];
  const fields: any[] = schema.fields ?? [];
  const setItems = (next: any[]) => setSchema((s: any) => ({ ...s, items: next }));
  const setFields = (next: any[]) => setSchema((s: any) => ({ ...s, fields: next }));
  const slugify = (t: string, i: number) => (t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `item-${i}`);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-stone-900">{step.title}</h3>
            <p className="text-xs text-stone-500">Form: {formKind}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={20} /></button>
        </div>

        {formKind === "caregiver_practices" ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Caregiver-practice items are a shared catalog (categories → practices), not per-step.
            Edit them in <a href="/field/backend/caregiver" className="font-medium underline">Backend → Caregiver practices</a>.
            This step just launches that catalog during a visit.
          </div>
        ) : formKind === "checklist" ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <input type="checkbox" checked={!!schema.scored} onChange={(e) => setSchema((s: any) => ({ ...s, scored: e.target.checked }))} />
              Scored (OK / Fail / N-A per item; a failed non-negotiable raises a follow-up)
            </label>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded-lg border border-stone-100 p-2">
                  <span className="mt-1.5 text-xs text-stone-300">{i + 1}</span>
                  <div className="flex-1 space-y-1">
                    <input value={it.text ?? ""} placeholder="Item text" onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, text: e.target.value, key: x.key || slugify(e.target.value, i) } : x))} className="w-full rounded border border-stone-200 px-2 py-1 text-sm outline-none focus:border-stone-400" />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <input value={it.category ?? ""} placeholder="Category" onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} className="w-40 rounded border border-stone-200 px-2 py-0.5 outline-none focus:border-stone-400" />
                      {schema.scored && <label className="flex items-center gap-1"><input type="checkbox" checked={!!it.nonNegotiable} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, nonNegotiable: e.target.checked } : x))} /> non-neg</label>}
                      {schema.scored && <label className="flex items-center gap-1"><input type="checkbox" checked={!!it.naAllowed} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, naAllowed: e.target.checked } : x))} /> N/A ok</label>}
                    </div>
                  </div>
                  <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="mt-1 text-stone-300 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setItems([...items, { key: `item-${items.length + 1}`, text: "", category: "" }])} className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900"><Plus size={13} /> Add item</button>
          </div>
        ) : (
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-lg border border-stone-100 p-2">
                <div className="flex-1 space-y-1">
                  <input value={f.label ?? ""} placeholder="Question / label" onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, label: e.target.value, key: x.key || slugify(e.target.value, i) } : x))} className="w-full rounded border border-stone-200 px-2 py-1 text-sm outline-none focus:border-stone-400" />
                  <div className="flex items-center gap-2 text-xs">
                    <select value={f.type ?? "text"} onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="rounded border border-stone-200 px-1 py-0.5">
                      {["text", "number", "bool", "select"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {f.type === "select" && <input value={(f.options ?? []).join(", ")} placeholder="option a, option b" onChange={(e) => setFields(fields.map((x, j) => j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) } : x))} className="flex-1 rounded border border-stone-200 px-2 py-0.5 outline-none focus:border-stone-400" />}
                  </div>
                </div>
                <button onClick={() => setFields(fields.filter((_, j) => j !== i))} className="mt-1 text-stone-300 hover:text-red-500"><Trash2 size={13} /></button>
              </div>
            ))}
            <button onClick={() => setFields([...fields, { key: `q-${fields.length + 1}`, label: "", type: "text" }])} className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900"><Plus size={13} /> Add question</button>
          </div>
        )}

        {formKind !== "caregiver_practices" && (
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Cancel</button>
            <button disabled={busy} onClick={() => onSave(schema)} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">Save form</button>
          </div>
        )}
      </div>
    </div>
  );
}
