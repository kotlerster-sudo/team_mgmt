// Setup → live transition for a centre (Goal).
//
// Freezes the domain-default CatalogTemplateDef into a per-centre CentreCatalog snapshot
// (Budget cost snapshot/override pattern), seeds the visit cadence, ensures a long-lived
// recurring "Operations" pitstop exists to hang visits off (already what deriveCentrePhase
// treats as "live"), and flips Goal.mode → "live". Idempotent.

import prisma from "@/lib/prisma";
import { normalizeCategories, type CatalogCategory } from "@/lib/catalogDb";
import { OPERATIONS_PITSTOP_TITLE } from "./anchor";

export type GoLiveResult = {
  goalId: string;
  catalogSlug: string | null;
  livePitstopId: string;
  seededCategories: number;
  alreadyLive: boolean;
};

/**
 * Transition a centre to live mode. Safe to call repeatedly — an existing CentreCatalog is
 * left untouched (snapshot is frozen at first go-live), and an existing recurring pitstop is
 * reused rather than duplicated.
 */
export async function setCentreLive(goalId: string): Promise<GoLiveResult> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true,
      mode: true,
      needsDomain: true,
      needsSettlementId: true,
      needsClusterId: true,
      needsZoneId: true,
      ownerId: true,
      centreCatalog: { select: { id: true, catalogSlug: true } },
    },
  });
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  const alreadyLive = goal.mode === "live" && Boolean(goal.centreCatalog);

  // 1. Resolve the domain-default catalog (may be absent — centre can go live with an empty menu).
  const def = goal.needsDomain
    ? await prisma.catalogTemplateDef.findFirst({
        where: { needsDomain: goal.needsDomain, isActive: true },
        orderBy: { updatedAt: "desc" },
      })
    : null;

  const snapshot = normalizeCategories((def?.categories ?? []) as unknown as CatalogCategory[]);
  const catalogSlug = def?.slug ?? goal.centreCatalog?.catalogSlug ?? null;

  // 2. Ensure the dedicated recurring "Operations" pitstop exists to anchor visits. NOTE: we match
  // on title, NOT "any recurring pitstop" — a centre may carry several recurring template pitstops
  // (repeatCount expansion); the visit layer must anchor on exactly one dedicated pitstop.
  const existingRhythm = await prisma.pitstop.findFirst({
    where: { goalId, deletedAt: null, recurrence: { not: "None" }, title: OPERATIONS_PITSTOP_TITLE },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let livePitstopId = existingRhythm?.id ?? "";
  if (!livePitstopId) {
    const maxOrder = await prisma.pitstop.aggregate({
      where: { goalId, deletedAt: null },
      _max: { order: true },
    });
    const now = new Date();
    const target = new Date(now);
    target.setMonth(target.getMonth() + 1);
    const created = await prisma.pitstop.create({
      data: {
        title: "Operations",
        type: "Discussion",
        status: "InProgress",
        goalId,
        ownerId: goal.ownerId,
        order: (maxOrder._max.order ?? 0) + 1,
        recurrence: "Monthly",
        progressTag: "Monitoring",
        startDate: now,
        targetDate: target,
        needsSettlementId: goal.needsSettlementId,
        needsClusterId: goal.needsClusterId,
        needsZoneId: goal.needsZoneId,
      },
      select: { id: true },
    });
    livePitstopId = created.id;
  }

  // 3. Freeze the snapshot + cadence into CentreCatalog (first go-live only; never overwrite).
  if (!goal.centreCatalog) {
    await prisma.centreCatalog.create({
      data: {
        goalId,
        catalogSlug: catalogSlug ?? "",
        snapshot: snapshot as object[],
        overrides: {},
        cadenceCount: def?.defaultCadenceCount ?? null,
        cadencePeriod: def?.defaultCadencePeriod ?? null,
      },
    });
  }

  // 4. Flip the mode.
  if (goal.mode !== "live") {
    await prisma.goal.update({ where: { id: goalId }, data: { mode: "live" } });
  }

  return {
    goalId,
    catalogSlug,
    livePitstopId,
    seededCategories: snapshot.length,
    alreadyLive,
  };
}

/**
 * Auto-transition a setup centre to live when its setup work is finished. Called from the
 * pitstop-completion path. Fires only when: mode is still "setup", every non-recurring (setup)
 * pitstop is Done, and a domain catalog exists (the signal that this domain HAS a live phase).
 * A manager can pre-empt/override via the explicit go-live route. Silent + safe to call often.
 */
export async function maybeAutoGoLive(goalId: string): Promise<boolean> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      mode: true,
      needsDomain: true,
      pitstops: { where: { deletedAt: null }, select: { status: true, recurrence: true } },
    },
  });
  if (!goal || goal.mode !== "setup" || !goal.needsDomain) return false;

  const setupPitstops = goal.pitstops.filter((p) => p.recurrence === "None");
  if (setupPitstops.length === 0 || !setupPitstops.every((p) => p.status === "Done")) return false;

  const hasCatalog = await prisma.catalogTemplateDef.findFirst({
    where: { needsDomain: goal.needsDomain, isActive: true },
    select: { id: true },
  });
  if (!hasCatalog) return false;

  await setCentreLive(goalId);
  return true;
}
