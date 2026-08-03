/**
 * Two BudgetDomainConfig corrections, both drift from UI edits rather than seed.
 *
 *  1. AfterSchoolCentre's beneficiaryLabel was "Children per day", which the cost
 *     analysis renders as "Per children per day" — reading as a daily rate when
 *     the panel is annual. The unit is a daily attendance place.
 *  2. Bangalore's Elderly domain pointed beneficiaryVar at nElderlyTotal, which
 *     drives no line template in either city (all three Elderly templates use
 *     nElderly, as does the seed default and Chennai's row). The per-elderly tile
 *     was dividing enrolment-driven spend by an input nothing else reads.
 *
 * Idempotent: each updateMany only matches the wrong state.
 */
import prisma from "../lib/prisma";

async function main() {
  const label = await prisma.budgetDomainConfig.updateMany({
    where: { key: "AfterSchoolCentre", beneficiaryLabel: "Children per day" },
    data: { beneficiaryLabel: "Child place" },
  });
  console.log(`AfterSchoolCentre beneficiaryLabel → "Child place": ${label.count} row(s)`);

  const varFix = await prisma.budgetDomainConfig.updateMany({
    where: { key: "Elderly", beneficiaryVar: "nElderlyTotal" },
    data: { beneficiaryVar: "nElderly" },
  });
  console.log(`Elderly beneficiaryVar → "nElderly": ${varFix.count} row(s)`);

  const rows = await prisma.budgetDomainConfig.findMany({
    where: { key: { in: ["AfterSchoolCentre", "Elderly"] } },
    select: { city: true, key: true, beneficiaryLabel: true, beneficiaryVar: true, beneficiaryMult: true },
    orderBy: [{ key: "asc" }, { city: "asc" }],
  });
  for (const r of rows) console.log(r.city, r.key, JSON.stringify(r.beneficiaryLabel), r.beneficiaryVar, `× ${r.beneficiaryMult}`);
}

main().finally(() => prisma.$disconnect());
