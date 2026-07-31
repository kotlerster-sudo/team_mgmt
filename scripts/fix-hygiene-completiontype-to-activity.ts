// Flip the creche hygiene/24-point-safety item from "Upload" to mark-done
// ("Activity") completion so it routes through CompleteActivityModal in
// "complete" mode, where the 24-item tick-list is now REQUIRED before the
// activity can close. The structured checklist replaces the photo as evidence.
//
// Touches (all matched by the stable hygiene key / ref):
//   1. GoalTemplateDef "creche-program-existing" — AUTHORITATIVE for future
//      visit materialisation (lib/visits/templateActivities.ts).
//   2. CatalogTemplateDef "creche-visit-catalog" — authored default (cosmetic).
//   3. Every live CentreCatalog snapshot/overrides (cosmetic; template wins).
//   4. Existing materialised ChecklistItems that still have an OPEN activity —
//      so already-scheduled visits render the Done button instead of Photo.
//      Done/historical items are left as accurate "Upload" history.
//
// Idempotent. Run:
//   npx tsx scripts/fix-hygiene-completiontype-to-activity.ts          # dry run
//   npx tsx scripts/fix-hygiene-completiontype-to-activity.ts --apply

import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const HKEY = "hygiene-and-safety-standards-checked-against-24-point-checklist";
const TEMPLATE = "creche-program-existing";
const CATALOG = "creche-visit-catalog";

type Item = { key?: string; text?: string; completionType?: string; ref?: { checklistKey?: string } };
type Cat = { items?: Item[] };

const isHygiene = (it: Item) => it.key === HKEY || it.ref?.checklistKey === HKEY;

// Mutate an items array in place; return count changed.
function fixItems(items: Item[] | undefined): number {
  let n = 0;
  for (const it of items ?? []) {
    if (isHygiene(it) && it.completionType && it.completionType !== "Activity") {
      it.completionType = "Activity";
      n++;
    }
  }
  return n;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY MODE\n" : "DRY RUN (pass --apply to write)\n");

  // 1. GoalTemplateDef — activities carry completionType (see loadTemplateChecklists).
  const tpl = await p.$queryRaw<{ id: string; pitstops: unknown }[]>`
    SELECT id, pitstops FROM "GoalTemplateDef" WHERE slug = ${TEMPLATE} LIMIT 1`;
  if (!tpl[0]) {
    console.error(`GoalTemplateDef "${TEMPLATE}" not found`);
  } else {
    const pitstops = (tpl[0].pitstops as { checklist?: { key?: string; text?: string; completionType?: string; activities?: Item[] }[] }[]) ?? [];
    let changed = 0;
    for (const ps of pitstops) {
      for (const c of ps.checklist ?? []) {
        if (c.key === HKEY) {
          if (c.completionType && c.completionType !== "Activity") { c.completionType = "Activity"; changed++; }
          changed += fixItems(c.activities);
        }
      }
    }
    console.log(`1. GoalTemplateDef ${TEMPLATE}: ${changed} completionType field(s) → Activity`);
    if (apply && changed > 0) {
      await p.$executeRaw`UPDATE "GoalTemplateDef" SET pitstops = ${JSON.stringify(pitstops)}::jsonb, "updatedAt" = NOW() WHERE id = ${tpl[0].id}`;
    }
  }

  // 2. CatalogTemplateDef authored default.
  const cat = await p.$queryRaw<{ id: string; categories: unknown }[]>`
    SELECT id, categories FROM "CatalogTemplateDef" WHERE slug = ${CATALOG} LIMIT 1`;
  if (cat[0]) {
    const categories = (cat[0].categories as Cat[]) ?? [];
    const changed = categories.reduce((acc, c) => acc + fixItems(c.items), 0);
    console.log(`2. CatalogTemplateDef ${CATALOG}: ${changed} item(s) → Activity`);
    if (apply && changed > 0) {
      await p.$executeRaw`UPDATE "CatalogTemplateDef" SET categories = ${JSON.stringify(categories)}::jsonb, "updatedAt" = NOW() WHERE id = ${cat[0].id}`;
    }
  }

  // 3. Live CentreCatalog snapshot + overrides.addedItems.
  const centres = await p.$queryRaw<{ id: string; title: string; snapshot: unknown; overrides: unknown }[]>`
    SELECT cc.id, g.title, cc.snapshot, cc.overrides
    FROM "CentreCatalog" cc JOIN "Goal" g ON g.id = cc."goalId"
    WHERE g."deletedAt" IS NULL AND (g."needsDomain" = 'Creche' OR cc."catalogSlug" = ${CATALOG})`;
  let centresChanged = 0;
  for (const c of centres) {
    const snapshot = (c.snapshot as Cat[]) ?? [];
    const overrides = (c.overrides as { addedItems?: { item?: Item }[]; addedCategories?: Cat[] }) ?? {};
    let n = snapshot.reduce((acc, cat) => acc + fixItems(cat.items), 0);
    for (const ai of overrides.addedItems ?? []) if (ai.item && isHygiene(ai.item) && ai.item.completionType && ai.item.completionType !== "Activity") { ai.item.completionType = "Activity"; n++; }
    n += (overrides.addedCategories ?? []).reduce((acc, cat) => acc + fixItems(cat.items), 0);
    if (n > 0) {
      centresChanged++;
      if (apply) {
        await p.$executeRaw`UPDATE "CentreCatalog" SET snapshot = ${JSON.stringify(snapshot)}::jsonb, overrides = ${JSON.stringify(overrides)}::jsonb, "updatedAt" = NOW() WHERE id = ${c.id}`;
      }
    }
  }
  console.log(`3. CentreCatalog: ${centresChanged}/${centres.length} live centre(s) updated`);

  // 4. Materialised ChecklistItems with an OPEN activity, still on 'Upload'
  // (no deletedAt column on ChecklistItem). Done items keep their history.
  const openRows = await p.$queryRaw<{ n: number }[]>`
    SELECT count(DISTINCT ci.id)::int AS n FROM "ChecklistItem" ci
    JOIN "PitstopEvent" pe ON pe."checklistItemId" = ci.id AND pe."deletedAt" IS NULL AND pe.status NOT IN ('Done','Cancelled')
    WHERE ci.key = ${HKEY} AND ci."completionType" = 'Upload'::"ChecklistCompletionType"`;
  console.log(`4. OPEN materialised ChecklistItems still 'Upload': ${openRows[0]?.n ?? 0} → Activity`);
  if (apply) {
    await p.$executeRaw`
      UPDATE "ChecklistItem" SET "completionType" = 'Activity'::"ChecklistCompletionType", "updatedAt" = NOW()
      WHERE id IN (
        SELECT DISTINCT ci.id FROM "ChecklistItem" ci
        JOIN "PitstopEvent" pe ON pe."checklistItemId" = ci.id AND pe."deletedAt" IS NULL AND pe.status NOT IN ('Done','Cancelled')
        WHERE ci.key = ${HKEY} AND ci."completionType" = 'Upload'::"ChecklistCompletionType"
      )`;
  }

  console.log(`\n${apply ? "Done." : "Dry run complete — re-run with --apply to write."}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
