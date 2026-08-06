"use client";

/**
 * Always-visible needs-gap strip — the leader's standing reminder of how far
 * the zone is from its entitlement targets, above the operational drill-down.
 * Reuses GET /api/zones/summary verbatim (same numbers as the field-coverage
 * page's Zones tab).
 */

import { useEffect, useState } from "react";

type DomainProgress = {
  target: number;
  existing: number;
  addressable: number | null;
  done: number;
  inProgress: number;
};

type ZoneSummary = {
  id: string;
  domainProgress: Record<string, DomainProgress>;
};

type DomainConfig = { domain: string; label: string; color: string };

export function NeedsStrip({ zoneId }: { zoneId: string }) {
  const [zones, setZones] = useState<ZoneSummary[] | null>(null);
  const [config, setConfig] = useState<DomainConfig[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/zones/summary")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setZones(Array.isArray(d.zones) ? d.zones : []);
        setConfig(Array.isArray(d.domainConfig) ? d.domainConfig : []);
      })
      .catch(() => !cancelled && setZones([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const zone = zones?.find((z) => z.id === zoneId);
  if (!zone || config.length === 0) return null;

  const chips = config
    .map((c) => ({ ...c, dp: zone.domainProgress?.[c.domain] }))
    .filter((c) => c.dp && (c.dp.target > 0 || c.dp.done > 0 || c.dp.existing > 0));
  if (chips.length === 0) return null;

  return (
    <div className="-mx-1 px-1 overflow-x-auto">
      <div className="flex items-center gap-2 pb-1 min-w-max">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 shrink-0">
          Needs gap
        </span>
        {chips.map((c) => {
          const have = c.dp!.existing + c.dp!.done;
          const gap = Math.max(0, c.dp!.target - have);
          const pct = c.dp!.target > 0 ? Math.min(100, Math.round((have / c.dp!.target) * 100)) : 100;
          return (
            <span
              key={c.domain}
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white pl-2 pr-2.5 py-1 shrink-0"
              title={`${c.label}: ${have} of ${c.dp!.target} (existing ${c.dp!.existing} + delivered ${c.dp!.done}), ${c.dp!.inProgress} in progress${gap > 0 ? ` — gap ${gap}` : ""}`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
              <span className="text-[11px] text-stone-600">{c.label}</span>
              <span className="text-[11px] font-semibold text-stone-800 tabular-nums">
                {have}/{c.dp!.target}
              </span>
              <span className="w-10 h-1 rounded-full bg-stone-100 overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct}%`, background: gap > 0 ? "#f59e0b" : "#10b981" }}
                />
              </span>
              {gap > 0 && <span className="text-[10px] font-semibold text-amber-600 tabular-nums">−{gap}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
