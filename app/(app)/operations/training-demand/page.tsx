"use client";

/**
 * Refresher-training demand — which caregiver practices are weak across creches,
 * so leaders can plan targeted refreshers. Grouped by training module (or by
 * category while modules are unset). Leader surface (API gated on command_center).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, GraduationCap, Loader2 } from "lucide-react";

type Practice = {
  practiceId: string; code: string; shortLabel: string; category: string; subcategory: string;
  trainingModule: number | null; flaggedCreches: number; needsImprovement: number; notPracticed: number;
};
type Zone = { id: string; name: string; cityName: string | null };

function TrainingDemandInner() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState<string | "">("");
  const [practices, setPractices] = useState<Practice[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = zoneId ? `?zoneId=${zoneId}` : "";
    fetch(`/api/caregiver-practices/training-demand${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setZones(d.zones ?? []);
        setPractices(d.practices ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [zoneId]);

  const groups = useMemo(() => {
    const byModule = new Map<string, Practice[]>();
    for (const p of practices ?? []) {
      const key = p.trainingModule != null ? `Module ${p.trainingModule}` : "Unmapped — set a training module in Settings";
      byModule.set(key, [...(byModule.get(key) ?? []), p]);
    }
    return [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [practices]);

  const maxFlag = Math.max(1, ...(practices ?? []).map((p) => p.flaggedCreches));
  const multiCity = new Set(zones.map((z) => z.cityName)).size > 1;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div>
        <Link href="/command" className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600">
          <ChevronLeft className="w-3.5 h-3.5" /> Command Center
        </Link>
        <h1 className="text-lg font-semibold text-stone-900 mt-1 flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-teal-600" /> Refresher-training demand
        </h1>
        <p className="text-sm text-stone-500">Caregiver practices currently flagged across creches — plan refreshers where the demand is highest.</p>
      </div>

      <select
        value={zoneId}
        onChange={(e) => setZoneId(e.target.value)}
        className="text-sm font-medium text-stone-800 bg-white border border-stone-200 rounded-lg px-2.5 py-1.5"
      >
        <option value="">All my zones</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>{multiCity && z.cityName ? `${z.cityName} · ${z.name}` : z.name}</option>
        ))}
      </select>

      {loading && !practices ? (
        <div className="grid place-items-center py-10 text-stone-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (practices ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-200 p-10 text-center text-sm text-stone-400">
          No open caregiver-practice flags in scope yet — this fills in as RPs flag practices on visits.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, list]) => (
            <div key={label}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">{label} · {list.length}</p>
              <div className="border border-stone-200 rounded-xl overflow-hidden bg-white divide-y divide-stone-100">
                {list.sort((a, b) => b.flaggedCreches - a.flaggedCreches).map((p) => (
                  <div key={p.practiceId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-stone-800 truncate">{p.shortLabel} <span className="text-[10px] text-stone-300">{p.code}</span></p>
                      <p className="text-[10px] text-stone-400 truncate">{p.category} · {p.subcategory}</p>
                    </div>
                    <div className="w-24 h-1.5 bg-stone-100 rounded-full overflow-hidden shrink-0">
                      <div className="h-full bg-amber-400" style={{ width: `${(p.flaggedCreches / maxFlag) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-stone-700 tabular-nums shrink-0 w-16 text-right" title={`${p.notPracticed} not done · ${p.needsImprovement} needs improvement`}>
                      {p.flaggedCreches} creche{p.flaggedCreches === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrainingDemandPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-sm text-stone-400">Loading…</div>}>
      <TrainingDemandInner />
    </Suspense>
  );
}
