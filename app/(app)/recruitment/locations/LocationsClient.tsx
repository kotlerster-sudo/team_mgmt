"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X, Check, Loader2 } from "lucide-react";

export type LocationRow = {
  id: string;
  slug: string;
  city: string;
  state: string | null;
  country: string;
  primaryLanguage: string | null;
  localReferenceOrgs: string[];
  localRedFlags: string[];
  mobilityDefault: string | null;
  notes: string;
  archivedAt: string | null;
  jobCount: number;
};

type Draft = {
  id?: string;
  city: string;
  state: string;
  country: string;
  primaryLanguage: string;
  localReferenceOrgs: string; // newline-joined for the textarea
  localRedFlags: string;      // newline-joined
  mobilityDefault: string;
  notes: string;
};

const inputCls = "px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";
const labelCls = "block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5";

function toDraft(row?: LocationRow): Draft {
  return {
    id: row?.id,
    city: row?.city ?? "",
    state: row?.state ?? "",
    country: row?.country ?? "IN",
    primaryLanguage: row?.primaryLanguage ?? "",
    localReferenceOrgs: (row?.localReferenceOrgs ?? []).join("\n"),
    localRedFlags: (row?.localRedFlags ?? []).join("\n"),
    mobilityDefault: row?.mobilityDefault ?? "",
    notes: row?.notes ?? "",
  };
}

function fromDraft(d: Draft) {
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  return {
    city: d.city.trim(),
    state: d.state.trim() || null,
    country: d.country.trim() || "IN",
    primaryLanguage: d.primaryLanguage.trim() || null,
    localReferenceOrgs: lines(d.localReferenceOrgs),
    localRedFlags: lines(d.localRedFlags),
    mobilityDefault: d.mobilityDefault.trim() || null,
    notes: d.notes,
  };
}

export default function LocationsClient({
  initial,
  canEdit,
  canCreate,
  canDelete,
}: {
  initial: LocationRow[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [rows] = useState<LocationRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const url = draft.id
        ? `/api/recruitment/locations/${draft.id}`
        : `/api/recruitment/locations`;
      const res = await fetch(url, {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fromDraft(draft)),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null))?.error) || "Save failed");
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (row: LocationRow) => {
    if (row.jobCount > 0) {
      alert(`Cannot archive — ${row.jobCount} JD${row.jobCount === 1 ? "" : "s"} still reference this location. Archive those first.`);
      return;
    }
    if (!confirm(`Archive location "${row.city}"? Existing JDs will keep their frozen JD snapshot; new JDs won't be able to pick it.`)) return;
    await fetch(`/api/recruitment/locations/${row.id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id}>
          {draft?.id === row.id ? (
            <LocationForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => { setDraft(null); setError(""); }} saving={saving} error={error} />
          ) : (
            <div className={`bg-white border border-stone-200 rounded-xl p-3 ${row.archivedAt ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-stone-800">{row.city}</span>
                    {row.state && <span className="text-xs text-stone-400">· {row.state}</span>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">{row.country}</span>
                    {row.primaryLanguage && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600">{row.primaryLanguage}</span>
                    )}
                    {row.archivedAt && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">archived</span>
                    )}
                    <span className="text-[10px] text-stone-400">
                      {row.jobCount} JD{row.jobCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {row.mobilityDefault && (
                    <p className="text-[11px] text-stone-500 mt-0.5">Mobility: {row.mobilityDefault}</p>
                  )}
                  {row.notes && (
                    <p className="text-[11px] text-stone-500 mt-1 whitespace-pre-wrap">{row.notes}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  {canEdit && (
                    <button onClick={() => setDraft(toDraft(row))} className="p-1.5 hover:bg-stone-50 rounded text-stone-400 hover:text-stone-600">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canDelete && !row.archivedAt && (
                    <button onClick={() => archive(row)} className="p-1.5 hover:bg-red-50 rounded text-stone-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      {rows.length === 0 && !draft && (
        <p className="text-sm text-stone-400 italic text-center py-8">No locations yet.</p>
      )}
      {draft && !draft.id ? (
        <LocationForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => { setDraft(null); setError(""); }} saving={saving} error={error} isNew />
      ) : (
        canCreate && (
          <button
            onClick={() => setDraft(toDraft())}
            className="flex items-center gap-2 w-full mt-2 px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-stone-300 hover:text-stone-700"
          >
            <Plus className="w-4 h-4" /> Add location
          </button>
        )
      )}
    </div>
  );
}

function LocationForm({
  draft, setDraft, onSave, onCancel, saving, error, isNew = false,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
  isNew?: boolean;
}) {
  return (
    <div className={`border rounded-xl p-4 space-y-3 ${isNew ? "bg-sky-50 border-sky-200" : "bg-stone-50 border-stone-200"}`}>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className={labelCls}>City *</label>
          <input autoFocus className={inputCls + " w-full"} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="Chennai" />
        </div>
        <div className="col-span-1">
          <label className={labelCls}>State</label>
          <input className={inputCls + " w-full"} value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} placeholder="Tamil Nadu" />
        </div>
        <div className="col-span-1">
          <label className={labelCls}>Country</label>
          <input className={inputCls + " w-full"} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="IN" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Primary language</label>
          <input className={inputCls + " w-full"} value={draft.primaryLanguage} onChange={(e) => setDraft({ ...draft, primaryLanguage: e.target.value })} placeholder="Tamil" />
        </div>
        <div>
          <label className={labelCls}>Mobility default</label>
          <input className={inputCls + " w-full"} value={draft.mobilityDefault} onChange={(e) => setDraft({ ...draft, mobilityDefault: e.target.value })} placeholder="own-two-wheeler" />
        </div>
      </div>
      <div>
        <label className={labelCls}>Local reference orgs (one per line)</label>
        <textarea
          rows={3}
          className={inputCls + " w-full font-mono text-xs"}
          value={draft.localReferenceOrgs}
          onChange={(e) => setDraft({ ...draft, localReferenceOrgs: e.target.value })}
          placeholder={"Anna University\nMS Swaminathan Research Foundation\n…"}
        />
      </div>
      <div>
        <label className={labelCls}>Local red flags (one per line)</label>
        <textarea
          rows={3}
          className={inputCls + " w-full font-mono text-xs"}
          value={draft.localRedFlags}
          onChange={(e) => setDraft({ ...draft, localRedFlags: e.target.value })}
          placeholder={"Zero prior Chennai residence for a coastal-humidity RP role\n…"}
        />
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea rows={2} className={inputCls + " w-full"} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Free-form location context appended to every JD's prompt." />
      </div>
      <div className="flex justify-end items-center gap-2 pt-1">
        {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">
          <X className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onSave}
          disabled={saving || !draft.city.trim()}
          className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
