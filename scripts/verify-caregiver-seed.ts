/**
 * READ-ONLY verification for the caregiver-practice rollout.
 *   - taxonomy counts (8 categories / 93 practices)
 *   - launcher item present in every live creche's effective catalog
 *   - carry-forward DISTINCT ON query runs (open-flag derivation)
 * No writes.
 *
 *   npx tsx --env-file=.env.local scripts/verify-caregiver-seed.ts
 */

import prisma from "../lib/prisma";
import { resolveEffectiveCatalog, type CatalogCategory, type CentreCatalogOverrides } from "../lib/catalogDb";
import { CAREGIVER_PRACTICES_LAUNCHER_KEY } from "../lib/caregiverPractices";

async function main() {
  let problems = 0;

  const cats = await prisma.caregiverPracticeCategory.count();
  const practices = await prisma.caregiverPractice.count();
  const active = await prisma.caregiverPractice.count({ where: { isActive: true } });
  console.log(`Taxonomy: ${cats} categories, ${practices} practices (${active} active)`);
  if (cats !== 8) { console.log(`  ! expected 8 categories`); problems++; }
  if (practices !== 93) { console.log(`  ! expected 93 practices`); problems++; }

  // Per-category breakdown
  const byCat = await prisma.caregiverPracticeCategory.findMany({
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, _count: { select: { practices: true } } },
  });
  for (const c of byCat) console.log(`  ${c.code.padEnd(3)} ${c.name.padEnd(24)} ${c._count.practices}`);

  // Launcher present in every live creche's effective catalog?
  const centres = await prisma.centreCatalog.findMany({
    where: { goal: { needsDomain: "Creche", deletedAt: null } },
    select: { snapshot: true, overrides: true, goal: { select: { title: true } } },
  });
  let withLauncher = 0;
  for (const c of centres) {
    const eff = resolveEffectiveCatalog(
      (c.snapshot as unknown as CatalogCategory[]) ?? [],
      (c.overrides as unknown as CentreCatalogOverrides) ?? {},
    );
    const has = eff.some((cat) => cat.items.some((i) => i.key === CAREGIVER_PRACTICES_LAUNCHER_KEY));
    if (has) withLauncher++;
    else { console.log(`  ! no launcher in effective catalog: ${c.goal.title}`); problems++; }
  }
  console.log(`Launcher present in ${withLauncher}/${centres.length} live creche catalogs`);

  // Carry-forward query smoke test (uses a real facility if any observations exist).
  const obsCount = await prisma.caregiverPracticeObservation.count();
  console.log(`Observations so far: ${obsCount}`);
  const sampleFacility = await prisma.layerFeature.findFirst({ where: { layerKey: "creches" }, select: { id: true } });
  if (sampleFacility) {
    const open = await prisma.$queryRaw<{ practiceId: string; status: string }[]>`
      SELECT DISTINCT ON (o."practiceId") o."practiceId", o.status::text AS status
      FROM "CaregiverPracticeObservation" o
      JOIN "CaregiverPractice" pr ON pr.id = o."practiceId"
      WHERE o."facilityId" = ${sampleFacility.id} AND pr."isActive" = true
      ORDER BY o."practiceId", o."capturedAt" DESC, o.id DESC
    `;
    console.log(`Carry-forward query ran (sample facility): ${open.length} latest-per-practice rows`);
  }

  console.log(`\n${problems === 0 ? "✓ All checks pass." : `✗ ${problems} problem(s).`}`);
  if (problems) process.exitCode = 1;
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
