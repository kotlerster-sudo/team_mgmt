// Where one unit's standard rate has drifted away from everyone else's. With a
// handful of units you can eyeball this; with 26 thematic teams and 10+ geo
// offices each holding their own overrides, drift is only visible in aggregate.
//
// This does not say a deviation is wrong — rents and wages genuinely differ by
// place. It says "this one is unlike the others", which is the question worth
// asking before the number is copied into the next grant.

import prisma from "@/lib/prisma";
import { GLOBAL_SCOPE } from "@/lib/budget/costRegistry";

export type OutlierScope = {
  city: string;
  unitCost: number;
  deviationPct: number;
};

export type CostOutlier = {
  itemKey: string;
  domain: string | null;
  unit: string;
  /** What each unit is measured against, and where that number came from. */
  baseline: number;
  baselineSource: "shared" | "median";
  scopes: OutlierScope[];
  maxDeviationPct: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export async function costOutliers(thresholdPct = 20): Promise<CostOutlier[]> {
  const rows = await prisma.costRegistry.findMany({
    select: { city: true, itemKey: true, unit: true, domain: true, unitCost: true },
  });

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    // Programme inputs are scenario numbers (how many creches, how many
    // children), not rates — units differ there by design.
    if (r.itemKey.startsWith("inp.")) continue;
    const list = byKey.get(r.itemKey) ?? [];
    list.push(r);
    byKey.set(r.itemKey, list);
  }

  const out: CostOutlier[] = [];
  for (const [itemKey, group] of byKey) {
    const shared = group.find((r) => r.city === GLOBAL_SCOPE);
    const units = group.filter((r) => r.city !== GLOBAL_SCOPE);
    // One unit against no shared rate has nothing to be unlike.
    if (units.length < (shared ? 1 : 2)) continue;

    const baseline = shared ? shared.unitCost : median(units.map((u) => u.unitCost));
    if (baseline === 0) continue;

    const scopes = units
      .map((u) => ({
        city: u.city,
        unitCost: u.unitCost,
        deviationPct: Math.round(((u.unitCost - baseline) / baseline) * 100),
      }))
      .sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));

    const maxDeviationPct = Math.abs(scopes[0].deviationPct);
    if (maxDeviationPct < thresholdPct) continue;

    out.push({
      itemKey,
      domain: group.find((r) => r.domain)?.domain ?? null,
      unit: group[0].unit,
      baseline,
      baselineSource: shared ? "shared" : "median",
      scopes,
      maxDeviationPct,
    });
  }

  return out.sort((a, b) => b.maxDeviationPct - a.maxDeviationPct);
}
