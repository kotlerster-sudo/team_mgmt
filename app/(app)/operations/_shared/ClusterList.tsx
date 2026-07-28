import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import type { OversightZone } from "@/lib/operations/oversight";

/**
 * Cluster picker for the oversight landing — zones as light headers, clusters as links into
 * the cluster activity board (`?cluster=<id>`). Live clusters (any live centre) sort first.
 * Rollup chips come straight from loadOversightTree's per-cluster counts.
 */
export function ClusterList({ zones }: { zones: OversightZone[] }) {
  return (
    <div className="space-y-5">
      {zones.map((z) => (
        <section key={z.id}>
          <h2 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">{z.name}</h2>
          <div className="space-y-1.5">
            {z.clusters.map((c) => (
              <Link
                key={c.id}
                href={`/operations/oversight?cluster=${encodeURIComponent(c.id)}`}
                className="group flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 hover:shadow-sm transition-all"
              >
                <span className="w-9 h-9 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4.5 h-4.5" />
                </span>
                <span className="text-sm font-semibold text-stone-800 flex-1 truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.live > 0 && <Chip tone="emerald">{c.live} live</Chip>}
                  {c.settingUp > 0 && <Chip tone="amber">{c.settingUp} setup</Chip>}
                  {c.today > 0 && <Chip tone="sky">{c.today} today</Chip>}
                  {c.overdue > 0 && <Chip tone="red">{c.overdue} overdue</Chip>}
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Chip({ tone, children }: { tone: "emerald" | "amber" | "sky" | "red"; children: React.ReactNode }) {
  const cls = {
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
    sky: "text-sky-700 bg-sky-50 border-sky-200",
    red: "text-red-700 bg-red-50 border-red-200",
  }[tone];
  return (
    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums border whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}
