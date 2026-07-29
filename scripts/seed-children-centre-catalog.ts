/**
 * Author the ChildrenCentre visit catalog, derived from the `children-learning-centre-existing`
 * goal template (its 3 pitstops → checklist items → activities → indicator bindings).
 *
 * Every item is TAGGED (ref → children-learning-centre-existing::<checklistKey>) so the 4 live
 * indicator bindings (attendance / learning-quality / infrastructure-needs / out-of-school) fire on
 * completion, and each item's completionType mirrors its template activity (Voice / Upload / Activity).
 *
 * Cadence = weekly (the centre-visit rhythm). Monthly items (training, govt-school) are non-blocking
 * so they don't gate a weekly visit close; the core weekly monitoring items (+ the two indicator-
 * bearing weekly ones) block sign-off so their numbers get captured each visit.
 *
 * Also REFRESHES the snapshot of any live ChildrenCentre centre that went live with an empty menu
 * (the 2026-07-29 backfill, when no catalog existed) — only where the snapshot is still empty, so it
 * never clobbers a centre an RP has customised. Writes a reversible pre-state backup.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/seed-children-centre-catalog.ts
 *      add --dry to preview.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import type { Prisma } from "../app/generated/prisma/client";
import { normalizeCategories, type CatalogCategory } from "../lib/catalogDb";

const TEMPLATE_SLUG = "children-learning-centre-existing";
const CATALOG_SLUG = "children-centre-visit-catalog";
const DOMAIN = "ChildrenCentre";
const CADENCE = { count: 1, period: "week" as const };

// text = clean display label; key + ref.checklistKey = the exact template checklist key (binds indicators);
// completionType mirrors the template activity; blocksSignoff = must-do-per-visit (weekly core only).
const tag = (checklistKey: string) => ({ templateSlug: TEMPLATE_SLUG, checklistKey });
const item = (checklistKey: string, text: string, completionType: string, blocksSignoff: boolean) =>
  ({ key: checklistKey, text, completionType, blocksSignoff, ref: tag(checklistKey) });

const CATEGORIES: CatalogCategory[] = [
  {
    key: "centre-visit",
    label: "Centre Visit (weekly)",
    items: [
      item("visit-1-this-week-centre-activity-for-the-day-observed", "Centre activity for the day observed", "Voice", true),
      item("visit-1-coordinator-supported-on-planned-activity", "Coordinator supported on planned activity", "Activity", false),
      item("visit-1-attendance-register-reviewed", "Attendance register reviewed", "Activity", true), // ★ CLC children attending
      item("visit-1-learning-quality-spot-check-done", "Learning quality spot-check done", "Activity", true), // ★ CLC learning quality score
      item("visit-1-infrastructure-material-needs-flagged", "Infrastructure / material needs flagged", "Activity", false), // ★ open infra/material needs
      item("visit-1-coordinator-debrief-completed", "Coordinator debrief completed", "Activity", true),
      item("outreach-work-review-for-last-week-with-cos", "Outreach work reviewed with COs (last week)", "Activity", false),
      item("individual-plans-for-each-child-who-has-dropped-out-of-school", "Individual plans for each drop-out child", "Activity", false),
    ],
  },
  {
    key: "monthly-training",
    label: "Monthly Training",
    items: [
      item("training-topic-aligned-with-monthly-plan", "Plan and schedule the monthly training", "Activity", false),
      item("ensure-all-partner-children-team-from-the-cluster-attends-the-training", "Partner children team mobilised for training", "Voice", false),
      item("full-session-attended", "Monthly training completed", "Upload", false),
    ],
  },
  {
    key: "govt-school-coordination",
    label: "Govt School & DI Coordination",
    items: [
      item("target-school-s-visited-or-di-contacted", "Nearby govt school visited with DI support", "Voice", false),
      item("out-of-school-children-list-updated", "Out-of-school children list updated", "Activity", false), // ★ out-of-school pending
      item("school-engagement-plan-progressed", "School engagement plan progressed", "Activity", false),
      item("next-steps-documented-and-assigned", "Next steps documented and assigned", "Activity", false),
    ],
  },
];

async function main() {
  const dry = process.argv.includes("--dry");
  const categories = normalizeCategories(CATEGORIES);
  const itemCount = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`[cc-catalog] ${categories.length} categories · ${itemCount} tagged items · cadence ${CADENCE.count}/${CADENCE.period}${dry ? " (DRY)" : ""}`);

  // Sanity: every ref.checklistKey must exist in the goal template (else it materialises nothing).
  const def = await prisma.goalTemplateDef.findUnique({ where: { slug: TEMPLATE_SLUG }, select: { pitstops: true } });
  const tplKeys = new Set<string>();
  for (const p of (def?.pitstops ?? []) as { checklist?: { key?: string; text?: string }[] }[])
    for (const c of p.checklist ?? []) if (c.key) tplKeys.add(c.key);
  const missing = categories.flatMap((c) => c.items).filter((i) => i.ref && !tplKeys.has(i.ref.checklistKey));
  if (missing.length) {
    console.error(`[cc-catalog] ABORT — ${missing.length} ref(s) not found in ${TEMPLATE_SLUG}:`);
    for (const m of missing) console.error(`   ✗ ${m.ref!.checklistKey}`);
    process.exit(1);
  }
  console.log(`[cc-catalog] all ${itemCount} refs resolve against the goal template ✓`);

  if (dry) { console.log("[cc-catalog] dry run — nothing written."); await prisma.$disconnect(); return; }

  // 1. Upsert the catalog def.
  const catalog = await prisma.catalogTemplateDef.upsert({
    where: { slug: CATALOG_SLUG },
    update: {
      name: "Children Centre visit catalog", needsDomain: DOMAIN,
      categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true,
    },
    create: {
      slug: CATALOG_SLUG, name: "Children Centre visit catalog", needsDomain: DOMAIN,
      categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true,
    },
    select: { id: true, slug: true },
  });
  console.log(`[cc-catalog] ✓ catalog upserted: ${catalog.slug}`);

  // 2. Refresh empty snapshots on already-live ChildrenCentre centres (backfill went live menu-less).
  const centres = await prisma.centreCatalog.findMany({
    where: { goal: { needsDomain: DOMAIN, deletedAt: null, mode: "live" } },
    select: { id: true, goalId: true, catalogSlug: true, snapshot: true, overrides: true, goal: { select: { title: true } } },
  });
  const empty = centres.filter((c) => {
    const snap = (c.snapshot ?? []) as unknown[];
    const ov = (c.overrides ?? {}) as { addedItems?: unknown[]; addedCategories?: unknown[] };
    const untouched = !(ov.addedItems?.length) && !(ov.addedCategories?.length);
    return snap.length === 0 && untouched; // never seeded a menu + not customised
  });
  console.log(`[cc-catalog] live ${DOMAIN} centres: ${centres.length} · empty & untouched (will refresh): ${empty.length}`);

  if (empty.length) {
    const backup = empty.map((c) => ({ goalId: c.goalId, title: c.goal.title, priorCatalogSlug: c.catalogSlug, priorSnapshotLen: 0 }));
    const dir = join(process.cwd(), "rbac-backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `cc-catalog-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(backup, null, 2));

    for (const c of empty) {
      await prisma.centreCatalog.update({
        where: { id: c.id },
        data: {
          catalogSlug: CATALOG_SLUG,
          snapshot: categories as unknown as Prisma.InputJsonValue,
          cadenceCount: CADENCE.count,
          cadencePeriod: CADENCE.period,
        },
      });
      console.log(`   ✓ refreshed: ${c.goal.title}`);
    }
    console.log(`[cc-catalog] pre-state backup → ${file}`);
  }

  console.log("[cc-catalog] done.");
}

main()
  .catch((e) => { console.error("[cc-catalog] FAILED:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
