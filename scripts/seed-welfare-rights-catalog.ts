/**
 * Author the WelfareRights visit catalog, derived from the `welfare-rights-temp` goal template
 * ("Welfare Rights Programme (temporary)" — the NON-existing/temporary variant, per request).
 *
 * Every item is TAGGED (ref → welfare-rights-temp::<checklistKey>) so completion runs through the
 * standard checklist→activity flow with the right completionType (Voice / Upload / Activity). This
 * template currently has NO indicator bindings, so nothing fires yet — bindings can be added later
 * on (welfare-rights-temp, checklistKey) and they'll light up without touching the catalog.
 *
 * Cadence = weekly (the Cluster Review Meeting rhythm). Civic-mapping (one-time rollout) and monthly
 * land-title items are non-blocking so they don't gate a weekly close.
 *
 * Refreshes the snapshot of any live WelfareRights centre that went live menu-less (only where empty
 * & uncustomised). welfare-rights-temp is not an `-existing` template, so goals are born setup — there
 * may be 0 live centres today; the catalog is then just staged for future go-lives.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/seed-welfare-rights-catalog.ts [--dry]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import type { Prisma } from "../app/generated/prisma/client";
import { normalizeCategories, type CatalogCategory } from "../lib/catalogDb";

const TEMPLATE_SLUG = "welfare-rights-temp";
const CATALOG_SLUG = "welfare-rights-visit-catalog";
const DOMAIN = "WelfareRights";
const CADENCE = { count: 1, period: "week" as const };

const tag = (checklistKey: string) => ({ templateSlug: TEMPLATE_SLUG, checklistKey });
const item = (checklistKey: string, text: string, completionType: string, blocksSignoff: boolean) =>
  ({ key: checklistKey, text, completionType, blocksSignoff, ref: tag(checklistKey) });

const CATEGORIES: CatalogCategory[] = [
  {
    key: "cluster-review-meeting",
    label: "Cluster Review Meeting (weekly)",
    items: [
      item("check-on-the-status-of-community-groups-formation-and-regularity", "Community groups formation & regularity checked", "Activity", true),
      item("update-on-work-on-gbv", "GBV work update taken", "Activity", true),
      item("mahila-arogya-samitis", "Mahila Arogya Samitis status updated", "Activity", true),
      item("community-leaders", "Community leaders identified & meeting planned", "Activity", false),
      item("federation-of-community-groups-at-cluster-and-city-level", "Federation of community groups progressed", "Activity", false),
      item("review-of-bucketing-list-of-the-selected-schemes", "Scheme applications (bucketing list) reviewed", "Activity", true),
    ],
  },
  {
    key: "civic-amenities-mapping",
    label: "Civic Amenities Baseline Mapping",
    items: [
      item("complete-co-training-on-mapping-tool-and-mobile-application", "COs trained on mapping tool & app", "Voice", false),
      item("roll-out-of-civic-amenities-baseline", "Civic amenities baseline rolled out", "Activity", false),
      item("map-other-settlement-specific-civic-issues-identified-by-community", "Other settlement civic issues mapped", "Activity", false),
      item("compile-findings-for-all-14-settlements", "Compiled findings cover all settlements", "Upload", false),
      item("share-settlement-level-mapping-reports-with-community-groups-and-cluster-coordin", "Settlement mapping reports shared", "Activity", false),
      item("prioritise-top-3-issues-per-settlement-for-action-planning", "Top 3 issues per settlement prioritised", "Activity", false),
    ],
  },
  {
    key: "land-title-housing-rights",
    label: "Land Title & Housing Rights (monthly)",
    items: [
      item("train-cos-on-land-title-deed-eligibility-criteria-and-application-process", "COs trained on land-title eligibility & process", "Voice", false),
      item("identify-eligible-households-in-each-settlement", "Eligible households identified", "Activity", false),
      item("conduct-application-collection-drives-co-3-days-month-dedicated", "Monthly application-collection drives run", "Activity", false),
    ],
  },
];

async function main() {
  const dry = process.argv.includes("--dry");
  const categories = normalizeCategories(CATEGORIES);
  const itemCount = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`[welfare-catalog] ${categories.length} categories · ${itemCount} tagged items · cadence ${CADENCE.count}/${CADENCE.period}${dry ? " (DRY)" : ""}`);

  const def = await prisma.goalTemplateDef.findUnique({ where: { slug: TEMPLATE_SLUG }, select: { pitstops: true } });
  const tplKeys = new Set<string>();
  for (const p of (def?.pitstops ?? []) as { checklist?: { key?: string }[] }[])
    for (const c of p.checklist ?? []) if (c.key) tplKeys.add(c.key);
  const missing = categories.flatMap((c) => c.items).filter((i) => i.ref && !tplKeys.has(i.ref.checklistKey));
  if (missing.length) {
    console.error(`[welfare-catalog] ABORT — ${missing.length} ref(s) not found in ${TEMPLATE_SLUG}:`);
    for (const m of missing) console.error(`   ✗ ${m.ref!.checklistKey}`);
    process.exit(1);
  }
  console.log(`[welfare-catalog] all ${itemCount} refs resolve against the goal template ✓`);

  if (dry) { console.log("[welfare-catalog] dry run — nothing written."); await prisma.$disconnect(); return; }

  const catalog = await prisma.catalogTemplateDef.upsert({
    where: { slug: CATALOG_SLUG },
    update: { name: "Welfare Rights visit catalog", needsDomain: DOMAIN, categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true },
    create: { slug: CATALOG_SLUG, name: "Welfare Rights visit catalog", needsDomain: DOMAIN, categories: categories as object[], defaultCadenceCount: CADENCE.count, defaultCadencePeriod: CADENCE.period, isActive: true },
    select: { slug: true },
  });
  console.log(`[welfare-catalog] ✓ catalog upserted: ${catalog.slug}`);

  const centres = await prisma.centreCatalog.findMany({
    where: { goal: { needsDomain: DOMAIN, deletedAt: null, mode: "live" } },
    select: { id: true, goalId: true, catalogSlug: true, snapshot: true, overrides: true, goal: { select: { title: true } } },
  });
  const empty = centres.filter((c) => {
    const snap = (c.snapshot ?? []) as unknown[];
    const ov = (c.overrides ?? {}) as { addedItems?: unknown[]; addedCategories?: unknown[] };
    return snap.length === 0 && !(ov.addedItems?.length) && !(ov.addedCategories?.length);
  });
  console.log(`[welfare-catalog] live ${DOMAIN} centres: ${centres.length} · empty & untouched (will refresh): ${empty.length}`);
  if (empty.length) {
    const dir = join(process.cwd(), "rbac-backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `welfare-catalog-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(empty.map((c) => ({ goalId: c.goalId, title: c.goal.title, priorCatalogSlug: c.catalogSlug })), null, 2));
    for (const c of empty) {
      await prisma.centreCatalog.update({ where: { id: c.id }, data: { catalogSlug: CATALOG_SLUG, snapshot: categories as unknown as Prisma.InputJsonValue, cadenceCount: CADENCE.count, cadencePeriod: CADENCE.period } });
      console.log(`   ✓ refreshed: ${c.goal.title}`);
    }
    console.log(`[welfare-catalog] pre-state backup → ${file}`);
  }
  console.log("[welfare-catalog] done.");
}

main().catch((e) => { console.error("[welfare-catalog] FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
