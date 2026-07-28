"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, MapPin, User as UserIcon } from "lucide-react";
import type { OversightZone, OversightCluster, OversightRp, OversightCentre } from "@/lib/operations/oversight";

/**
 * Geography-first drill-down tree for supervisors: Zone → Cluster → RP → Centre.
 * Each node carries rollup chips (live / setting-up / today / overdue). Zones start
 * open; clusters and RPs collapse so a Leader with a wide tree isn't buried — they
 * drill into the branch they care about. Centres link to the read-only centre detail.
 */
export function OversightTree({ zones }: { zones: OversightZone[] }) {
  return (
    <div className="space-y-3">
      {zones.map((z) => <ZoneNode key={z.id} zone={z} />)}
    </div>
  );
}

function ZoneNode({ zone }: { zone: OversightZone }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-xl border border-stone-200 bg-white/40">
      <NodeHeader
        open={open}
        onToggle={() => setOpen((o) => !o)}
        icon={<span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Zone</span>}
        label={zone.name}
        rollup={zone}
      />
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2.5">
          {zone.clusters.map((c) => <ClusterNode key={c.id} cluster={c} />)}
        </div>
      )}
    </section>
  );
}

function ClusterNode({ cluster }: { cluster: OversightCluster }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-stone-200/70 bg-white/70">
      <NodeHeader
        open={open}
        onToggle={() => setOpen((o) => !o)}
        icon={<MapPin className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />}
        label={cluster.name}
        rollup={cluster}
      />
      {open && (
        <div className="space-y-1.5 px-2 pb-2">
          {cluster.rps.map((rp) => <RpNode key={rp.id} rp={rp} />)}
        </div>
      )}
    </div>
  );
}

function RpNode({ rp }: { rp: OversightRp }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-stone-200/70 bg-stone-50/60">
      <NodeHeader
        open={open}
        onToggle={() => setOpen((o) => !o)}
        icon={<UserIcon className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />}
        label={rp.name ?? "Unassigned"}
        rollup={rp}
      />
      {open && (
        <div className="space-y-1 px-2 pb-2">
          {rp.centres.map((c) => <CentreRow key={c.goalId} centre={c} />)}
        </div>
      )}
    </div>
  );
}

function CentreRow({ centre }: { centre: OversightCentre }) {
  return (
    <Link
      href={`/operations/${encodeURIComponent(centre.themeKey)}/${centre.goalId}?from=oversight`}
      className="group flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2 hover:border-stone-300 hover:shadow-sm transition-all"
    >
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0"
        style={{ backgroundColor: centre.themeColor }}
        title={centre.themeLabel}
      >
        {centre.themeLabel.slice(0, 1).toUpperCase()}
      </span>
      <span className="flex-1 min-w-0 truncate text-sm text-stone-800">{centre.title}</span>
      <LifecyclePill lifecycle={centre.lifecycle} />
      <CountChips today={centre.today} overdue={centre.overdue} />
      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-400 flex-shrink-0" />
    </Link>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

type Rollup = { live: number; settingUp: number; today: number; overdue: number };

function NodeHeader({
  open, onToggle, icon, label, rollup,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  rollup: Rollup;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      aria-expanded={open}
    >
      <ChevronDown className={`w-4 h-4 text-stone-400 flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      {icon}
      <span className="flex-1 min-w-0 truncate text-sm font-medium text-stone-800">{label}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {rollup.live > 0 && <Chip tone="emerald">{rollup.live} live</Chip>}
        {rollup.settingUp > 0 && <Chip tone="amber">{rollup.settingUp} setup</Chip>}
        <CountChips today={rollup.today} overdue={rollup.overdue} />
      </div>
    </button>
  );
}

function CountChips({ today, overdue }: { today: number; overdue: number }) {
  return (
    <>
      {today > 0 && <Chip tone="sky">{today} today</Chip>}
      {overdue > 0 && <Chip tone="red">{overdue} overdue</Chip>}
    </>
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

function LifecyclePill({ lifecycle }: { lifecycle: OversightCentre["lifecycle"] }) {
  if (lifecycle === "live") return <Chip tone="emerald">live</Chip>;
  if (lifecycle === "setting_up") return <Chip tone="amber">setup</Chip>;
  return <span className="text-[10px] font-semibold text-stone-400 whitespace-nowrap">done</span>;
}
