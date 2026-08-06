import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// ── Types ────────────────────────────────────────────────────────────────────

type StalenessStatus = "green" | "yellow" | "red" | "none";
type CaptureSource = "MIS_API" | "RP_ACTIVITY" | "MANUAL_ADMIN";

type TargetFormula =
  | { type: "fixed"; value: number }
  | { type: "settlement_field"; field: string; multiplier: number }
  | { type: "facility_count"; multiplier: number }
  | { type: "scheme_baseline"; multiplier: number }
  | null;

type IndicatorDefRow = {
  id: string;
  key: string;
  label: string;
  domain: string;
  facilityLayerKey: string | null;
  unit: string | null;
  frequency: string;
  color: string;
  targetFormula: TargetFormula;
  captureSource: CaptureSource;
  staleYellowDays: number;
  staleRedDays: number;
  sortOrder: number;
};

type SettlementPoint = {
  settlementId: string;
  value: number;
  capturedAt: Date;
  source: CaptureSource;
};

type IndicatorSummary = {
  id: string;
  key: string;
  label: string;
  color: string;
  unit: string | null;
  frequency: string;
  captureSource: CaptureSource;
  hasTarget: boolean;
  // Aggregated across the selected geography (only settlements with data are counted)
  avgValue: number | null;
  totalTarget: number | null;
  avgPctOfTarget: number | null;
  settlementsWithData: number;
  totalSettlements: number;
  lastCapturedAt: string | null;
  stalenessStatus: StalenessStatus;
  // Time series — average across settlements per month
  timeSeries: { date: string; value: number; settlementCount: number }[];
};

type SettlementBreakdownRow = {
  id: string;
  name: string;
  currentValue: number | null;
  targetValue: number | null;
  pctOfTarget: number | null;
  lastCapturedAt: string | null;
  stalenessStatus: StalenessStatus;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStaleness(lastDelivery: Date | null, yellowDays: number, redDays: number): StalenessStatus {
  if (!lastDelivery) return "none";
  const daysSince = Math.floor((Date.now() - lastDelivery.getTime()) / 86400000);
  if (daysSince >= redDays) return "red";
  if (daysSince >= yellowDays) return "yellow";
  return "green";
}

async function resolveSettlementIds(level: string, id: string): Promise<{ ids: string[]; name: string }> {
  if (level === "settlement") {
    const s = await prisma.settlement.findUnique({ where: { id }, select: { id: true, name: true } });
    return s ? { ids: [s.id], name: s.name } : { ids: [], name: "" };
  }
  if (level === "cluster") {
    const c = await prisma.cluster.findUnique({
      where: { id },
      select: { name: true, settlements: { where: { deletedAt: null }, select: { id: true } } },
    });
    return c ? { ids: c.settlements.map(s => s.id), name: c.name } : { ids: [], name: "" };
  }
  if (level === "zone") {
    const z = await prisma.zone.findUnique({
      where: { id },
      select: {
        name: true,
        clusters: {
          where: { deletedAt: null },
          select: { settlements: { where: { deletedAt: null }, select: { id: true } } },
        },
      },
    });
    return z ? { ids: z.clusters.flatMap(c => c.settlements.map(s => s.id)), name: z.name } : { ids: [], name: "" };
  }
  if (level === "city") {
    const c = await prisma.city.findUnique({
      where: { id },
      select: {
        name: true,
        zones: {
          select: {
            clusters: {
              where: { deletedAt: null },
              select: { settlements: { where: { deletedAt: null }, select: { id: true } } },
            },
          },
        },
      },
    });
    return c
      ? { ids: c.zones.flatMap(z => z.clusters.flatMap(cl => cl.settlements.map(s => s.id))), name: c.name }
      : { ids: [], name: "" };
  }
  return { ids: [], name: "" };
}

// Resolve target value for one settlement given the formula
async function resolveTarget(
  formula: TargetFormula,
  settlementId: string,
  facilityLayerKey: string | null,
  assessmentByIdField: Map<string, Record<string, number>>,
  facilityCountByIdLayer: Map<string, number>,
): Promise<number | null> {
  if (!formula) return null;
  if (formula.type === "fixed") return formula.value;
  if (formula.type === "settlement_field") {
    const fields = assessmentByIdField.get(settlementId);
    if (!fields) return null;
    const v = fields[formula.field];
    if (v == null) return null;
    return v * formula.multiplier;
  }
  if (formula.type === "facility_count") {
    const key = facilityLayerKey ? `${settlementId}:${facilityLayerKey}` : `${settlementId}:*`;
    const n = facilityCountByIdLayer.get(key) ?? 0;
    return n * formula.multiplier;
  }
  if (formula.type === "scheme_baseline") {
    return null; // v1: not implemented
  }
  return null;
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level") ?? "city";
  const id = url.searchParams.get("id");
  const indicatorKey = url.searchParams.get("indicator"); // optional — when set, return per-settlement breakdown
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { ids: settlementIds, name } = await resolveSettlementIds(level, id);

  // Pull active indicator defs
  const defs = await prisma.$queryRaw<IndicatorDefRow[]>`
    SELECT id, key, label, domain, "facilityLayerKey", unit, frequency::text AS frequency, color,
           "targetFormula", "captureSource"::text AS "captureSource",
           "staleYellowDays", "staleRedDays", "sortOrder"
    FROM "FacilityIndicatorDef"
    WHERE "isActive" = true
    ORDER BY "sortOrder" ASC, label ASC
  `;

  if (defs.length === 0 || settlementIds.length === 0) {
    return NextResponse.json({
      geography: { id, name, level },
      indicators: [],
      breakdown: [],
      indicatorKey: indicatorKey ?? null,
    });
  }

  // Pull all FacilityIndicator rows for these settlements × active defs
  const defIds = defs.map(d => d.id);
  const indicatorRows = await prisma.$queryRaw<{
    id: string; defId: string; settlementId: string;
    currentValue: number | null; targetValue: number | null;
    lastCapturedAt: Date | null;
  }[]>`
    SELECT id, "defId", "settlementId", "currentValue", "targetValue", "lastCapturedAt"
    FROM "FacilityIndicator"
    WHERE "settlementId" = ANY(${settlementIds}::text[])
      AND "defId" = ANY(${defIds}::text[])
  `;

  // Pull time-series points for these indicator rows (last 24 months)
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2);
  const indicatorIds = indicatorRows.map(r => r.id);
  const points = indicatorIds.length > 0
    ? await prisma.$queryRaw<{ indicatorId: string; value: number; capturedAt: Date }[]>`
        SELECT "indicatorId", value, "capturedAt"
        FROM "FacilityIndicatorPoint"
        WHERE "indicatorId" = ANY(${indicatorIds}::text[])
          AND "capturedAt" >= ${cutoff}
        ORDER BY "capturedAt" ASC
      `
    : [];

  // For target formula resolution: load latest assessment per settlement (fields needed)
  const assessmentByIdField = new Map<string, Record<string, number>>();
  const popFieldsNeeded = new Set<string>();
  for (const d of defs) {
    if (d.targetFormula?.type === "settlement_field") popFieldsNeeded.add(d.targetFormula.field);
  }
  if (popFieldsNeeded.size > 0 && settlementIds.length > 0) {
    const assessments = await prisma.settlementAssessment.findMany({
      where: { settlementId: { in: settlementIds } },
      orderBy: { assessedAt: "desc" },
      distinct: ["settlementId"],
      select: { settlementId: true, totalHouseholds: true, children6m3yr: true, children4to14: true, youth15to21: true, elderly60plus: true },
    });
    for (const a of assessments) {
      const rec: Record<string, number> = {
        totalHouseholds: a.totalHouseholds ?? 0,
        children6m3yr: a.children6m3yr ?? 0,
        children4to14: a.children4to14 ?? 0,
        youth15to21: a.youth15to21 ?? 0,
        elderly60plus: a.elderly60plus ?? 0,
      };
      assessmentByIdField.set(a.settlementId, rec);
    }
  }

  // Facility counts (LayerFeature per settlement per layerKey)
  const layerKeysNeeded = new Set<string>();
  for (const d of defs) {
    if (d.targetFormula?.type === "facility_count" && d.facilityLayerKey) {
      layerKeysNeeded.add(d.facilityLayerKey);
    }
  }
  const facilityCountByIdLayer = new Map<string, number>();
  if (layerKeysNeeded.size > 0 && settlementIds.length > 0) {
    const counts = await prisma.$queryRaw<{ settlementId: string; layerKey: string; n: bigint }[]>`
      SELECT "settlementId", "layerKey", COUNT(*)::bigint AS n
      FROM "LayerFeature"
      WHERE "settlementId" = ANY(${settlementIds}::text[])
        AND "layerKey" = ANY(${Array.from(layerKeysNeeded)}::text[])
      GROUP BY "settlementId", "layerKey"
    `;
    for (const c of counts) {
      facilityCountByIdLayer.set(`${c.settlementId}:${c.layerKey}`, Number(c.n));
    }
  }

  // Per def: per settlement target → aggregate
  type DefAggregate = {
    def: IndicatorDefRow;
    settlements: Map<string, { value: number | null; target: number | null; lastCapturedAt: Date | null; pct: number | null }>;
    points: { capturedAt: Date; value: number; indicatorId: string }[];
  };
  const byDef = new Map<string, DefAggregate>();
  for (const d of defs) byDef.set(d.id, { def: d, settlements: new Map(), points: [] });

  // Initialise settlement map with nulls (so we know total settlements in scope)
  for (const d of defs) {
    const agg = byDef.get(d.id)!;
    for (const sid of settlementIds) {
      agg.settlements.set(sid, { value: null, target: null, lastCapturedAt: null, pct: null });
    }
  }

  // A settlement can now hold multiple FacilityIndicator rows for one def (one
  // per creche + a settlement-level row). Collapse them to a single value per
  // (def, settlement) — averaged across facilities — so the geography rollup
  // isn't skewed by how many facilities a settlement happens to have.
  const indicatorToSettlement = new Map(indicatorRows.map(r => [r.id, r.settlementId]));
  const rowsByDefSettlement = new Map<string, { defId: string; settlementId: string; values: number[]; last: Date | null }>();
  for (const row of indicatorRows) {
    const key = `${row.defId}:${row.settlementId}`;
    const e = rowsByDefSettlement.get(key) ?? { defId: row.defId, settlementId: row.settlementId, values: [], last: null };
    if (row.currentValue != null) e.values.push(row.currentValue);
    if (row.lastCapturedAt && (!e.last || row.lastCapturedAt > e.last)) e.last = row.lastCapturedAt;
    rowsByDefSettlement.set(key, e);
  }
  for (const e of rowsByDefSettlement.values()) {
    const agg = byDef.get(e.defId);
    if (!agg) continue;
    const value = e.values.length ? e.values.reduce((s, v) => s + v, 0) / e.values.length : null;
    const t = await resolveTarget(
      agg.def.targetFormula,
      e.settlementId,
      agg.def.facilityLayerKey,
      assessmentByIdField,
      facilityCountByIdLayer,
    );
    const pct = (value != null && t != null && t > 0) ? (value / t) * 100 : null;
    agg.settlements.set(e.settlementId, { value, target: t, lastCapturedAt: e.last, pct });
  }
  for (const p of points) {
    const row = indicatorRows.find(r => r.id === p.indicatorId);
    if (!row) continue;
    const agg = byDef.get(row.defId);
    if (agg) agg.points.push({ capturedAt: p.capturedAt, value: p.value, indicatorId: p.indicatorId });
  }

  // Build per-def summary
  const indicators: IndicatorSummary[] = [];
  for (const d of defs) {
    const agg = byDef.get(d.id)!;
    const withData = Array.from(agg.settlements.values()).filter(s => s.value != null);
    const sumValue = withData.reduce((s, r) => s + (r.value ?? 0), 0);
    const sumTarget = withData.reduce((s, r) => s + (r.target ?? 0), 0);
    const avgValue = withData.length ? sumValue / withData.length : null;
    const avgPct = (() => {
      const pcts = withData.map(r => r.pct).filter((p): p is number => p != null);
      if (pcts.length === 0) return null;
      return pcts.reduce((s, p) => s + p, 0) / pcts.length;
    })();

    // Time series: bucket by month, average across settlements that have a point in that month
    type Bucket = { values: number[]; settlements: Set<string> };
    const buckets = new Map<string, Bucket>();
    for (const p of agg.points) {
      const key = `${p.capturedAt.getFullYear()}-${String(p.capturedAt.getMonth() + 1).padStart(2, "0")}-01`;
      if (!buckets.has(key)) buckets.set(key, { values: [], settlements: new Set() });
      const b = buckets.get(key)!;
      b.values.push(p.value);
      // Count distinct SETTLEMENTS (not indicator rows — multiple creches now share one).
      b.settlements.add(indicatorToSettlement.get(p.indicatorId) ?? p.indicatorId);
    }
    const timeSeries = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date,
        value: b.values.reduce((s, v) => s + v, 0) / b.values.length,
        settlementCount: b.settlements.size,
      }));

    const lastDates = withData.map(s => s.lastCapturedAt).filter((d): d is Date => d != null);
    const lastCapturedAt = lastDates.length ? new Date(Math.max(...lastDates.map(d => d.getTime()))) : null;

    indicators.push({
      id: d.id,
      key: d.key,
      label: d.label,
      color: d.color,
      unit: d.unit,
      frequency: d.frequency,
      captureSource: d.captureSource,
      hasTarget: d.targetFormula !== null,
      avgValue,
      totalTarget: sumTarget > 0 ? sumTarget : null,
      avgPctOfTarget: avgPct,
      settlementsWithData: withData.length,
      totalSettlements: settlementIds.length,
      lastCapturedAt: lastCapturedAt ? lastCapturedAt.toISOString() : null,
      stalenessStatus: getStaleness(lastCapturedAt, d.staleYellowDays, d.staleRedDays),
      timeSeries,
    });
  }

  // Per-settlement breakdown — only when a specific indicator is requested
  let breakdown: SettlementBreakdownRow[] = [];
  if (indicatorKey) {
    const def = defs.find(d => d.key === indicatorKey);
    if (def) {
      const agg = byDef.get(def.id)!;
      const settlementNames = await prisma.settlement.findMany({
        where: { id: { in: settlementIds } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      breakdown = settlementNames.map(s => {
        const data = agg.settlements.get(s.id);
        return {
          id: s.id,
          name: s.name,
          currentValue: data?.value ?? null,
          targetValue: data?.target ?? null,
          pctOfTarget: data?.pct ?? null,
          lastCapturedAt: data?.lastCapturedAt ? data.lastCapturedAt.toISOString() : null,
          stalenessStatus: getStaleness(data?.lastCapturedAt ?? null, def.staleYellowDays, def.staleRedDays),
        };
      });
    }
  }

  return NextResponse.json({
    geography: { id, name, level },
    indicators,
    breakdown,
    indicatorKey: indicatorKey ?? null,
  });
}
