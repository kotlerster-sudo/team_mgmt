/**
 * Mirrors the "Re-seed standard inputs" admin action for a granting unit's
 * registry city. Additive: creates missing inp.* rows, and only refreshes
 * displayGroup/notes on rows that already exist — never touches unitCost.
 *
 * Usage: npx tsx scripts/seed-programme-inputs.ts <city> [--apply]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { STANDARD_PROG_INPUTS } = await import("../lib/budget/standardProgrammeInputs");

  const city = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!city) throw new Error("usage: seed-programme-inputs.ts <city> [--apply]");

  const existing = new Map(
    (await prisma.costRegistry.findMany({
      where: { city, itemKey: { startsWith: "inp." } },
      select: { itemKey: true, unitCost: true, displayGroup: true, notes: true },
    })).map(r => [r.itemKey, r])
  );

  const creates = STANDARD_PROG_INPUTS.filter(d => !existing.has(d.itemKey));
  const updates = STANDARD_PROG_INPUTS.filter(d => {
    const e = existing.get(d.itemKey);
    return e && (e.displayGroup !== d.displayGroup || e.notes !== d.notes);
  });

  console.log(`city=${city}  existing inp.* rows=${existing.size}  standard=${STANDARD_PROG_INPUTS.length}`);
  console.log(`\nCREATE (${creates.length}):`);
  for (const d of creates) console.log(`  + ${d.itemKey.padEnd(34)} ${String(d.unitCost).padStart(8)} ${d.unit.padEnd(9)} [${d.displayGroup}]`);
  console.log(`\nRELABEL (${updates.length}) — displayGroup/notes only, unitCost untouched:`);
  for (const d of updates) {
    const e = existing.get(d.itemKey)!;
    console.log(`  ~ ${d.itemKey.padEnd(34)} [${e.displayGroup}] -> [${d.displayGroup}]`);
  }

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    return;
  }

  await prisma.$transaction(
    STANDARD_PROG_INPUTS.map(d =>
      prisma.costRegistry.upsert({
        where: { city_itemKey: { city, itemKey: d.itemKey } },
        create: { city, domain: null, effectiveYear: 2025, ...d },
        update: { displayGroup: d.displayGroup, notes: d.notes },
      })
    )
  );
  const after = await prisma.costRegistry.count({ where: { city, itemKey: { startsWith: "inp." } } });
  console.log(`\nAPPLIED. inp.* rows for ${city}: ${existing.size} -> ${after}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
