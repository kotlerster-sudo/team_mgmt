/**
 * Seed the parametric Sanitation_Complex CostRegistry items + their component
 * working (CostRegistryComponent). Both sourced from lib/sanitation/rates.ts
 * so the budget and model stay aligned.
 *
 * Idempotent — upserts each registry row (city + itemKey unique) and replaces
 * component rows per parent. Does NOT touch the deprecated aggregate
 * san.capex_* rows; those stay for a release cycle so historical budgets
 * that still reference them keep resolving.
 *
 * Usage:
 *   npx tsx scripts/seed-sanitation-registry.ts             # dry run
 *   npx tsx scripts/seed-sanitation-registry.ts --apply     # write
 *   npx tsx scripts/seed-sanitation-registry.ts --apply --chennai  # Chennai too
 */
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { rollup } from "../lib/budget/costComponents";
import { SANITATION_RATES } from "../lib/sanitation/rates";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const INCLUDE_CHENNAI = process.argv.includes("--chennai");
const DOMAIN = "Sanitation_Complex";

async function seedForCity(prisma: PrismaClient, city: string) {
  console.log(`\n=== Sanitation registry seed (${city}) — ${APPLY ? "APPLY" : "DRY RUN"} ===`);

  let upserted = 0;
  let componentBundles = 0;
  let componentRows = 0;
  const mismatches: string[] = [];

  for (const rate of SANITATION_RATES) {
    // Upsert the parent registry row.
    if (APPLY) {
      await prisma.costRegistry.upsert({
        where: { city_itemKey: { city, itemKey: rate.key } },
        create: {
          city, domain: DOMAIN, itemKey: rate.key,
          unitCost: rate.standardUnitCost,
          unit: rate.costUnit,
          notes: rate.notes ?? null,
          derivation: rate.derivation ?? null,
          displayGroup: rate.displayGroup ?? null,
          effectiveYear: new Date().getFullYear(),
        },
        // Keep unit + notes + derivation fresh; do NOT overwrite unitCost so
        // in-place admin edits survive re-runs. If the seed's rate diverges
        // from prod, that shows up in the working reconciliation banner.
        update: {
          domain: DOMAIN,
          unit: rate.costUnit,
          notes: rate.notes ?? null,
          derivation: rate.derivation ?? null,
        },
      });
    }
    upserted++;

    // Replace component working, if the rate has a breakup.
    if (!rate.components || rate.components.length === 0) continue;
    componentBundles++;
    componentRows += rate.components.length;

    const sum = rollup(rate.components.map(c => ({ qty: c.qty, unitCost: c.unitCost })));
    const target = Math.round(rate.standardUnitCost);
    const ok = sum === target;
    if (!ok) mismatches.push(`${rate.key}: Σ=${sum} vs unit=${target}`);
    const status = ok ? "✓" : "⚠ Σ≠unit";
    console.log(`  ${rate.key.padEnd(38)} ${status}  (${rate.components.length} components, Σ=${sum})`);

    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      await tx.costRegistryComponent.deleteMany({ where: { city, parentItemKey: rate.key } });
      await tx.costRegistryComponent.createMany({
        data: rate.components!.map((c, position) => ({
          city, parentItemKey: rate.key, position,
          label: c.label, spec: c.spec ?? null,
          qty: c.qty, unitCost: c.unitCost,
          notes: c.notes ?? null,
        })),
      });
    });
  }

  console.log(`\n  Registry rows upserted: ${upserted}`);
  console.log(`  Component bundles:      ${componentBundles} (${componentRows} rows)`);
  if (mismatches.length > 0) {
    console.log(`\n  Reconciliation warnings (working sum ≠ unit cost):`);
    for (const m of mismatches) console.log(`    - ${m}`);
    console.log(`  (These render as ⚠ in the admin working editor; edit either side to fix.)`);
  }
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  try {
    await seedForCity(prisma, "Bangalore");
    if (INCLUDE_CHENNAI) await seedForCity(prisma, "Chennai");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
