// READ-ONLY: is the creche visit catalog tagged so the hygiene 24-point
// checklist item fires indicator capture on visit completion?
// Checks (a) the authored CatalogTemplateDef default and (b) every live
// CentreCatalog for a creche goal, using the same resolver the app uses.
// Run:  npx tsx scripts/check-creche-catalog-tags.ts

import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveEffectiveCatalog } from "../lib/catalogDb";
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const HYGIENE_KEY = "hygiene-and-safety-standards-checked-against-24-point-checklist";
const TEMPLATE = "creche-program-existing";

type Cat = { key: string; label: string; items: { key: string; text: string; completionType?: string; blocksSignoff?: boolean; ref?: { templateSlug: string; checklistKey: string } }[] };

function report(label: string, cats: Cat[]) {
  const all = cats.flatMap(c => c.items);
  const tagged = all.filter(i => i.ref);
  const hygiene = all.find(
    i => i.key === HYGIENE_KEY || i.ref?.checklistKey === HYGIENE_KEY || /hygiene|safety|24/i.test(i.text),
  );
  const hygieneTagged = all.find(
    i => i.ref?.checklistKey === HYGIENE_KEY && i.ref?.templateSlug === TEMPLATE,
  );
  console.log(`\n── ${label}`);
  console.log(`   items: ${all.length} | tagged (any ref): ${tagged.length}`);
  console.log(`   hygiene item present: ${hygiene ? `yes ("${hygiene.text}")` : "NO"}`);
  console.log(`   hygiene TAGGED to ${TEMPLATE}/${HYGIENE_KEY}: ${hygieneTagged ? "✅ YES — tick-list will fire" : "❌ NO"}`);
  if (hygiene && !hygieneTagged) {
    console.log(`      → present but ref = ${JSON.stringify(hygiene.ref ?? null)}`);
  }
}

async function main() {
  // (a) Authored domain default
  const defs = await p.$queryRaw<{ slug: string; name: string; categories: unknown }[]>`
    SELECT slug, name, categories FROM "CatalogTemplateDef"
    WHERE "needsDomain" = 'Creche' OR slug ILIKE '%creche%'
  `;
  for (const d of defs) {
    report(`CatalogTemplateDef "${d.slug}" (authored default)`, (d.categories as Cat[]) ?? []);
  }
  if (defs.length === 0) console.log("\n(no creche CatalogTemplateDef found)");

  // (b) Live centres
  const centres = await p.$queryRaw<{
    id: string; goalId: string; title: string; catalogSlug: string;
    snapshot: unknown; overrides: unknown;
  }[]>`
    SELECT cc.id, cc."goalId", g.title, cc."catalogSlug", cc.snapshot, cc.overrides
    FROM "CentreCatalog" cc
    JOIN "Goal" g ON g.id = cc."goalId"
    WHERE g."deletedAt" IS NULL
      AND (g."needsDomain" = 'Creche' OR g.title ILIKE '%creche%' OR cc."catalogSlug" ILIKE '%creche%')
    ORDER BY g.title
  `;
  console.log(`\n=== ${centres.length} live creche CentreCatalog(s) ===`);
  for (const c of centres) {
    const eff = resolveEffectiveCatalog((c.snapshot as never) ?? [], (c.overrides as never) ?? {});
    report(`${c.title} [${c.catalogSlug}]`, eff as Cat[]);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
