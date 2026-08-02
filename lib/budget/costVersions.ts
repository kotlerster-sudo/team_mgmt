// Publishing and restoring whole cost-registry revisions.
//
// A version is a frozen copy of one scope's rows and their component breakups.
// Publishing captures; restoring replaces. Neither touches an existing budget —
// a budget freezes its own costSnapshot and line components at generation, so a
// version only governs what gets generated next.

import prisma from "@/lib/prisma";
import { logCostChange } from "@/lib/budget/costHistory";

export type VersionItem = {
  itemKey: string;
  domain: string | null;
  unit: string;
  unitCost: number;
  effectiveYear: number;
  notes: string | null;
  derivation: string | null;
  displayGroup: string | null;
  needsDomain: string | null;
};

export type VersionComponent = { label: string; spec: string | null; qty: number; unitCost: number };

export type RegistrySnapshot = {
  items: VersionItem[];
  components: Record<string, VersionComponent[]>;
};

/** Freeze a scope's registry exactly as it stands. Own rows only — inherited ones belong to their own scope. */
export async function captureSnapshot(city: string): Promise<RegistrySnapshot> {
  const [rows, comps] = await Promise.all([
    prisma.costRegistry.findMany({
      where: { city },
      select: {
        itemKey: true, domain: true, unit: true, unitCost: true, effectiveYear: true,
        notes: true, derivation: true, displayGroup: true, needsDomain: true,
      },
      orderBy: { itemKey: "asc" },
    }),
    prisma.costRegistryComponent.findMany({
      where: { city },
      orderBy: { position: "asc" },
      select: { parentItemKey: true, label: true, spec: true, qty: true, unitCost: true },
    }),
  ]);
  const components: Record<string, VersionComponent[]> = {};
  for (const c of comps) {
    (components[c.parentItemKey] ??= []).push({ label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost });
  }
  return { items: rows, components };
}

export async function publishRegistryVersion(
  city: string,
  meta: { label: string; effectiveFrom: Date; notes?: string | null; publishedById?: string },
) {
  const snapshot = await captureSnapshot(city);
  // A unit that inherits everything has no rates of its own to freeze, and an
  // empty version would delete the unit's whole registry on restore.
  if (snapshot.items.length === 0) throw new Error(`${city} has no cost rows of its own to publish`);

  return prisma.costRegistryVersion.create({
    data: {
      city,
      label: meta.label,
      notes: meta.notes ?? null,
      effectiveFrom: meta.effectiveFrom,
      publishedById: meta.publishedById ?? null,
      snapshot: snapshot as unknown as object,
    },
    select: { id: true, label: true },
  });
}

/**
 * Make the scope's live registry match a published version again.
 *
 * Keys added since the version was published are deleted, not left behind: a
 * version is the whole registry at a point in time, and a half-restored scope
 * would be neither the old rates nor the new ones.
 */
export async function restoreRegistryVersion(versionId: string, restoredById?: string) {
  const version = await prisma.costRegistryVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error("Version not found");

  const { city, label } = version;
  const snap = version.snapshot as unknown as RegistrySnapshot;
  const snapByKey = new Map(snap.items.map((i) => [i.itemKey, i]));

  const live = await prisma.costRegistry.findMany({
    where: { city },
    select: { id: true, itemKey: true, domain: true, unitCost: true },
  });
  const liveByKey = new Map(live.map((r) => [r.itemKey, r]));

  await prisma.$transaction(async (tx) => {
    for (const key of liveByKey.keys()) {
      if (snapByKey.has(key)) continue;
      const row = liveByKey.get(key)!;
      await tx.costRegistryComponent.deleteMany({ where: { city, parentItemKey: key } });
      await tx.costRegistry.delete({ where: { id: row.id } });
      await logCostChange(tx, {
        city, domain: row.domain, itemKey: key,
        oldCost: row.unitCost, newCost: null,
        source: `restore: ${label}`, changedById: restoredById,
      });
    }

    for (const item of snap.items) {
      const before = liveByKey.get(item.itemKey);
      await tx.costRegistry.upsert({
        where: { city_itemKey: { city, itemKey: item.itemKey } },
        create: { city, ...item },
        update: {
          domain: item.domain, unit: item.unit, unitCost: item.unitCost,
          effectiveYear: item.effectiveYear, notes: item.notes, derivation: item.derivation,
          displayGroup: item.displayGroup, needsDomain: item.needsDomain,
        },
      });
      await logCostChange(tx, {
        city, domain: item.domain, itemKey: item.itemKey,
        oldCost: before?.unitCost ?? null, newCost: item.unitCost,
        source: `restore: ${label}`, changedById: restoredById,
      });
    }

    await tx.costRegistryComponent.deleteMany({ where: { city } });
    const rows = Object.entries(snap.components).flatMap(([parentItemKey, comps]) =>
      comps.map((c, i) => ({ city, parentItemKey, position: i, label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost })),
    );
    if (rows.length > 0) await tx.costRegistryComponent.createMany({ data: rows });
  });

  return { restored: snap.items.length };
}
