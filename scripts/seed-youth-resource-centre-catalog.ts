/**
 * Author the YouthResourceCentre visit catalog, derived from the `youth-resource-centre-existing`
 * goal template (its 2 pitstops → checklist items → activities → indicator bindings).
 *
 * Every item is TAGGED (ref → youth-resource-centre-existing::<checklistKey>) so the 3 live indicator
 * bindings (youth attending CAP review / CAP milestones / open blockers) fire on completion, and each
 * item's completionType mirrors its template activity (Voice / Upload / Activity).
 *
 * Cadence = weekly (the YRC visit rhythm). The monthly training items are non-blocking so they don't
 * gate a weekly close; the core weekly items (+ the two mandatory indicator ones) block sign-off.
 *
 * Also REFRESHES the snapshot of any live YouthResourceCentre centre that went live with an empty menu
 * (the 2026-07-29 backfill, when no catalog existed) — only where the snapshot is still empty and the
 * centre is uncustomised, so it never clobbers RP additions. Writes a reversible pre-state backup.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/seed-youth-resource-centre-catalog.ts
 *      add --dry to preview.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import type { Prisma } from "../app/generated/prisma/client";
import { normalizeCategories, type CatalogCategory } from "../lib/catalogDb";

const TEMPLATE_SLUG = "youth-resource-centre-existing";
const CATALOG_SLUG = "youth-resource-centre-visit-catalog";
const DOMAIN = "YouthResourceCentre";
const CADENCE = { count: 1, period: "week" as const };

const tag = (checklistKey: string) => ({ templateSlug: TEMPLATE_SLUG, checklistKey });
const item = (checklistKey: string, text: string, completionType: string, blocksSignoff: boolean) =>
  ({ key: checklistKey, text, completionType, blocksSignoff, ref: tag(checklistKey) });

const CATEGORIES: CatalogCategory[] = [
  {
    key: "yrc-visit-cap-review",
    label: "YRC Visit & CAP Review (weekly)",
    items: [
      item("youth-resource-centre-visited", "Youth Resource Centre visited", "Voice", true),
      item("youth-groups-met-for-cap-review", "Youth groups met for CAP review", "Activity", true), // ★ Youth attending CAP review
      item("cap-milestones-status-updated", "CAP milestones status updated", "Activity", true), // ★ CAP milestones completed this week
      item("blockers-and-issues-logged", "Blockers and issues logged", "Activity", false), // ★ YRC open blockers
      item("wins-noted-for-motivation-and-documentation", "CAP project wins documented", "Upload", false),
      item("next-saturday-priorities-agreed-with-coordinator", "Next week priorities agreed with coordinator", "Activity", true),
    ],
  },
  {
    key: "monthly-training",
    label: "Monthly Training",
    items: [
      item("training-topic-aligned-with-monthly-plan", "Plan and schedule the monthly training", "Activity", false),
      item("full-session-attended", "Youth team mobilised for training", "Voice", false),
      item("attendance-recorded", "Monthly training conducted", "Upload", false),
    ],
  },
];

async function main() {
  const dry = process.argv.includes("--dry");
  const categories = normalizeCategories(CATEGORIES);
  const itemCount = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`[yrc-catalog] ${categories.length} categories · ${itemCount} tagged items · cadence ${CADENCE.count}/${CADENCE.period}${dry ? " (DRY)" : ""}`);

  // Sanity: every ref.checklistKey must exist in the goal template (else it materialises nothing).
  const def = await prisma.goalTemplateDef.findUnique({ where: { slug: TEMPLATE_SLUG }, select: { pitstops: true } });
  const tplKeys = new Set<string>();
  for (const p of (def?.pitstops ?? []) as { checklist?: { key?: string }[] }[])
    for (const c of p.checklist ?? []) if (c.key) tplKeys.add(c.key);
  const missing = categories.flatMap((c) => c.items).filter((i) => i.ref && !tplKeys.has(i.ref.checklistKey));
  if (missing.length) {
    console.error(`[yrc-catalog] ABORT — ${missing.length} ref(s) not found in ${TEMPLATE_SLUG}:`);
    for (const m of missing) console.error(`   ✗ ${m.ref!.checklistKey}`);
    process.exit(1);
  }
  console.log(`[yrc-catalog] all ${itemCount} refs resolve against the goal template ✓`);

  if (dry) { console.log("[yrc-catalog] dry run — nothing written."); await prisma.$disconnect(); return; }

  const catalog = await prisma.catalogTemplateDef.upsert({
    where: { slug: CATALOG_SLUG },
    update: {
      name: "Youth Resource Centre visit catalog", needsDomain: DOMAIN,
      categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true,
    },
    create: {
      slug: CATALOG_SLUG, name: "Youth Resource Centre visit catalog", needsDomain: DOMAIN,
      categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true,
    },
    select: { slug: true },
  });
  console.log(`[yrc-catalog] ✓ catalog upserted: ${catalog.slug}`);

  const centres = await prisma.centreCatalog.findMany({
    where: { goal: { needsDomain: DOMAIN, deletedAt: null, mode: "live" } },
    select: { id: true, goalId: true, catalogSlug: true, snapshot: true, overrides: true, goal: { select: { title: true } } },
  });
  const empty = centres.filter((c) => {
    const snap = (c.snapshot ?? []) as unknown[];
    const ov = (c.overrides ?? {}) as { addedItems?: unknown[]; addedCategories?: unknown[] };
    return snap.length === 0 && !(ov.addedItems?.length) && !(ov.addedCategories?.length);
  });
  console.log(`[yrc-catalog] live ${DOMAIN} centres: ${centres.length} · empty & untouched (will refresh): ${empty.length}`);

  if (empty.length) {
    const backup = empty.map((c) => ({ goalId: c.goalId, title: c.goal.title, priorCatalogSlug: c.catalogSlug }));
    const dir = join(process.cwd(), "rbac-backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `yrc-catalog-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(backup, null, 2));
    for (const c of empty) {
      await prisma.centreCatalog.update({
        where: { id: c.id },
        data: { catalogSlug: CATALOG_SLUG, snapshot: categories as unknown as Prisma.InputJsonValue, cadenceCount: CADENCE.count, cadencePeriod: CADENCE.period },
      });
      console.log(`   ✓ refreshed: ${c.goal.title}`);
    }
    console.log(`[yrc-catalog] pre-state backup → ${file}`);
  }

  console.log("[yrc-catalog] done.");
}

main()
  .catch((e) => { console.error("[yrc-catalog] FAILED:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
