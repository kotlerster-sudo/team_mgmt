"use client";

/**
 * Full-screen caregiver-practice capture for a creche visit. Exception-based:
 * the RP drills Category → Subcategory → Practice and sets a status only on the
 * ones needing attention. Carried-forward flags from the last visit are shown
 * first for re-verification. Save posts the touched practices and (via onSaved)
 * lets the visit screen mark the launcher activity done.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, X, Camera, Check } from "lucide-react";

type Practice = { id: string; code: string; shortLabel: string; fullText: string; subcategory: string; trainingModule: number | null };
type Sub = { label: string; practices: Practice[] };
type Category = { id: string; code: string; name: string; practiceCount: number; subcategories: Sub[] };
type OpenFlag = {
  practiceId: string; code: string; shortLabel: string; categoryId: string; subcategory: string;
  prevStatus: string; prevRemarks: string | null; prevAction: string | null; lastCapturedAt: string;
};
type SavedObs = { practiceId: string; status: string; remarks: string | null; action: string | null; photoUrl: string | null };
type Answer = { status: string; remarks?: string; action?: string; photoUrl?: string };

const STATUS_OPTS: { v: string; label: string; cls: string; flag: boolean }[] = [
  { v: "OK", label: "OK", cls: "bg-emerald-500 text-white border-emerald-500", flag: false },
  { v: "NeedsImprovement", label: "Needs impr.", cls: "bg-amber-400 text-amber-950 border-amber-400", flag: true },
  { v: "NotPracticed", label: "Not done", cls: "bg-red-500 text-white border-red-500", flag: true },
  { v: "NotObserved", label: "Not obs.", cls: "bg-stone-400 text-white border-stone-400", flag: false },
  { v: "NotApplicable", label: "N/A", cls: "bg-stone-300 text-stone-700 border-stone-300", flag: false },
];
const ACTION_OPTS = [
  { v: "FeedbackOnSpot", label: "Feedback given" },
  { v: "RefresherPlanned", label: "Refresher" },
  { v: "EscalateToSupervisor", label: "Escalate" },
];
const isFlag = (v?: string) => STATUS_OPTS.find((s) => s.v === v)?.flag ?? false;

export function CaregiverPracticeCapture({
  goalId,
  visitEventId,
  onClose,
  onSaved,
  apiBase,
  idParam = "visitEventId",
}: {
  goalId: string;
  /** The visit id — a PitstopEvent id on /operations, a FieldVisit id on /field. */
  visitEventId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Route base (default = the /operations visit route). /field passes its own. */
  apiBase?: string;
  /** Query/body key for the visit id (default "visitEventId"; /field uses "fieldVisitId"). */
  idParam?: string;
}) {
  const base = apiBase ?? `/api/operations/visit/${goalId}/caregiver-practices`;
  const [categories, setCategories] = useState<Category[]>([]);
  const [openFlags, setOpenFlags] = useState<OpenFlag[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  const [subLabel, setSubLabel] = useState<string | null>(null);
  // Editable display labels (de-hardcoded). Falls back to the built-in labels if the fetch fails.
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/enum-labels?enumKey=CaregiverPracticeStatus").then((r) => r.json()).catch(() => []),
      fetch("/api/enum-labels?enumKey=CaregiverPracticeAction").then((r) => r.json()).catch(() => []),
    ]).then(([st, ac]) => {
      if (cancelled) return;
      const m: Record<string, string> = {};
      for (const row of [...(st ?? []), ...(ac ?? [])]) if (row?.code && row?.label) m[row.code] = row.label;
      setLabelMap(m);
    });
    return () => { cancelled = true; };
  }, []);

  const statusOpts = STATUS_OPTS.map((s) => ({ ...s, label: labelMap[s.v] ?? s.label }));
  const actionOpts = ACTION_OPTS.map((a) => ({ ...a, label: labelMap[a.v] ?? a.label }));
  const statusLabel = (v: string) => labelMap[v] ?? STATUS_OPTS.find((s) => s.v === v)?.label ?? v;

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}?${idParam}=${encodeURIComponent(visitEventId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCategories(d.categories ?? []);
        setOpenFlags(d.openFlags ?? []);
        const seed: Record<string, Answer> = {};
        for (const o of (d.thisVisit ?? []) as SavedObs[]) {
          seed[o.practiceId] = { status: o.status, remarks: o.remarks ?? undefined, action: o.action ?? undefined, photoUrl: o.photoUrl ?? undefined };
        }
        setAnswers(seed);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [goalId, visitEventId, base, idParam]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (catId || subLabel ? goBack() : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, subLabel, onClose]);

  const setStatus = (pid: string, status: string) =>
    setAnswers((a) => ({ ...a, [pid]: { ...a[pid], status } }));
  const patch = (pid: string, p: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [pid]: { ...a[pid], ...p } }));

  const uploadPhoto = useCallback(async (pid: string, file: File) => {
    setUploadingFor(pid);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.url) patch(pid, { photoUrl: d.url });
    } finally {
      setUploadingFor(null);
    }
  }, []);

  const answeredIds = useMemo(() => new Set(Object.entries(answers).filter(([, a]) => a.status).map(([id]) => id)), [answers]);
  const answeredInCat = useCallback(
    (c: Category) => c.subcategories.reduce((n, s) => n + s.practices.filter((p) => answeredIds.has(p.id)).length, 0),
    [answeredIds],
  );

  const save = async () => {
    setSaving(true);
    const observations = Object.entries(answers)
      .filter(([, a]) => a.status)
      .map(([practiceId, a]) => ({ practiceId, status: a.status, remarks: a.remarks || null, action: a.action || null, photoUrl: a.photoUrl || null }));
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [idParam]: visitEventId, observations }),
      });
      if (r.ok) onSaved();
      else setSaving(false);
    } catch {
      setSaving(false);
    }
  };

  function goBack() {
    if (subLabel) setSubLabel(null);
    else if (catId) setCatId(null);
  }

  const activeCat = categories.find((c) => c.id === catId) ?? null;
  const activeSub = activeCat?.subcategories.find((s) => s.label === subLabel) ?? null;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200 shrink-0">
        {(catId || subLabel) ? (
          <button onClick={goBack} className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500"><ChevronLeft className="w-5 h-5" /></button>
        ) : (
          <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500"><X className="w-5 h-5" /></button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900 truncate">
            {activeSub ? activeSub.label : activeCat ? activeCat.name : "Caregiver practices"}
          </p>
          {!catId && <p className="text-[11px] text-stone-400">Flag what needs attention · {answeredIds.size} noted</p>}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
        </button>
      </div>

      {loading ? (
        <div className="flex-1 grid place-items-center text-stone-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* HOME: open flags + category grid */}
          {!catId && (
            <div className="p-4 space-y-5">
              {openFlags.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Re-verify from last visit ({openFlags.length})
                  </p>
                  <div className="space-y-2">
                    {openFlags.map((f) => (
                      <div key={f.practiceId} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-stone-800">{f.shortLabel}</p>
                            <p className="text-[10px] text-stone-500">
                              Last: {statusLabel(f.prevStatus)}{f.prevRemarks ? ` — ${f.prevRemarks}` : ""}
                            </p>
                          </div>
                          <span className="text-[9px] text-stone-400 shrink-0">{new Date(f.lastCapturedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                        </div>
                        <div className="mt-2"><StatusPicker value={answers[f.practiceId]?.status} onChange={(v) => setStatus(f.practiceId, v)} opts={statusOpts} /></div>
                        {answers[f.practiceId]?.status && <SubForm pid={f.practiceId} answer={answers[f.practiceId]} patch={patch} onPhoto={uploadPhoto} uploading={uploadingFor === f.practiceId} actionOpts={actionOpts} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">Categories</p>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map((c) => {
                    const n = answeredInCat(c);
                    return (
                      <button key={c.id} onClick={() => setCatId(c.id)} className="rounded-xl border border-stone-200 bg-white p-3 text-left hover:border-stone-300">
                        <p className="text-sm font-medium text-stone-800">{c.name}</p>
                        <p className="text-[11px] text-stone-400">{c.practiceCount} practices{n > 0 && <span className="text-sky-600 font-medium"> · {n} noted</span>}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* CATEGORY: subcategory list */}
          {activeCat && !subLabel && (
            <div className="p-4 space-y-2">
              {activeCat.subcategories.map((s) => {
                const n = s.practices.filter((p) => answeredIds.has(p.id)).length;
                return (
                  <button key={s.label} onClick={() => setSubLabel(s.label)} className="w-full flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-3 text-left hover:border-stone-300">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-800">{s.label}</p>
                      <p className="text-[11px] text-stone-400">{s.practices.length} practices{n > 0 && <span className="text-sky-600 font-medium"> · {n} noted</span>}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-stone-300" />
                  </button>
                );
              })}
            </div>
          )}

          {/* SUBCATEGORY: practices */}
          {activeSub && (
            <div className="p-4 space-y-3">
              {activeSub.practices.map((p) => (
                <div key={p.id} className="rounded-xl border border-stone-200 bg-white p-3">
                  <p className="text-sm font-medium text-stone-800">{p.shortLabel}</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">{p.fullText}</p>
                  <div className="mt-2"><StatusPicker value={answers[p.id]?.status} onChange={(v) => setStatus(p.id, v)} opts={statusOpts} /></div>
                  {answers[p.id]?.status && <SubForm pid={p.id} answer={answers[p.id]} patch={patch} onPhoto={uploadPhoto} uploading={uploadingFor === p.id} actionOpts={actionOpts} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPicker({ value, onChange, opts }: { value?: string; onChange: (v: string) => void; opts: typeof STATUS_OPTS }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((s) => (
        <button
          key={s.v}
          onClick={() => onChange(s.v)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors ${value === s.v ? s.cls : "bg-white text-stone-600 border-stone-200 hover:border-stone-300"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function SubForm({
  pid, answer, patch, onPhoto, uploading, actionOpts,
}: {
  pid: string; answer: Answer; patch: (pid: string, p: Partial<Answer>) => void;
  onPhoto: (pid: string, file: File) => void; uploading: boolean; actionOpts: typeof ACTION_OPTS;
}) {
  // Remarks + action + photo only really matter for a flag, but allow on any status.
  const showDetail = isFlag(answer.status) || answer.remarks || answer.action || answer.photoUrl;
  if (!showDetail) return null;
  return (
    <div className="mt-2 space-y-2 border-t border-stone-100 pt-2">
      <textarea
        value={answer.remarks ?? ""}
        onChange={(e) => patch(pid, { remarks: e.target.value })}
        placeholder="What exactly was wrong? (optional)"
        rows={2}
        className="w-full text-xs rounded-lg border border-stone-200 px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-sky-300"
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        {actionOpts.map((a) => (
          <button
            key={a.v}
            onClick={() => patch(pid, { action: answer.action === a.v ? undefined : a.v })}
            className={`px-2 py-1 text-[11px] rounded-lg border ${answer.action === a.v ? "bg-sky-600 text-white border-sky-600" : "bg-white text-stone-600 border-stone-200"}`}
          >
            {a.label}
          </button>
        ))}
        <label className="px-2 py-1 text-[11px] rounded-lg border border-stone-200 text-stone-600 cursor-pointer inline-flex items-center gap-1 hover:border-stone-300">
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
          {answer.photoUrl ? "Photo ✓" : "Photo"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(pid, f); }} />
        </label>
      </div>
    </div>
  );
}
