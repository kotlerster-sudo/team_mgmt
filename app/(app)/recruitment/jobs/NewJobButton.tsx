"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Plus, X, Check, Loader2, FileUp, Sparkles, AlertTriangle, Wand2 } from "lucide-react";

const inputCls = "px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";
const labelCls = "block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5";

type LocationOption = { id: string; city: string; state: string | null };

type ExtractedFields = {
  title: string;
  seniority: "" | "entry" | "mid" | "senior" | "lead";
  locationHint: string;
  dayToDay: string;
  mustHaves: string[];
  niceToHaves: string[];
  hardDisqualifiers: string[];
  salaryBand: string;
  theme: "football" | "neutral";
  notes: string;
  redFlagRules: string[];
  yellowFlagRules: string[];
  scrutiniseFor: string[];
};

type Extracted = {
  fields: ExtractedFields;
  notes: string;
  lowConfidenceFields: string[];
  sourceDocUrl: string;
  sourceDocName: string;
};

type Mode = { kind: "closed" } | { kind: "manual" } | { kind: "upload" } | { kind: "review"; extracted: Extracted };

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export default function NewJobButton({ locations }: { locations: LocationOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "closed" });

  if (mode.kind === "closed") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode({ kind: "manual" })}
          className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-stone-300 hover:text-stone-700"
        >
          <Plus className="w-4 h-4" /> New JD (manual)
        </button>
        <button
          onClick={() => setMode({ kind: "upload" })}
          className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-sky-200 rounded-xl text-sm text-sky-600 hover:border-sky-300 hover:bg-sky-50/40"
        >
          <Wand2 className="w-4 h-4" /> Upload JD & auto-fill
        </button>
      </div>
    );
  }

  if (mode.kind === "manual") {
    return <ManualForm locations={locations} onCancel={() => setMode({ kind: "closed" })} onCreated={(slug) => router.push(`/recruitment/jobs/${slug}`)} />;
  }

  if (mode.kind === "upload") {
    return (
      <UploadPanel
        onCancel={() => setMode({ kind: "closed" })}
        onExtracted={(extracted) => setMode({ kind: "review", extracted })}
      />
    );
  }

  return (
    <ReviewPanel
      extracted={mode.extracted}
      locations={locations}
      onBack={() => setMode({ kind: "upload" })}
      onCancel={() => setMode({ kind: "closed" })}
      onCreated={(slug) => router.push(`/recruitment/jobs/${slug}`)}
    />
  );
}

// ── Manual create — the original quick-form ────────────────────────────────

function ManualForm({
  locations, onCancel, onCreated,
}: {
  locations: LocationOption[];
  onCancel: () => void;
  onCreated: (slug: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [seniority, setSeniority] = useState<string>("");
  const [locationId, setLocationId] = useState<string>(locations[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/recruitment/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), seniority: seniority || null, locationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Create failed");
      onCreated(json.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setSaving(false);
    }
  };

  return (
    <div className="border border-sky-200 bg-sky-50 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-stone-800">New JD</p>
      <div>
        <label className={labelCls}>Title *</label>
        <input autoFocus className={inputCls + " w-full"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Resource Person · Urban Ops" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Seniority</label>
          <select className={inputCls + " w-full"} value={seniority} onChange={(e) => setSeniority(e.target.value)}>
            <option value="">—</option>
            <option value="entry">entry</option>
            <option value="mid">mid</option>
            <option value="senior">senior</option>
            <option value="lead">lead</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Location *</label>
          <select className={inputCls + " w-full"} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.city}{l.state ? ` · ${l.state}` : ""}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2 pt-1">
        {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">
          <X className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={create}
          disabled={saving || !title.trim() || !locationId}
          className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
      <p className="text-[11px] text-stone-500">You&apos;ll fill out the day-to-day, must-haves and rubric on the next screen.</p>
    </div>
  );
}

// ── Upload → extract ────────────────────────────────────────────────────────

function UploadPanel({
  onCancel, onExtracted,
}: {
  onCancel: () => void;
  onExtracted: (e: Extracted) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "extracting">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const busy = phase !== "idle";

  const run = async () => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type || "unknown"} — use PDF, DOCX, or a PNG/JPG/WEBP screenshot.`);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError(`"${file.name}" is too large (max 15 MB).`);
      return;
    }
    setError("");
    try {
      setPhase("uploading");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(`recruitment/jd-tmp/${safeName}`, file, {
        access: "private",
        contentType: file.type,
        handleUploadUrl: "/api/recruitment/upload-jd",
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(`Uploading — ${Math.round(percentage)}%`),
      });

      setPhase("extracting");
      setProgress("Reading the JD — this takes about 20–40 seconds…");
      const res = await fetch("/api/recruitment/jobs/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, name: file.name, mediaType: file.type }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Extraction failed");
      onExtracted(json as Extracted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("idle");
      setProgress("");
    }
  };

  return (
    <div className="border border-sky-200 bg-sky-50 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-stone-800">Upload JD (PDF, DOCX, or screenshot)</p>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 hover:border-sky-300 hover:text-sky-700 disabled:opacity-50 bg-white"
      >
        <FileUp className="w-4 h-4" />
        {file ? file.name : "Choose JD file"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        {!busy && (
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={run}
          disabled={busy || !file}
          className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? progress || "Working…" : "Extract & review"}
        </button>
      </div>
      {phase === "extracting" && (
        <p className="text-[11px] text-stone-500">Keep this tab open — you&apos;ll get an editable form when the extraction returns.</p>
      )}
    </div>
  );
}

// ── Review extracted → create ───────────────────────────────────────────────

function ReviewPanel({
  extracted, locations, onBack, onCancel, onCreated,
}: {
  extracted: Extracted;
  locations: LocationOption[];
  onBack: () => void;
  onCancel: () => void;
  onCreated: (slug: string) => void;
}) {
  const f = extracted.fields;
  const lc = new Set(extracted.lowConfidenceFields);

  const [title, setTitle] = useState(f.title);
  const [seniority, setSeniority] = useState<string>(f.seniority ?? "");
  const [locationId, setLocationId] = useState<string>(matchLocation(f.locationHint, locations)?.id ?? locations[0]?.id ?? "");
  const [dayToDay, setDayToDay] = useState(f.dayToDay);
  const [mustHaves, setMustHaves] = useState(f.mustHaves.join("\n"));
  const [niceToHaves, setNiceToHaves] = useState(f.niceToHaves.join("\n"));
  const [hardDisqualifiers, setHardDisqualifiers] = useState(f.hardDisqualifiers.join("\n"));
  const [salaryBand, setSalaryBand] = useState(f.salaryBand);
  const [theme, setTheme] = useState<"football" | "neutral">(f.theme);
  const [notes, setNotes] = useState(f.notes);
  const [redFlagRules, setRedFlagRules] = useState(f.redFlagRules.join("\n"));
  const [yellowFlagRules, setYellowFlagRules] = useState(f.yellowFlagRules.join("\n"));
  const [scrutiniseFor, setScrutiniseFor] = useState(f.scrutiniseFor.join("\n"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  const create = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/recruitment/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          seniority: seniority || null,
          locationId,
          dayToDay,
          mustHaves: lines(mustHaves),
          niceToHaves: lines(niceToHaves),
          hardDisqualifiers: lines(hardDisqualifiers),
          salaryBand: salaryBand.trim() || null,
          theme,
          notes,
          redFlagRules: lines(redFlagRules),
          yellowFlagRules: lines(yellowFlagRules),
          scrutiniseFor: lines(scrutiniseFor),
          sourceDocUrl: extracted.sourceDocUrl,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Create failed");
      onCreated(json.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setSaving(false);
    }
  };

  const badge = (name: string) =>
    lc.has(name) ? (
      <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-amber-600" title="LLM flagged as low confidence — double-check">
        <AlertTriangle className="w-2.5 h-2.5" /> check
      </span>
    ) : null;

  return (
    <div className="border border-sky-200 bg-sky-50/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-sky-500" />
        <p className="text-sm font-medium text-stone-800">Review extracted JD</p>
        <span className="text-[11px] text-stone-400 truncate">from {extracted.sourceDocName}</span>
      </div>

      {extracted.notes && (
        <p className="text-[11px] text-stone-600 bg-white border border-stone-200 rounded-lg px-3 py-2">
          <span className="text-stone-500 font-semibold">Scout&apos;s note on this JD:</span> {extracted.notes}
        </p>
      )}
      {f.locationHint && (
        <p className="text-[11px] text-stone-600">
          JD mentions location: <span className="font-medium">{f.locationHint}</span>{" "}
          — matched to <span className="font-medium">{locations.find((l) => l.id === locationId)?.city ?? "—"}</span>. Change below if wrong.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Title * {badge("title")}</label>
          <input className={inputCls + " w-full"} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Seniority {badge("seniority")}</label>
          <select className={inputCls + " w-full"} value={seniority} onChange={(e) => setSeniority(e.target.value)}>
            <option value="">—</option>
            <option value="entry">entry</option>
            <option value="mid">mid</option>
            <option value="senior">senior</option>
            <option value="lead">lead</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Location *</label>
          <select className={inputCls + " w-full"} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.city}{l.state ? ` · ${l.state}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Salary band {badge("salaryBand")}</label>
          <input className={inputCls + " w-full"} value={salaryBand} onChange={(e) => setSalaryBand(e.target.value)} placeholder="e.g. ₹22-28k/mo" />
        </div>
      </div>

      <div>
        <label className={labelCls}>Voice</label>
        <div className="flex gap-1.5">
          {(["football", "neutral"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`px-2.5 py-1 text-xs rounded-full border ${theme === t ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 text-stone-600 hover:border-stone-300"}`}
            >
              {t === "football" ? "Football scout" : "Neutral"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Day-to-day {badge("dayToDay")}</label>
        <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={dayToDay} onChange={(e) => setDayToDay(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Must-haves {badge("mustHaves")}</label>
          <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={mustHaves} onChange={(e) => setMustHaves(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Nice-to-haves {badge("niceToHaves")}</label>
          <textarea rows={4} className={inputCls + " w-full font-mono text-xs"} value={niceToHaves} onChange={(e) => setNiceToHaves(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Hard disqualifiers {badge("hardDisqualifiers")}</label>
        <textarea rows={2} className={inputCls + " w-full font-mono text-xs"} value={hardDisqualifiers} onChange={(e) => setHardDisqualifiers(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Red-flag rules {badge("redFlagRules")}</label>
          <textarea rows={3} className={inputCls + " w-full font-mono text-xs"} value={redFlagRules} onChange={(e) => setRedFlagRules(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Yellow-flag rules {badge("yellowFlagRules")}</label>
          <textarea rows={3} className={inputCls + " w-full font-mono text-xs"} value={yellowFlagRules} onChange={(e) => setYellowFlagRules(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Scrutinise for {badge("scrutiniseFor")}</label>
        <textarea rows={2} className={inputCls + " w-full font-mono text-xs"} value={scrutiniseFor} onChange={(e) => setScrutiniseFor(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Extra context {badge("notes")}</label>
        <textarea rows={2} className={inputCls + " w-full"} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={onBack} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">Back</button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">
          <X className="w-3.5 h-3.5" />
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
        <button
          onClick={create}
          disabled={saving || !title.trim() || !locationId}
          className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? "Creating…" : "Create JD"}
        </button>
      </div>
    </div>
  );
}

// Best-effort match of the JD's mentioned city against saved Locations. Used to
// preselect the dropdown; the reviewer overrides if wrong.
function matchLocation(hint: string, locations: LocationOption[]): LocationOption | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  return (
    locations.find((l) => h.includes(l.city.toLowerCase())) ??
    locations.find((l) => l.state && h.includes(l.state.toLowerCase())) ??
    null
  );
}
