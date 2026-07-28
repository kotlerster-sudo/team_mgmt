/**
 * Backfill BudgetDeliveryPartner.grantPartnerId from the free-text name that
 * was captured before the registry link existed. Match is case-insensitive
 * and scoped to the parent Budget's city (mirrors the [city,name] uniqueness
 * on GrantPartner).
 *
 * Idempotent. Rows that already have grantPartnerId set are skipped.
 * Ambiguous / no-match rows are logged and left null — a human must resolve
 * these via the editor once that surface exists.
 *
 *   npx tsx scripts/backfill-delivery-partner-links.ts          # dry run
 *   npx tsx scripts/backfill-delivery-partner-links.ts --apply  # write
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const APPLY = process.argv.includes("--apply");

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });
  const prisma = new PrismaClient({ adapter });

  const rows = await prisma.budgetDeliveryPartner.findMany({
    where: { grantPartnerId: null },
    select: {
      id: true,
      name: true,
      budget: { select: { id: true, name: true, city: true } },
    },
  });

  console.log(`Found ${rows.length} unlinked BudgetDeliveryPartner rows.`);
  if (!rows.length) { await prisma.$disconnect(); return; }

  let linked = 0;
  let unmatched = 0;
  const missing: { budget: string; city: string; name: string }[] = [];

  for (const row of rows) {
    const trimmed = row.name.trim();
    if (!trimmed) {
      unmatched++;
      missing.push({ budget: row.budget.name, city: row.budget.city, name: row.name });
      continue;
    }
    const gp = await prisma.grantPartner.findFirst({
      where: { city: row.budget.city, name: { equals: trimmed, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!gp) {
      unmatched++;
      missing.push({ budget: row.budget.name, city: row.budget.city, name: trimmed });
      continue;
    }
    if (APPLY) {
      await prisma.budgetDeliveryPartner.update({
        where: { id: row.id },
        data: { grantPartnerId: gp.id, name: gp.name },
      });
    } else {
      console.log(`  [dry] ${row.budget.name} (${row.budget.city}): "${trimmed}" → ${gp.name} (${gp.id})`);
    }
    linked++;
  }

  console.log(`\nLinked: ${linked}`);
  console.log(`Unmatched (left null): ${unmatched}`);
  if (missing.length) {
    console.log("\nUnmatched rows:");
    for (const m of missing) console.log(`  - "${m.name}" on "${m.budget}" (${m.city})`);
  }
  if (!APPLY) console.log("\n(dry-run — pass --apply to write)");

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
