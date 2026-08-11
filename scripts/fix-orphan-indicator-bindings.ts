/**
 * Re-point orphaned ActivityIndicatorBinding rows to the checklist key that actually materialises
 * on visits (via a catalog ref), reconnecting the indicator. Only targets bindings whose current
 * key exists in NO template and NO catalog ref, and whose intended key IS a live catalog-ref key.
 *
 * Dry-run by default; pass --apply to write. See scripts/_classify-orphans.ts for how these were found.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";
import type { CatalogCategory } from "../lib/catalogDb";

const APPLY = process.argv.includes("--apply");

// id -> intended checklistKey (a key that a live catalog ref materialises)
const REPOINTS: { id: string; to: string; why: string }[] = [
  {
    id: "37c71932-d68d-4ebb-8f99-e916e14cb3d5",
    to: "growth-monitoring-data-spot-checked-weight-height-records-up-to-",
    why: "80-char slug truncation: binding had the untruncated '...up-to-date'; catalog/materialised key is truncated",
  },
];

// Redundant duplicate bindings to delete — only if a sibling binding for the SAME indicator already
// covers the correct key (so removing this one loses nothing).
const DELETES: { id: string; why: string }[] = [
  {
    id: "6e7f90cd-5e07-466f-9781-15b96fb213b9",
    why: "template consolidated visit-2 into visit-1; this indicator already binds visit-1-attendance-register-reviewed — visit-2 binding is a stale duplicate",
  },
];

async function main() {
  // Build the live catalog-ref key universe to validate targets.
  const catalogs = await prisma.catalogTemplateDef.findMany({ where: { isActive: true }, select: { categories: true } });
  const catRefKeys = new Set<string>();
  for (const c of catalogs)
    for (const cat of (c.categories as unknown as CatalogCategory[]) ?? [])
      for (const it of cat.items ?? [])
        if (it.ref) catRefKeys.add(`${it.ref.templateSlug}::${it.ref.checklistKey}`);

  console.log(APPLY ? "[APPLY]" : "[DRY RUN]", "\n");
  for (const r of REPOINTS) {
    const b = await prisma.activityIndicatorBinding.findUnique({
      where: { id: r.id },
      select: { id: true, templateSlug: true, checklistKey: true, def: { select: { label: true } } },
    });
    if (!b) { console.log(`SKIP ${r.id}: not found (already fixed?)`); continue; }

    const targetKey = `${b.templateSlug}::${r.to}`;
    const targetValid = catRefKeys.has(targetKey);
    console.log(`${b.def.label}`);
    console.log(`  ${b.templateSlug} :: ${b.checklistKey}`);
    console.log(`  → ${r.to}   ${targetValid ? "✓ live catalog anchor" : "✗ NOT a catalog anchor — SKIP"}`);
    console.log(`  reason: ${r.why}`);

    if (!targetValid) { console.log("  skipped (target not a live catalog ref)\n"); continue; }
    if (b.checklistKey === r.to) { console.log("  already re-pointed\n"); continue; }

    // A unique (defId, templateSlug, checklistKey) collision would throw on update — surfaced below.
    if (APPLY) {
      await prisma.activityIndicatorBinding.update({ where: { id: b.id }, data: { checklistKey: r.to } });
      console.log("  ✅ updated\n");
    } else {
      console.log("  (dry run)\n");
    }
  }

  for (const d of DELETES) {
    const b = await prisma.activityIndicatorBinding.findUnique({
      where: { id: d.id },
      select: { id: true, defId: true, templateSlug: true, checklistKey: true, def: { select: { label: true } } },
    });
    if (!b) { console.log(`DELETE ${d.id}: not found (already removed)\n`); continue; }
    // Guard: a sibling binding for the same indicator must already exist (so we lose no capture path).
    const sibling = await prisma.activityIndicatorBinding.findFirst({
      where: { defId: b.defId, id: { not: b.id } },
      select: { checklistKey: true },
    });
    console.log(`${b.def.label} — DELETE redundant binding`);
    console.log(`  ${b.templateSlug} :: ${b.checklistKey}`);
    console.log(`  sibling kept: ${sibling ? sibling.checklistKey : "NONE — refusing to delete"}`);
    console.log(`  reason: ${d.why}`);
    if (!sibling) { console.log("  skipped (no sibling — would orphan the indicator)\n"); continue; }
    if (APPLY) {
      await prisma.activityIndicatorBinding.delete({ where: { id: b.id } });
      console.log("  ✅ deleted\n");
    } else {
      console.log("  (dry run)\n");
    }
  }

  console.log("Not fixed (need a domain decision — no anchor exists anywhere):");
  console.log("  • Creche IFA supplementation compliance  ← ifa-supplementation-tracking-verified");
  console.log("  • Creche issues flagged this round        ← issues-flagged-to-supervisor-immediately");
  console.log("  → either add a catalog item for it, or remove the indicator binding.");
}

main().finally(() => prisma.$disconnect());
