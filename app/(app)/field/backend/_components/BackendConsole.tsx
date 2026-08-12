"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Plus, Trash2, ArrowUp, ArrowDown, RefreshCw, Database } from "lucide-react";

type SetupRow = { id: string; order: number; stepKey: string; title: string; slaDays: number | null; startSlaDays: number | null; blockedByKey: string | null; formKind: string | null; formItemCount: number };
type VisitRow = { id: string; order: number; stepKey: string; title: string; mandatory: boolean; formKind: string | null; formItemCount: number };
type Domain = {
  config: { domain: string; label: string; unit: string; overallSlaDays: number | null; cadenceCount: number | null; cadencePeriod: string | null; hasLivePhase: boolean; isActive: boolean };
  setupSteps: SetupRow[]; visitSteps: VisitRow[];
  counts: { interventions: number; setupSteps: number; visitRecipe: number; visits: number; openFollowups: number };
};

const FORM_KINDS = ["", "checklist", "questionnaire", "caregiver_practices"];

export function BackendConsole({ domains }: { domains: Domain[] }) {
  const router = useRouter();
  const [active, setActive] = useState(domains[0]?.config.domain ?? "");
  const [busy, setBusy] = useState(false);
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
        <p className="pt-1 text-stone-400">Template edits apply to new interventions. Use “Resync visit recipe” to push visit-step edits onto existing live interventions.</p>
      </div>

      {/* Domain tabs */}
      {domains.length > 1 && (
        <div className="flex gap-2">
          {domains.map((dm) => (
            <button key={dm.config.domain} onClick={() => setActive(dm.config.domain)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${dm.config.domain === active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"}`}>{dm.config.label}</button>
          ))}
        </div>
      )}

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
        <h2 className="text-sm font-semibold text-stone-700">Domain config <span className="ml-1 font-mono text-xs text-stone-400">{d.config.domain}</span></h2>
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
          <button disabled={busy} onClick={() => addStep("setup")} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"><Plus size={13} /> Add</button>
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
                  <td className="px-2"><FormSelect value={s.formKind} onChange={(v) => patchStep("setup", s.id, { formKind: v })} count={s.formItemCount} /></td>
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
                  <td className="px-2"><FormSelect value={s.formKind} onChange={(v) => patchStep("visit", s.id, { formKind: v })} count={s.formItemCount} /></td>
                  <td className="px-2"><button disabled={busy} onClick={() => confirm("Delete this step?") && delStep("visit", s.id)} className="text-stone-300 hover:text-red-500"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style>{`.inp{height:2.25rem;width:100%;border:1px solid rgb(231 229 228);border-radius:0.5rem;padding:0 0.6rem;font-size:0.875rem;outline:none}.inp:focus{border-color:rgb(168 162 158)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>{children}</label>;
}

function FormSelect({ value, onChange, count }: { value: string | null; onChange: (v: string | null) => void; count: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <select defaultValue={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="rounded border border-transparent px-1 py-0.5 hover:border-stone-200 focus:border-stone-300 focus:outline-none">
        {FORM_KINDS.map((k) => <option key={k} value={k}>{k || "—"}</option>)}
      </select>
      {count > 0 && <span className="text-[10px] text-stone-400">{count}</span>}
    </span>
  );
}
