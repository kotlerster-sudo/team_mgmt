"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Check, Lock, Circle, ClipboardList, MapPin, CalendarCheck,
  Plus, X, ClipboardCheck,
} from "lucide-react";
import { CaregiverPracticeCapture } from "@/components/caregiver/CaregiverPracticeCapture";

// ── Types (dates arrive as ISO strings across the server→client boundary) ─────
type FormField = { key: string; label?: string; text?: string; type?: string; options?: string[]; category?: string | null };
type SetupStep = {
  id: string; title: string; status: string; dueDate: string | null; blocked: boolean;
  blockedByTitle: string | null; overdue: boolean; formKind: string | null; formSchema: any; answers: any;
};
type VisitStep = { id: string; title: string; mandatory: boolean; formKind: string | null; formSchema: any; done: boolean; answers: any };
type Followup = { id: string; title: string; detail: string | null; dueDate: string | null; priority: string };
type Data = {
  id: string; title: string; domainLabel: string; phase: "setting_up" | "live" | "done";
  locationName: string; overallSlaAt: string | null; overallOverdue: boolean;
  setupDone: number; setupTotal: number; setupSteps: SetupStep[];
  visitRequired: number; visitDoneThisMonth: number; openVisit: { id: string; arrivedAt: string | null } | null;
  visitSteps: VisitStep[]; followups: Followup[];
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

export function InterventionDetail({ data }: { data: Data }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [formStep, setFormStep] = useState<{ kind: "setup" | "visit"; step: SetupStep | VisitStep } | null>(null);
  const [caregiverStepId, setCaregiverStepId] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Request failed");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const phaseChip =
    data.phase === "live"
      ? "bg-emerald-50 text-emerald-700"
      : data.phase === "setting_up"
      ? "bg-amber-50 text-amber-700"
      : "bg-stone-100 text-stone-500";

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-6">
      <div>
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700">
          <ChevronLeft size={16} /> Back
        </button>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
              <MapPin size={18} className="flex-shrink-0 text-stone-400" />
              <span className="truncate">{data.locationName}</span>
            </h1>
            <p className="mt-0.5 text-sm text-stone-500">{data.domainLabel} · {data.title}</p>
          </div>
          <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${phaseChip}`}>
            {data.phase === "setting_up" ? "Setting up" : data.phase === "live" ? "Live" : "Done"}
          </span>
        </div>
      </div>

      {data.phase === "setting_up" && <SetupView data={data} onOpenForm={(s) => setFormStep({ kind: "setup", step: s })} onComplete={(s) => post(`/api/field/step/${s.id}`, { action: s.status === "Done" ? "reopen" : "complete" })} busy={busy} />}
      {data.phase === "live" && (
        <LiveView
          data={data}
          post={post}
          onOpenForm={(s) => (s.formKind === "caregiver_practices" ? setCaregiverStepId(s.id) : setFormStep({ kind: "visit", step: s }))}
          busy={busy}
        />
      )}

      <FollowUpsPanel goalId={data.id} followups={data.followups} post={post} busy={busy} />

      {caregiverStepId && data.openVisit && (
        <CaregiverPracticeCapture
          goalId={data.id}
          visitEventId={data.openVisit.id}
          apiBase={`/api/field/visit/${data.id}/caregiver-practices`}
          idParam="fieldVisitId"
          onClose={() => setCaregiverStepId(null)}
          onSaved={async () => {
            await post(`/api/field/visit/${data.id}`, { action: "tick", stepId: caregiverStepId, done: true });
            setCaregiverStepId(null);
          }}
        />
      )}

      {formStep && (
        <StepFormModal
          step={formStep.step}
          onClose={() => setFormStep(null)}
          onSave={async (answers, complete) => {
            if (formStep.kind === "setup") {
              await post(`/api/field/step/${formStep.step.id}`, { action: complete ? "complete" : "save", answers });
            } else {
              await post(`/api/field/visit/${data.id}`, { action: "tick", stepId: formStep.step.id, done: complete, answers });
            }
            setFormStep(null);
          }}
        />
      )}
    </div>
  );
}

// ── Setting up: overall SLA + ordered steps ──────────────────────────────────
function SetupView({ data, onOpenForm, onComplete, busy }: { data: Data; onOpenForm: (s: SetupStep) => void; onComplete: (s: SetupStep) => void; busy: boolean }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
        <span className="text-sm text-stone-600">
          <span className="font-semibold text-stone-900">{data.setupDone}</span> of {data.setupTotal} steps done
        </span>
        {data.overallSlaAt && (
          <span className={`text-xs ${data.overallOverdue ? "font-medium text-red-600" : "text-stone-500"}`}>
            Overall SLA {fmtDate(data.overallSlaAt)}{data.overallOverdue ? " · passed" : ""}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {data.setupSteps.map((s, i) => {
          const done = s.status === "Done";
          return (
            <li key={s.id} className={`rounded-xl border p-3.5 ${s.blocked ? "border-stone-100 bg-stone-50" : "border-stone-200 bg-white"}`}>
              <div className="flex items-start gap-3">
                <button
                  disabled={busy || s.blocked}
                  onClick={() => onComplete(s)}
                  aria-label={done ? "Mark not done" : "Mark done"}
                  className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition ${
                    done ? "border-emerald-500 bg-emerald-500 text-white" : s.blocked ? "border-stone-200 text-stone-300" : "border-stone-300 text-transparent hover:border-emerald-400"
                  }`}
                >
                  {done ? <Check size={14} /> : s.blocked ? <Lock size={12} /> : <Circle size={8} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${done ? "text-stone-400 line-through" : "text-stone-900"}`}>
                    <span className="mr-1.5 text-xs text-stone-400">{i + 1}.</span>{s.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    {s.blocked && <span className="text-stone-400">Waiting on “{s.blockedByTitle}”</span>}
                    {!done && s.dueDate && <span className={s.overdue ? "font-medium text-red-600" : "text-stone-500"}>due {fmtDate(s.dueDate)}{s.overdue ? " · overdue" : ""}</span>}
                    {s.formKind && (
                      <button onClick={() => onOpenForm(s)} className="inline-flex items-center gap-1 font-medium text-stone-600 hover:text-stone-900">
                        <ClipboardList size={12} /> {s.formKind === "checklist" ? "Checklist" : s.formKind === "caregiver_practices" ? "Caregiver practices" : "Form"}
                        {answeredCount(s.answers)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Live: cadence + the current visit ─────────────────────────────────────────
function LiveView({ data, post, onOpenForm, busy }: { data: Data; post: (u: string, b: unknown) => Promise<void>; onOpenForm: (s: VisitStep) => void; busy: boolean }) {
  const behind = data.visitDoneThisMonth < data.visitRequired;
  const v = data.openVisit;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
        <span className="text-sm text-stone-600">
          <span className={`font-semibold ${behind ? "text-amber-700" : "text-stone-900"}`}>{data.visitDoneThisMonth}</span> of {data.visitRequired} visits this month
        </span>
        {!v && (
          <button disabled={busy} onClick={() => post(`/api/field/visit/${data.id}`, { action: "open" })} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
            Start visit
          </button>
        )}
      </div>

      {v && (
        <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-800">This visit</h3>
            {!v.arrivedAt ? (
              <button disabled={busy} onClick={() => post(`/api/field/visit/${data.id}`, { action: "arrive" })} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50">
                <MapPin size={12} /> I’ve reached
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CalendarCheck size={13} /> Arrived {fmtDate(v.arrivedAt)}</span>
            )}
          </div>
          <ul className="space-y-1.5">
            {data.visitSteps.map((s) => (
              <li key={s.id} className="flex items-start gap-3">
                <button
                  disabled={busy}
                  onClick={() => (s.formKind ? onOpenForm(s) : post(`/api/field/visit/${data.id}`, { action: "tick", stepId: s.id, done: !s.done }))}
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition ${s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-stone-300 text-transparent hover:border-emerald-400"}`}
                  aria-label={s.done ? "Mark not done" : "Mark done"}
                >
                  {s.done && <Check size={12} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${s.done ? "text-stone-400 line-through" : "text-stone-800"}`}>
                    {s.title}
                    {s.mandatory && !s.done && <span className="ml-1.5 text-[10px] font-medium text-stone-400">REQUIRED</span>}
                  </p>
                  {s.formKind && (
                    <button onClick={() => onOpenForm(s)} className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900">
                      <ClipboardList size={12} /> {s.formKind === "caregiver_practices" ? "Observe caregiver practices" : "Open form"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-stone-100 pt-3">
            <button disabled={busy} onClick={() => post(`/api/field/visit/${data.id}`, { action: "close" })} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              <ClipboardCheck size={15} /> Close visit
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Follow-ups ────────────────────────────────────────────────────────────────
function FollowUpsPanel({ goalId, followups, post, busy }: { goalId: string; followups: Followup[]; post: (u: string, b: unknown) => Promise<void>; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [urgent, setUrgent] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Follow-ups</h2>
        <button onClick={() => setAdding((a) => !a)} className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900">
          {adding ? <X size={13} /> : <Plus size={13} />} {adding ? "Cancel" : "Add"}
        </button>
      </div>

      {adding && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs following up?" className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400" />
          <div className="flex items-center gap-2">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border border-stone-200 px-2 py-1.5 text-sm text-stone-600 outline-none focus:border-stone-400" />
            <label className="inline-flex items-center gap-1.5 text-sm text-stone-600">
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
            </label>
            <button
              disabled={busy || !title.trim()}
              onClick={async () => { await post("/api/field/action-point", { goalId, title, dueDate: due ? new Date(due).toISOString() : null, priority: urgent ? "urgent" : "routine" }); setTitle(""); setDue(""); setUrgent(false); setAdding(false); }}
              className="ml-auto rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {followups.length === 0 ? (
        <p className="text-sm text-stone-400">Nothing pending.</p>
      ) : (
        <ul className="space-y-1.5">
          {followups.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-stone-800">{f.title}</p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                  {f.dueDate && <span>due {fmtDate(f.dueDate)}</span>}
                  {f.priority === "urgent" && <span className="font-medium text-red-600">Urgent</span>}
                </div>
              </div>
              <button disabled={busy} onClick={() => post(`/api/action-points/${f.id}/complete`, {})} className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50">
                Done
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Generic form modal: checklist / questionnaire / caregiver-practices ───────
function StepFormModal({ step, onClose, onSave }: { step: SetupStep | VisitStep; onClose: () => void; onSave: (answers: any, complete: boolean) => void | Promise<void> }) {
  const kind = step.formKind;
  const schema = step.formSchema ?? {};
  const [answers, setAnswers] = useState<any>(step.answers ?? (kind === "checklist" ? { checked: {} } : {}));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-stone-900">{step.title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={20} /></button>
        </div>

        {kind === "caregiver_practices" ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Caregiver-practices observation capture opens here. (Full observation grid — salvaged from the existing capture flow — wires in next.) For now, mark the step done once observed.
          </div>
        ) : kind === "checklist" ? (
          <ChecklistBody items={schema.items ?? []} answers={answers} setAnswers={setAnswers} />
        ) : (
          <div className="space-y-3">
            {(schema.fields ?? schema.items ?? []).map((f: FormField) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-sm font-medium text-stone-700">{f.label ?? f.text ?? f.key}</span>
                {f.type === "bool" ? (
                  <input type="checkbox" checked={!!answers[f.key]} onChange={(e) => setAnswers((a: any) => ({ ...a, [f.key]: e.target.checked }))} />
                ) : f.type === "select" ? (
                  <select value={answers[f.key] ?? ""} onChange={(e) => setAnswers((a: any) => ({ ...a, [f.key]: e.target.value }))} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400">
                    <option value="">—</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type === "number" ? "number" : "text"} value={answers[f.key] ?? ""} onChange={(e) => setAnswers((a: any) => ({ ...a, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400" />
                )}
              </label>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {kind !== "caregiver_practices" && (
            <button onClick={() => onSave(answers, false)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">Save</button>
          )}
          <button onClick={() => onSave(answers, true)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">Save & mark done</button>
        </div>
      </div>
    </div>
  );
}

// Checklist form body — groups items by category (e.g. Fire Safety) when present.
function ChecklistBody({ items, answers, setAnswers }: { items: FormField[]; answers: any; setAnswers: (fn: (a: any) => any) => void }) {
  const toggle = (key: string, val: boolean) => setAnswers((a: any) => ({ ...a, checked: { ...(a?.checked ?? {}), [key]: val } }));
  const groups = new Map<string, FormField[]>();
  for (const it of items) {
    const g = it.category ?? "";
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }
  const total = items.length;
  const done = items.filter((it) => answers?.checked?.[it.key]).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-stone-500">
        <span>{done} of {total} checked</span>
        <button onClick={() => setAnswers((a: any) => ({ ...a, checked: Object.fromEntries(items.map((it) => [it.key, true])) }))} className="font-medium text-stone-600 hover:text-stone-900">
          Mark all
        </button>
      </div>
      {[...groups.entries()].map(([cat, its]) => (
        <div key={cat || "_"}>
          {cat && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{cat}</p>}
          <ul className="space-y-0.5">
            {its.map((it) => (
              <li key={it.key}>
                <label className="flex items-start gap-2.5 rounded-lg px-1 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
                  <input type="checkbox" checked={!!answers?.checked?.[it.key]} onChange={(e) => toggle(it.key, e.target.checked)} className="mt-0.5" />
                  <span>{it.text ?? it.label ?? it.key}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function answeredCount(answers: any) {
  if (!answers?.checked) return null;
  const total = Object.keys(answers.checked).length;
  const done = Object.values(answers.checked).filter(Boolean).length;
  if (!total) return null;
  return <span className="text-stone-400"> ({done}/{total})</span>;
}
