/**
 * Inject the "Caregiver practices" launcher catalog item into creche visit
 * catalogs so the capture drill is reachable on a creche visit.
 *
 *   1. Every active creche CatalogTemplateDef (needsDomain "Creche") — so NEW
 *      go-lives include it. Added to the reserved caregiver-practices category
 *      (created if absent).
 *   2. Every existing live-creche CentreCatalog — via overrides.addedItems, since
 *      their snapshots are frozen at go-live. Idempotent (skips if already present).
 *
 *   npx tsx --env-file=.env.local scripts/add-caregiver-practices-launcher.ts [--apply]
 *
 * Dry-run by default. ⚠ .env.local = prod.
 */

import prisma from "../lib/prisma";
import {
  normalizeCategories,
  resolveEffectiveCatalog,
  type CatalogCategory,
  type CentreCatalogOverrides,
} from "../lib/catalogDb";
import {
  CAREGIVER_PRACTICES_LAUNCHER_ITEM,
  CAREGIVER_PRACTICES_LAUNCHER_KEY,
  CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY,
  CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_LABEL,
} from "../lib/caregiverPractices";

const APPLY = process.argv.includes("--apply");

/** Does this category tree already contain the launcher item anywhere? */
function hasLauncher(categories: CatalogCategory[]): boolean {
  return categories.some((c) => (c.items ?? []).some((i) => i.key === CAREGIVER_PRACTICES_LAUNCHER_KEY));
}

/** Add the launcher into the reserved category (creating it if needed). */
function withLauncher(categories: CatalogCategory[]): CatalogCategory[] {
  const cats = normalizeCategories(categories);
  const cat = cats.find((c) => c.key === CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY);
  if (cat) {
    cat.items.push({ ...CAREGIVER_PRACTICES_LAUNCHER_ITEM });
    return cats;
  }
  return [
    ...cats,
    {
      key: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY,
      label: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_LABEL,
      items: [{ ...CAREGIVER_PRACTICES_LAUNCHER_ITEM }],
    },
  ];
}

async function main() {
  // 1. Domain catalogs (CatalogTemplateDef, needsDomain Creche)
  const defs = await prisma.catalogTemplateDef.findMany({
    where: { needsDomain: "Creche", isActive: true },
    select: { id: true, slug: true, categories: true },
  });
  let defAdded = 0,
    defSkipped = 0;
  for (const d of defs) {
    const cats = (d.categories as unknown as CatalogCategory[]) ?? [];
    if (hasLauncher(cats)) {
      defSkipped++;
      continue;
    }
    if (APPLY) {
      await prisma.catalogTemplateDef.update({
        where: { id: d.id },
        data: { categories: withLauncher(cats) as object[] },
      });
    }
    console.log(`  ${APPLY ? "✓" : "would add"} CatalogTemplateDef ${d.slug}`);
    defAdded++;
  }

  // 2. Existing live-creche CentreCatalogs (frozen snapshot → overrides.addedItems)
  const centres = await prisma.centreCatalog.findMany({
    where: { goal: { needsDomain: "Creche", deletedAt: null } },
    select: { id: true, goalId: true, snapshot: true, overrides: true, goal: { select: { title: true } } },
  });
  let ccAdded = 0,
    ccSkipped = 0;
  for (const c of centres) {
    const snapshot = (c.snapshot as unknown as CatalogCategory[]) ?? [];
    const overrides = (c.overrides as unknown as CentreCatalogOverrides) ?? {};
    // Present already (snapshot OR overrides)?
    const effective = resolveEffectiveCatalog(snapshot, overrides);
    if (effective.some((cat) => cat.items.some((i) => i.key === CAREGIVER_PRACTICES_LAUNCHER_KEY))) {
      ccSkipped++;
      continue;
    }
    const nextOverrides: CentreCatalogOverrides = {
      ...overrides,
      addedItems: [
        ...(overrides.addedItems ?? []),
        { categoryKey: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY, item: { ...CAREGIVER_PRACTICES_LAUNCHER_ITEM } },
      ],
      // Ensure the category exists on this centre if the snapshot lacks it.
      ...(snapshot.some((cat) => cat.key === CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY)
        ? {}
        : {
            addedCategories: [
              ...(overrides.addedCategories ?? []),
              { key: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_KEY, label: CAREGIVER_PRACTICES_LAUNCHER_CATEGORY_LABEL, items: [] },
            ],
          }),
    };
    if (APPLY) {
      await prisma.centreCatalog.update({ where: { id: c.id }, data: { overrides: nextOverrides as object } });
    }
    console.log(`  ${APPLY ? "✓" : "would add"} CentreCatalog for "${c.goal.title}"`);
    ccAdded++;
  }

  console.log(
    `\nCatalogTemplateDef: ${defAdded} ${APPLY ? "updated" : "to update"}, ${defSkipped} already had it.\n` +
      `CentreCatalog:      ${ccAdded} ${APPLY ? "updated" : "to update"}, ${ccSkipped} already had it.\n` +
      (APPLY ? "Applied." : "DRY RUN — re-run with --apply."),
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
