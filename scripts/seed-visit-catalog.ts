// Demo seed for the visit-driven ops MVP:
//   1. Upserts a Creche visit catalog (2 categories, cadence 1/month).
//   2. Flips one existing Creche goal → live (snapshot + cadence + recurring pitstop).
// Idempotent. Run: npx tsx scripts/seed-visit-catalog.ts
import prisma from "@/lib/prisma";
import { setCentreLive } from "@/lib/operations/goLive";
import { normalizeCategories, type CatalogCategory } from "@/lib/catalogDb";

const CRECHE_CATEGORIES: CatalogCategory[] = [
  {
    key: "safety",
    label: "Safety",
    items: [
      { key: "play-area-hazards", text: "Check play area for hazards", completionType: "Activity", blocksSignoff: true },
      { key: "first-aid-kit", text: "Verify first-aid kit is stocked", completionType: "Activity", blocksSignoff: true },
    ],
  },
  {
    key: "caregiver-practices",
    label: "Caregiver Practices",
    items: [
      { key: "caregiver-interaction", text: "Observe caregiver–child interaction", completionType: "Activity", blocksSignoff: true },
      { key: "attendance-register", text: "Review attendance register", completionType: "", blocksSignoff: false },
    ],
  },
];

async function main() {
  const slug = "creche-visit-catalog";
  const catalog = await prisma.catalogTemplateDef.upsert({
    where: { slug },
    update: {
      name: "Creche visit catalog",
      needsDomain: "Creche",
      categories: normalizeCategories(CRECHE_CATEGORIES) as object[],
      defaultCadenceCount: 1,
      defaultCadencePeriod: "month",
      isActive: true,
    },
    create: {
      slug,
      name: "Creche visit catalog",
      needsDomain: "Creche",
      categories: normalizeCategories(CRECHE_CATEGORIES) as object[],
      defaultCadenceCount: 1,
      defaultCadencePeriod: "month",
      isActive: true,
    },
    select: { id: true, slug: true },
  });
  console.log(`✓ Catalog upserted: ${catalog.slug} (${catalog.id})`);

  // Prefer a creche goal that already has a cluster so it shows on the cluster-first landing.
  const goal =
    (await prisma.goal.findFirst({
      where: { needsDomain: "Creche", deletedAt: null, needsClusterId: { not: null } },
      select: { id: true, title: true },
    })) ??
    (await prisma.goal.findFirst({
      where: { needsDomain: "Creche", deletedAt: null, needsSettlementId: { not: null } },
      select: { id: true, title: true },
    })) ??
    (await prisma.goal.findFirst({
      where: { needsDomain: "Creche", deletedAt: null },
      select: { id: true, title: true },
    }));

  if (!goal) {
    console.log("! No Creche goal found to flip live — catalog seeded only.");
    return;
  }

  const result = await setCentreLive(goal.id);
  const ctx = await prisma.goal.findUnique({
    where: { id: goal.id },
    select: {
      needsCluster: { select: { name: true } },
      needsSettlement: { select: { name: true, cluster: { select: { name: true } } } },
    },
  });
  console.log(`✓ Live: "${goal.title}" (${goal.id})`);
  console.log(`  catalog=${result.catalogSlug} categories=${result.seededCategories} livePitstop=${result.livePitstopId} alreadyLive=${result.alreadyLive}`);
  console.log(`  cluster=${ctx?.needsCluster?.name ?? ctx?.needsSettlement?.cluster?.name ?? "(none)"} settlement=${ctx?.needsSettlement?.name ?? "(none)"}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
