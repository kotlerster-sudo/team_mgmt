import prisma from "@/lib/prisma";
import { slugifyChecklistText, normalizeActivities, type DbPitstop, type DbChecklistItem } from "@/lib/templateDb";

export type TemplateActivity = { key: string; title: string; completionType: string };
export type TemplateChecklist = { key: string; text: string; completionType: string; activities: TemplateActivity[] };

const ckKey = (c: DbChecklistItem) => c.key || slugifyChecklistText(c.text);
const actKey = (a: { key?: string; title: string }) => a.key || slugifyChecklistText(a.title);

/**
 * For a goal template, resolve every checklist item to its activities (the completion units).
 * Keyed by checklist key so `materialiseVisitItems` can expand a tagged checklist into its
 * activities. `completionType` is resolved once per level (checklist, else first activity).
 */
export async function loadTemplateChecklists(templateSlug: string): Promise<Map<string, TemplateChecklist>> {
  const out = new Map<string, TemplateChecklist>();
  const def = await prisma.goalTemplateDef.findUnique({ where: { slug: templateSlug }, select: { pitstops: true } });
  if (!def) return out;

  for (const p of (def.pitstops ?? []) as unknown as DbPitstop[]) {
    for (const c of p.checklist ?? []) {
      const acts = normalizeActivities(c).map((a) => ({
        key: actKey(a),
        title: a.title,
        completionType: a.completionType || c.completionType || "Activity",
      }));
      const completionType = c.completionType || acts[0]?.completionType || "Activity";
      out.set(ckKey(c), { key: ckKey(c), text: c.text, completionType, activities: acts });
    }
  }
  return out;
}
