/**
 * Author the ElderlyCentre visit catalog, derived from the `elderly-centre-existing` goal template
 * ("Elderly Care Centre & Outreach (Existing)").
 *
 * Every item is TAGGED (ref → elderly-centre-existing::<checklistKey>) so the 4 live indicator
 * bindings (open issues / corrective actions closed / home visits / referrals) fire on completion.
 *
 * Cadence = monthly (both template pitstops are monthly review rhythms). Core review + the four
 * indicator-bearing items block sign-off; the rest are non-blocking.
 *
 * Refreshes the snapshot of any live ElderlyCentre centre that went live menu-less (only where empty
 * & uncustomised). There may be 0 today (no elderly `-existing` goals existed at the backfill); the
 * catalog is then staged so future go-lives snapshot it.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/seed-elderly-centre-catalog.ts [--dry]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import type { Prisma } from "../app/generated/prisma/client";
import { normalizeCategories, type CatalogCategory } from "../lib/catalogDb";

const TEMPLATE_SLUG = "elderly-centre-existing";
const CATALOG_SLUG = "elderly-centre-visit-catalog";
const DOMAIN = "ElderlyCentre";
const CADENCE = { count: 1, period: "month" as const };

const tag = (checklistKey: string) => ({ templateSlug: TEMPLATE_SLUG, checklistKey });
const item = (checklistKey: string, text: string, completionType: string, blocksSignoff: boolean) =>
  ({ key: checklistKey, text, completionType, blocksSignoff, ref: tag(checklistKey) });

const CATEGORIES: CatalogCategory[] = [
  {
    key: "monthly-reflection-review",
    label: "Monthly Reflection & Review",
    items: [
      item("monthly-reviews-recurring", "Monthly reviews recurring", "Activity", true),
      item("issue-tracker-active", "Issue tracker active", "Activity", true), // ★ Elderly programme open issues
      item("corrective-actions-followed-up", "Corrective actions followed up", "Activity", true), // ★ Corrective actions closed
      item("learnings-converted-to-actions", "Learnings converted to actions", "Activity", false),
    ],
  },
  {
    key: "minimum-service-standards",
    label: "Minimum Service Standards",
    items: [
      item("assessments-completed", "Assessments completed", "Activity", true),
      item("home-visits-active", "Home visits active", "Activity", true), // ★ Elderly home visits this month
      item("referral-systems-active", "Referral systems active", "Activity", true), // ★ Elderly referrals made
      item("forums-started", "Elder forums started", "Activity", false),
      item("mis-reporting-active-in-all-clusters", "MIS reporting active across clusters", "Activity", false),
    ],
  },
];

async function main() {
  const dry = process.argv.includes("--dry");
  const categories = normalizeCategories(CATEGORIES);
  const itemCount = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`[elderly-catalog] ${categories.length} categories · ${itemCount} tagged items · cadence ${CADENCE.count}/${CADENCE.period}${dry ? " (DRY)" : ""}`);

  const def = await prisma.goalTemplateDef.findUnique({ where: { slug: TEMPLATE_SLUG }, select: { pitstops: true } });
  const tplKeys = new Set<string>();
  for (const p of (def?.pitstops ?? []) as { checklist?: { key?: string }[] }[])
    for (const c of p.checklist ?? []) if (c.key) tplKeys.add(c.key);
  const missing = categories.flatMap((c) => c.items).filter((i) => i.ref && !tplKeys.has(i.ref.checklistKey));
  if (missing.length) {
    console.error(`[elderly-catalog] ABORT — ${missing.length} ref(s) not found in ${TEMPLATE_SLUG}:`);
    for (const m of missing) console.error(`   ✗ ${m.ref!.checklistKey}`);
    process.exit(1);
  }
  console.log(`[elderly-catalog] all ${itemCount} refs resolve against the goal template ✓`);

  if (dry) { console.log("[elderly-catalog] dry run — nothing written."); await prisma.$disconnect(); return; }

  const catalog = await prisma.catalogTemplateDef.upsert({
    where: { slug: CATALOG_SLUG },
    update: { name: "Elderly Care Centre & Outreach visit catalog", needsDomain: DOMAIN, categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true },
    create: { slug: CATALOG_SLUG, name: "Elderly Care Centre & Outreach visit catalog", needsDomain: DOMAIN, categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true },
    select: { slug: true },
  });
  console.log(`[elderly-catalog] ✓ catalog upserted: ${catalog.slug}`);

  const centres = await prisma.centreCatalog.findMany({
    where: { goal: { needsDomain: DOMAIN, deletedAt: null, mode: "live" } },
    select: { id: true, goalId: true, catalogSlug: true, snapshot: true, overrides: true, goal: { select: { title: true } } },
  });
  const empty = centres.filter((c) => {
    const snap = (c.snapshot ?? []) as unknown[];
    const ov = (c.overrides ?? {}) as { addedItems?: unknown[]; addedCategories?: unknown[] };
    return snap.length === 0 && !(ov.addedItems?.length) && !(ov.addedCategories?.length);
  });
  console.log(`[elderly-catalog] live ${DOMAIN} centres: ${centres.length} · empty & untouched (will refresh): ${empty.length}`);
  if (empty.length) {
    const dir = join(process.cwd(), "rbac-backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `elderly-catalog-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(empty.map((c) => ({ goalId: c.goalId, title: c.goal.title, priorCatalogSlug: c.catalogSlug })), null, 2));
    for (const c of empty) {
      await prisma.centreCatalog.update({ where: { id: c.id }, data: { catalogSlug: CATALOG_SLUG, snapshot: categories as unknown as Prisma.InputJsonValue, cadenceCount: CADENCE.count, cadencePeriod: CADENCE.period } });
      console.log(`   ✓ refreshed: ${c.goal.title}`);
    }
    console.log(`[elderly-catalog] pre-state backup → ${file}`);
  }
  console.log("[elderly-catalog] done.");
}

main().catch((e) => { console.error("[elderly-catalog] FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
