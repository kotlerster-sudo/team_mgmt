/**
 * The Standard's scale comes from the registry's inp.* rows, and nClusters /
 * nSettlements / nCLCs were 0 in Bangalore and absent altogether in Chennai. So
 * the Standard opened at zero scale and had to be typed in by hand every time.
 *
 * Sets a one-cluster reference unit — the shape a partner grant usually takes —
 * using each city's real settlements-per-cluster (Bangalore 264/23 ≈ 12,
 * Chennai 47/9 ≈ 5) and a single CLC. Comparisons now regenerate the Standard at
 * the loaded budget's inputs, so these govern standalone use of the panel.
 *
 * Idempotent: skips a row already at the target and logs anything it changes to
 * CostRegistryHistory.
 */
import prisma from "../lib/prisma";
import { logCostChange } from "../lib/budget/costHistory";

const TARGETS: { city: string; itemKey: string; value: number; unit: string; displayGroup: string }[] = [
  { city: "Bangalore", itemKey: "inp.nClusters",    value: 1,  unit: "count", displayGroup: "geography" },
  { city: "Bangalore", itemKey: "inp.nSettlements", value: 12, unit: "count", displayGroup: "geography" },
  { city: "Bangalore", itemKey: "inp.nCLCs",        value: 1,  unit: "count", displayGroup: "facilities" },
  { city: "Chennai",   itemKey: "inp.nClusters",    value: 1,  unit: "count", displayGroup: "geography" },
  { city: "Chennai",   itemKey: "inp.nSettlements", value: 5,  unit: "count", displayGroup: "geography" },
  { city: "Chennai",   itemKey: "inp.nCLCs",        value: 1,  unit: "count", displayGroup: "facilities" },
];

async function main() {
  for (const t of TARGETS) {
    const existing = await prisma.costRegistry.findUnique({
      where: { city_itemKey: { city: t.city, itemKey: t.itemKey } },
      select: { unitCost: true },
    });
    if (existing?.unitCost === t.value) {
      console.log(`= ${t.city} ${t.itemKey} already ${t.value}`);
      continue;
    }
    await prisma.costRegistry.upsert({
      where: { city_itemKey: { city: t.city, itemKey: t.itemKey } },
      update: { unitCost: t.value },
      create: {
        city: t.city, itemKey: t.itemKey, unitCost: t.value,
        unit: t.unit, displayGroup: t.displayGroup,
      },
    });
    await logCostChange(prisma, {
      city: t.city, itemKey: t.itemKey,
      oldCost: existing?.unitCost ?? null, newCost: t.value,
      source: "standard scale defaults",
      reason: "one-cluster reference unit for the cost-analysis Standard",
    });
    console.log(`${existing ? "~" : "+"} ${t.city} ${t.itemKey}: ${existing?.unitCost ?? "(new)"} → ${t.value}`);
  }
}

main().finally(() => prisma.$disconnect());
