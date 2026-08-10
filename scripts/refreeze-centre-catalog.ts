/**
 * Re-freeze a live centre's CentreCatalog.snapshot from the CURRENT domain CatalogTemplateDef.
 *
 * Why: the snapshot is frozen at go-live and never refreshed. A centre that went live before the
 * catalog was rebuilt keeps stale items. This re-runs the go-live freeze (normalizeCategories on the
 * current def) and writes it back — WITHOUT touching mode, cadence, the Operations pitstop, or any
 * already-materialised visit checklist items (those are historical). Per-centre overrides are kept,
 * except addedItems that now collide with a snapshot key (they'd render twice).
 *
 * Usage:
 *   tsx scripts/refreeze-centre-catalog.ts "Royapuram"          # DRY RUN (default)
 *   tsx scripts/refreeze-centre-catalog.ts "Royapuram" --apply  # write
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";
import { resolveEffectiveCatalog, type CatalogCategory, type CentreCatalogOverrides } from "../lib/catalogDb";
import { computeRefreeze } from "../lib/operations/refreeze";

const titleMatch = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!titleMatch) {
  console.error('Pass a goal title substring, e.g. tsx scripts/refreeze-centre-catalog.ts "Royapuram" [--apply]');
  process.exit(1);
}

function asCats(snapshot: unknown): CatalogCategory[] {
  if (Array.isArray(snapshot)) return snapshot as CatalogCategory[];
  const c = (snapshot as any)?.categories;
  return Array.isArray(c) ? c : [];
}
const menuLines = (cats: { label: string; items: { text: string }[] }[]) =>
  cats.map((c) => `  [${c.label}] ${c.items.map((i) => i.text).join(" | ")}`);

async function main() {
  const goals = await prisma.goal.findMany({
    where: { title: { contains: titleMatch, mode: "insensitive" }, deletedAt: null, centreCatalog: { isNot: null } },
    select: { id: true, title: true, needsDomain: true, centreCatalog: {
      select: { id: true, catalogSlug: true, snapshot: true, overrides: true },
    } },
  });

  if (goals.length === 0) { console.log(`No LIVE centres match "${titleMatch}".`); return; }
  console.log(`Matched ${goals.length} live centre(s) for "${titleMatch}"${APPLY ? "  [APPLY]" : "  [DRY RUN]"}\n`);

  for (const g of goals) {
    const cc = g.centreCatalog!;
    const def =
      (await prisma.catalogTemplateDef.findFirst({ where: { slug: cc.catalogSlug, isActive: true } })) ??
      (g.needsDomain
        ? await prisma.catalogTemplateDef.findFirst({ where: { needsDomain: g.needsDomain, isActive: true }, orderBy: { updatedAt: "desc" } })
        : null);
    if (!def) { console.log(`SKIP "${g.title}": no active def for slug=${cc.catalogSlug} / domain=${g.needsDomain}`); continue; }

    const { snapshot: newSnapshot, overrides: ov, result } = computeRefreeze(
      cc.snapshot,
      cc.overrides,
      def.categories as unknown as CatalogCategory[],
    );
    const prunedAdded = ov.addedItems ?? [];

    const before = resolveEffectiveCatalog(asCats(cc.snapshot), cc.overrides as CentreCatalogOverrides);
    const after = resolveEffectiveCatalog(newSnapshot, ov);

    console.log(`═══ ${g.title}`);
    console.log(` catalogSlug=${cc.catalogSlug}  def.updatedAt=${def.updatedAt.toISOString()}`);
    console.log(" BEFORE (effective menu):");
    menuLines(before).forEach((l) => console.log(l));
    console.log(" AFTER (effective menu):");
    menuLines(after).forEach((l) => console.log(l));
    if (result.prunedOverrides.length)
      console.log(` overrides.addedItems pruned (now in snapshot): ${result.prunedOverrides.join(", ")}`);
    console.log(` overrides.addedItems kept: ${prunedAdded.length}  | hiddenKeys: ${(ov.hiddenKeys ?? []).length}  | edits: ${Object.keys(ov.edits ?? {}).length}`);

    if (APPLY) {
      await prisma.centreCatalog.update({
        where: { id: cc.id },
        data: { snapshot: newSnapshot as object[], overrides: ov as object },
      });
      console.log(" ✅ written");
    } else {
      console.log(" (dry run — no write)");
    }
    console.log("");
  }
}

main().finally(() => prisma.$disconnect());
