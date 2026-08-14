"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Check, Loader2 } from "lucide-react";

const inputCls = "px-2.5 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white";
const labelCls = "block text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-0.5";

export default function NewJobButton({
  locations,
}: {
  locations: { id: string; city: string; state: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        body: JSON.stringify({
          title: title.trim(),
          seniority: seniority || null,
          locationId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Create failed");
      router.push(`/recruitment/jobs/${json.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-4 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-stone-300 hover:text-stone-700"
      >
        <Plus className="w-4 h-4" /> New JD
      </button>
    );
  }

  return (
    <div className="border border-sky-200 bg-sky-50 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-stone-800">New JD</p>
      <div>
        <label className={labelCls}>Title *</label>
        <input
          autoFocus
          className={inputCls + " w-full"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Resource Person · Urban Ops"
        />
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
              <option key={l.id} value={l.id}>
                {l.city}{l.state ? ` · ${l.state}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end items-center gap-2 pt-1">
        {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
        <button onClick={() => { setOpen(false); setError(""); }} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">
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
