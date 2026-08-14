"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, Loader2, ArchiveRestore } from "lucide-react";

export type JobInitial = {
  id: string;
  slug: string;
  title: string;
  seniority: string | null;
  locationId: string;
  dayToDay: string;
  mustHaves: string[];
  niceToHaves: string[];
  hardDisqualifiers: string[];
  salaryBand: string | null;
  theme: "football" | "neutral";
  notes: string;
  redFlagRules: string[];
  yellowFlagRules: string[];
  scrutiniseFor: string[];
  lockedAxes: string[];
  archivedAt: string | null;
};

const inputCls = "px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";
const labelCls = "block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5";
const sectionCls = "border border-stone-200 rounded-xl bg-white p-4 space-y-3";

function linesToArray(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}

export default function JobEditor({
  initial,
  locations,
  canEdit,
  canDelete,
}: {
  initial: JobInitial;
  locations: { id: string; city: string; state: string | null }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [seniority, setSeniority] = useState(initial.seniority ?? "");
  const [locationId, setLocationId] = useState(initial.locationId);
  const [dayToDay, setDayToDay] = useState(initial.dayToDay);
  const [mustHaves, setMustHaves] = useState(initial.mustHaves.join("\n"));
  const [niceToHaves, setNiceToHaves] = useState(initial.niceToHaves.join("\n"));
  const [hardDisqualifiers, setHardDisqualifiers] = useState(initial.hardDisqualifiers.join("\n"));
  const [salaryBand, setSalaryBand] = useState(initial.salaryBand ?? "");
  const [theme, setTheme] = useState<"football" | "neutral">(initial.theme);
  const [notes, setNotes] = useState(initial.notes);
  const [redFlagRules, setRedFlagRules] = useState(initial.redFlagRules.join("\n"));
  const [yellowFlagRules, setYellowFlagRules] = useState(initial.yellowFlagRules.join("\n"));
  const [scrutiniseFor, setScrutiniseFor] = useState(initial.scrutiniseFor.join("\n"));
  const [lockedAxes, setLockedAxes] = useState(initial.lockedAxes.join(", "));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const disabled = !canEdit || saving;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const axes = lockedAxes.split(",").map((x) => x.trim()).filter(Boolean);
      if (axes.length !== 0 && axes.length !== 6) throw new Error("Locked axes must be exactly 6 labels or empty");
      const res = await fetch(`/api/recruitment/jobs/${initial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          seniority: seniority || null,
          locationId,
          dayToDay,
          mustHaves: linesToArray(mustHaves),
          niceToHaves: linesToArray(niceToHaves),
          hardDisqualifiers: linesToArray(hardDisqualifiers),
          salaryBand: salaryBand.trim() || null,
          theme,
          notes,
          redFlagRules: linesToArray(redFlagRules),
          yellowFlagRules: linesToArray(yellowFlagRules),
          scrutiniseFor: linesToArray(scrutiniseFor),
          lockedAxes: axes,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null))?.error) || "Save failed");
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!confirm(`Archive JD "${initial.title}"? Existing scouting days keep their frozen snapshot; new ones won't be able to pick this JD.`)) return;
    await fetch(`/api/recruitment/jobs/${initial.id}`, { method: "DELETE" });
    router.push("/recruitment/jobs");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Basics */}
      <div className={sectionCls}>
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Basics</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Title *</label>
            <input className={inputCls + " w-full"} value={title} onChange={(e) => setTitle(e.target.value)} disabled={disabled} />
          </div>
          <div>
            <label className={labelCls}>Seniority</label>
            <select className={inputCls + " w-full"} value={seniority} onChange={(e) => setSeniority(e.target.value)} disabled={disabled}>
              <option value="">—</option>
              <option value="entry">entry</option>
              <option value="mid">mid</option>
              <option value="senior">senior</option>
              <option value="lead">lead</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Location *</label>
            <select className={inputCls + " w-full"} value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={disabled}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.city}{l.state ? ` · ${l.state}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Salary band (private)</label>
            <input className={inputCls + " w-full"} value={salaryBand} onChange={(e) => setSalaryBand(e.target.value)} disabled={disabled} placeholder="e.g. ₹22-28k/mo + travel" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Voice</label>
          <div className="flex gap-1.5">
            {(["football", "neutral"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => setTheme(t)}
                className={`px-2.5 py-1 text-xs rounded-full border disabled:opacity-40 ${theme === t ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600 hover:border-stone-300"}`}
              >
                {t === "football" ? "Football scout" : "Neutral"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Role */}
      <div className={sectionCls}>
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">The role</p>
        <div>
          <label className={labelCls}>What the role does day-to-day (markdown)</label>
          <textarea rows={6} className={inputCls + " w-full font-mono text-xs"} value={dayToDay} onChange={(e) => setDayToDay(e.target.value)} disabled={disabled} placeholder="Bullets or paragraphs describing the actual work." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Must-haves (one per line)</label>
            <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={mustHaves} onChange={(e) => setMustHaves(e.target.value)} disabled={disabled} />
          </div>
          <div>
            <label className={labelCls}>Nice-to-haves (one per line)</label>
            <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={niceToHaves} onChange={(e) => setNiceToHaves(e.target.value)} disabled={disabled} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Hard disqualifiers — instant no (one per line)</label>
          <textarea rows={3} className={inputCls + " w-full font-mono text-xs"} value={hardDisqualifiers} onChange={(e) => setHardDisqualifiers(e.target.value)} disabled={disabled} />
        </div>
        <div>
          <label className={labelCls}>Extra context (appended to prompt)</label>
          <textarea rows={3} className={inputCls + " w-full"} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} />
        </div>
      </div>

      {/* Rubric */}
      <div className={sectionCls}>
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Rubric (Phase 3 wiring — stored but not yet used)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Red flag rules (one per line)</label>
            <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={redFlagRules} onChange={(e) => setRedFlagRules(e.target.value)} disabled={disabled} placeholder="Role-specific red flags — override or extend defaults." />
          </div>
          <div>
            <label className={labelCls}>Yellow flag rules (one per line)</label>
            <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={yellowFlagRules} onChange={(e) => setYellowFlagRules(e.target.value)} disabled={disabled} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Scrutinise for (one per line)</label>
          <textarea rows={3} className={inputCls + " w-full font-mono text-xs"} value={scrutiniseFor} onChange={(e) => setScrutiniseFor(e.target.value)} disabled={disabled} />
        </div>
        <div>
          <label className={labelCls}>Locked radar axes (comma-separated, exactly 6 or leave blank)</label>
          <input className={inputCls + " w-full font-mono text-xs"} value={lockedAxes} onChange={(e) => setLockedAxes(e.target.value)} disabled={disabled} placeholder="FIELD, RANGE, DOCS, DEPTH, STABLE, LOCAL" />
          <p className="text-[10px] text-stone-400 mt-1">Blank = model picks 6 axes per pool. Setting axes unlocks cross-day comparability (Phase 3).</p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {canDelete && !initial.archivedAt && (
          <button
            onClick={archive}
            className="px-3 py-1.5 text-xs rounded-lg text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" /> Archive JD
          </button>
        )}
        {initial.archivedAt && (
          <span className="text-xs text-amber-600 inline-flex items-center gap-1">
            <ArchiveRestore className="w-3.5 h-3.5" /> Archived — unarchive via direct DB update
          </span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
        {savedAt && !error && <span className="text-xs text-emerald-600">Saved at {savedAt}</span>}
        {canEdit && (
          <button
            onClick={save}
            disabled={disabled || !title.trim() || !locationId}
            className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Save JD"}
          </button>
        )}
      </div>
    </div>
  );
}
