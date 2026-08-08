/**
 * Set trainingModule on the 93 caregiver practices per the Urban Module Map
 * (M1–M4). Targeted: touches ONLY trainingModule (matched by code), so admin
 * edits to labels/text are untouched. Idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/set-caregiver-training-modules.ts
 *
 * ⚠ .env.local = prod. Additive/idempotent.
 */

import prisma from "../lib/prisma";
import { CAREGIVER_PRACTICES } from "../prisma/data/caregiver-practices";

async function main() {
  let updated = 0,
    unchanged = 0,
    missing = 0;
  for (const p of CAREGIVER_PRACTICES) {
    const existing = await prisma.caregiverPractice.findUnique({ where: { code: p.code }, select: { trainingModule: true } });
    if (!existing) {
      console.warn(`  ! ${p.code} not found in DB`);
      missing++;
      continue;
    }
    if (existing.trainingModule === p.trainingModule) {
      unchanged++;
      continue;
    }
    await prisma.caregiverPractice.update({ where: { code: p.code }, data: { trainingModule: p.trainingModule } });
    updated++;
  }
  // Report resulting distribution.
  const dist = await prisma.caregiverPractice.groupBy({ by: ["trainingModule"], _count: { _all: true }, orderBy: { trainingModule: "asc" } });
  console.log(`Updated ${updated}, unchanged ${unchanged}${missing ? `, missing ${missing}` : ""}.`);
  console.log("Distribution:", dist.map((d) => `M${d.trainingModule ?? "?"}=${d._count._all}`).join("  "));
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
