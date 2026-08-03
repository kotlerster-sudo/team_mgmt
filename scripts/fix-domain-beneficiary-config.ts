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
 *  3. WelfareRights households-per-settlement was 600 in Bangalore and the
 *     untouched 150 default in Chennai; both go to 450, the planning average.
 *     No line template reads a household count — WelfareRights units come from
 *     nClusters / nSettlements / cosTotal — so this figure moves no money. It is
 *     the denominator of the per-household tile and of estHH, nothing else.
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

  const hh = await prisma.budgetDomainConfig.updateMany({
    where: { key: "WelfareRights", beneficiaryVar: "nSettlements", NOT: { beneficiaryMult: 450 } },
    data: { beneficiaryMult: 450 },
  });
  console.log(`WelfareRights beneficiaryMult → 450: ${hh.count} row(s)`);

  const rows = await prisma.budgetDomainConfig.findMany({
    where: { key: { in: ["AfterSchoolCentre", "Elderly", "WelfareRights"] } },
    select: { city: true, key: true, beneficiaryLabel: true, beneficiaryVar: true, beneficiaryMult: true },
    orderBy: [{ key: "asc" }, { city: "asc" }],
  });
  for (const r of rows) console.log(r.city, r.key, JSON.stringify(r.beneficiaryLabel), r.beneficiaryVar, `× ${r.beneficiaryMult}`);
}

main().finally(() => prisma.$disconnect());
