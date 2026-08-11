/**
 * Backfill the relational config-graph tables (P1b) from the existing JSON:
 *   GoalTemplateDef.pitstops     → TemplatePitstopDef → TemplateChecklistDef → TemplateActivityDef
 *   CatalogTemplateDef.categories→ CatalogCategoryDef → CatalogItemDef (checklistDefId FK from ref)
 *   ActivityIndicatorBinding     → checklistDefId | catalogItemDefId (FK-clean anchor)
 *   ProgrammeJourneyOutcome      → bindingChecklistDefId | bindingCatalogItemDefId
 *
 * Idempotent (upsert by the natural unique keys) so it can run repeatedly during dual-write.
 * Dry-run by default; pass --apply to write.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";
import { slugifyChecklistText, normalizeActivities, type DbPitstop } from "../lib/templateDb";
import type { CatalogCategory } from "../lib/catalogDb";

const APPLY = process.argv.includes("--apply");
const k = (explicit: string | undefined, fallback: string) => (explicit ?? "").trim() || slugifyChecklistText(fallback);

async function main() {
  const stats = { pitstops: 0, checklists: 0, activities: 0, categories: 0, items: 0, bindingsFk: 0, outcomesFk: 0, unresolved: [] as string[] };

  // slug::key -> TemplateChecklistDef.id ; refSlug::refKey -> CatalogItemDef.id
  const checklistByKey = new Map<string, string>();
  const catItemByRefKey = new Map<string, string>();

  // 1. Templates
  const templates = await prisma.goalTemplateDef.findMany({ select: { id: true, slug: true, pitstops: true } });
  for (const t of templates) {
    const pts = (t.pitstops as unknown as DbPitstop[]) ?? [];
    for (let pi = 0; pi < pts.length; pi++) {
      const pt = pts[pi];
      const pkey = k(pt.key, pt.title);
      let pitstopDefId = `${t.id}:${pkey}`; // placeholder for dry-run
      if (APPLY) {
        const row = await prisma.templatePitstopDef.upsert({
          where: { templateId_key: { templateId: t.id, key: pkey } },
          create: { templateId: t.id, key: pkey, order: pi, title: pt.title, type: pt.type ?? "Discussion", notes: pt.notes ?? "", slaDays: pt.slaDays ?? 0, startSlaDays: pt.startSlaDays ?? 0, recurrence: pt.recurrence ?? "None", repeatCount: pt.repeatCount ?? 1, progressTag: pt.progressTag ?? null },
          update: { order: pi, title: pt.title, type: pt.type ?? "Discussion", notes: pt.notes ?? "", slaDays: pt.slaDays ?? 0, startSlaDays: pt.startSlaDays ?? 0, recurrence: pt.recurrence ?? "None", repeatCount: pt.repeatCount ?? 1, progressTag: pt.progressTag ?? null },
          select: { id: true },
        });
        pitstopDefId = row.id;
      }
      stats.pitstops++;

      const checklist = pt.checklist ?? [];
      for (let ci = 0; ci < checklist.length; ci++) {
        const it = checklist[ci];
        const ckey = k(it.key, it.text);
        let checklistDefId = `${pitstopDefId}:${ckey}`;
        if (APPLY) {
          const row = await prisma.templateChecklistDef.upsert({
            where: { pitstopDefId_key: { pitstopDefId, key: ckey } },
            create: { pitstopDefId, key: ckey, order: ci, text: it.text, completionType: it.completionType ?? "Activity" },
            update: { order: ci, text: it.text, completionType: it.completionType ?? "Activity" },
            select: { id: true },
          });
          checklistDefId = row.id;
        }
        stats.checklists++;
        checklistByKey.set(`${t.slug}::${ckey}`, checklistDefId);

        const acts = normalizeActivities(it);
        for (let ai = 0; ai < acts.length; ai++) {
          const act = acts[ai];
          const akey = k(act.key, act.title);
          if (APPLY) {
            await prisma.templateActivityDef.upsert({
              where: { checklistDefId_key: { checklistDefId, key: akey } },
              create: { checklistDefId, key: akey, order: ai, title: act.title, completionType: act.completionType ?? "Activity", dayOffset: act.dayOffset ?? null },
              update: { order: ai, title: act.title, completionType: act.completionType ?? "Activity", dayOffset: act.dayOffset ?? null },
            });
          }
          stats.activities++;
        }
      }
    }
  }

  // 2. Catalogs
  const catalogs = await prisma.catalogTemplateDef.findMany({ select: { id: true, slug: true, categories: true } });
  for (const c of catalogs) {
    const cats = (c.categories as unknown as CatalogCategory[]) ?? [];
    for (let gi = 0; gi < cats.length; gi++) {
      const cat = cats[gi];
      const catKey = k(cat.key, cat.label);
      let categoryDefId = `${c.id}:${catKey}`;
      if (APPLY) {
        const row = await prisma.catalogCategoryDef.upsert({
          where: { catalogId_key: { catalogId: c.id, key: catKey } },
          create: { catalogId: c.id, key: catKey, order: gi, label: cat.label },
          update: { order: gi, label: cat.label },
          select: { id: true },
        });
        categoryDefId = row.id;
      }
      stats.categories++;

      const items = cat.items ?? [];
      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        const itemKey = k(it.key, it.text);
        const checklistDefId = it.ref ? checklistByKey.get(`${it.ref.templateSlug}::${it.ref.checklistKey}`) ?? null : null;
        let itemId = `${categoryDefId}:${itemKey}`;
        if (APPLY) {
          const row = await prisma.catalogItemDef.upsert({
            where: { categoryDefId_key: { categoryDefId, key: itemKey } },
            create: { categoryDefId, key: itemKey, order: ii, text: it.text, completionType: it.completionType ?? "Activity", blocksSignoff: it.blocksSignoff ?? true, checklistDefId },
            update: { order: ii, text: it.text, completionType: it.completionType ?? "Activity", blocksSignoff: it.blocksSignoff ?? true, checklistDefId },
            select: { id: true },
          });
          itemId = row.id;
        }
        stats.items++;
        if (it.ref) catItemByRefKey.set(`${it.ref.templateSlug}::${it.ref.checklistKey}`, itemId);
      }
    }
  }

  // 3. Indicator bindings → FK anchor
  const bindings = await prisma.activityIndicatorBinding.findMany({ select: { id: true, templateSlug: true, checklistKey: true, def: { select: { label: true } } } });
  for (const b of bindings) {
    const key = `${b.templateSlug}::${b.checklistKey}`;
    const checklistDefId = checklistByKey.get(key) ?? null;
    const catalogItemDefId = checklistDefId ? null : (catItemByRefKey.get(key) ?? null);
    if (!checklistDefId && !catalogItemDefId) { stats.unresolved.push(`binding ${b.def.label} (${key})`); continue; }
    if (APPLY) await prisma.activityIndicatorBinding.update({ where: { id: b.id }, data: { checklistDefId, catalogItemDefId } });
    stats.bindingsFk++;
  }

  // 4. Journey outcome bindings → FK anchor
  const outcomes = await prisma.programmeJourneyOutcome.findMany({ where: { bindingChecklistKey: { not: null } }, select: { id: true, label: true, bindingTemplateSlug: true, bindingChecklistKey: true } });
  for (const o of outcomes) {
    if (!o.bindingTemplateSlug || !o.bindingChecklistKey) continue;
    const key = `${o.bindingTemplateSlug}::${o.bindingChecklistKey}`;
    const bindingChecklistDefId = checklistByKey.get(key) ?? null;
    const bindingCatalogItemDefId = bindingChecklistDefId ? null : (catItemByRefKey.get(key) ?? null);
    if (!bindingChecklistDefId && !bindingCatalogItemDefId) { stats.unresolved.push(`outcome ${o.label} (${key})`); continue; }
    if (APPLY) await prisma.programmeJourneyOutcome.update({ where: { id: o.id }, data: { bindingChecklistDefId, bindingCatalogItemDefId } });
    stats.outcomesFk++;
  }

  console.log(APPLY ? "[APPLIED]" : "[DRY RUN]");
  console.log(`  pitstops=${stats.pitstops} checklists=${stats.checklists} activities=${stats.activities}`);
  console.log(`  categories=${stats.categories} items=${stats.items}`);
  console.log(`  bindings wired=${stats.bindingsFk}/${bindings.length}  outcomes wired=${stats.outcomesFk}/${outcomes.length}`);
  if (stats.unresolved.length) {
    console.log(`  UNRESOLVED anchors (${stats.unresolved.length}):`);
    stats.unresolved.forEach((u) => console.log(`    - ${u}`));
  } else {
    console.log("  all bindings/outcomes resolved to an FK anchor ✓");
  }
}

main().finally(() => prisma.$disconnect());
