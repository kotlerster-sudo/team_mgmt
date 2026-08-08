/**
 * Seed the caregiver-practice taxonomy (8 categories, 93 practices) from the
 * checked-in data module. Additive-upsert by `code` — existing rows are left
 * untouched by default (so admin edits via /settings/caregiver-practices
 * survive re-runs), and observations are never affected.
 *
 *   npx tsx --env-file=.env.local scripts/seed-caregiver-practices.ts
 *   SEED_FORCE_TAXONOMY=1 npx tsx --env-file=.env.local scripts/seed-caregiver-practices.ts   # overwrite labels/text/order
 *
 * ⚠ .env.local points at prod — this writes taxonomy rows to prod. Safe/additive.
 */

import prisma from "../lib/prisma";
import { CAREGIVER_PRACTICE_CATEGORIES, CAREGIVER_PRACTICES } from "../prisma/data/caregiver-practices";

const FORCE = process.env.SEED_FORCE_TAXONOMY === "1";

async function main() {
  let catCreated = 0,
    catUpdated = 0;
  const catIdByCode = new Map<string, string>();
  for (const c of CAREGIVER_PRACTICE_CATEGORIES) {
    const existing = await prisma.caregiverPracticeCategory.findUnique({ where: { code: c.code } });
    const row = await prisma.caregiverPracticeCategory.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, sortOrder: c.sortOrder },
      update: FORCE ? { name: c.name, sortOrder: c.sortOrder } : {},
    });
    catIdByCode.set(c.code, row.id);
    existing ? catUpdated++ : catCreated++;
  }

  let pCreated = 0,
    pUpdated = 0,
    pSkipped = 0;
  for (const p of CAREGIVER_PRACTICES) {
    const categoryId = catIdByCode.get(p.categoryCode);
    if (!categoryId) {
      console.warn(`  ! practice ${p.code}: unknown category ${p.categoryCode}, skipping`);
      pSkipped++;
      continue;
    }
    const existing = await prisma.caregiverPractice.findUnique({ where: { code: p.code } });
    await prisma.caregiverPractice.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        categoryId,
        subcategory: p.subcategory,
        shortLabel: p.shortLabel,
        fullText: p.fullText,
        trainingModule: p.trainingModule,
        sortOrder: p.sortOrder,
      },
      update: FORCE
        ? {
            categoryId,
            subcategory: p.subcategory,
            shortLabel: p.shortLabel,
            fullText: p.fullText,
            trainingModule: p.trainingModule,
            sortOrder: p.sortOrder,
          }
        : {},
    });
    existing ? pUpdated++ : pCreated++;
  }

  console.log(
    `Categories: ${catCreated} created, ${catUpdated} ${FORCE ? "updated" : "left as-is"}.\n` +
      `Practices:  ${pCreated} created, ${pUpdated} ${FORCE ? "updated" : "left as-is"}${pSkipped ? `, ${pSkipped} skipped` : ""}.\n` +
      `${FORCE ? "(SEED_FORCE_TAXONOMY: overwrote existing rows.)" : "(additive: existing rows preserved; set SEED_FORCE_TAXONOMY=1 to overwrite.)"}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
