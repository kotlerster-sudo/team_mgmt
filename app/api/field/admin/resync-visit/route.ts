// Push the current VisitStepTemplate for a domain onto its live interventions,
// so template edits show up in the RP frontend without a full backfill.
//   POST { domain }
// Upsert semantics (no hard delete) — updates matching recipe steps, adds new
// ones, soft-deletes removed ones. FieldVisitStep tick history is preserved.
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

const MARKER = "field-visit-template";

export async function POST(req: NextRequest) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { domain } = await req.json().catch(() => ({ domain: "" }));
  if (!domain) return Response.json({ error: "domain required" }, { status: 400 });

  const templates = await prisma.visitStepTemplate.findMany({ where: { domain, isActive: true }, orderBy: { order: "asc" } });
  const tKeys = new Set(templates.map((t) => t.stepKey));

  // Live interventions = those that already carry a visit recipe, or are mode=live.
  const goals = await prisma.goal.findMany({
    where: { needsDomain: domain, deletedAt: null, OR: [{ mode: "live" }, { fieldSteps: { some: { kind: "Visit" } } }] },
    select: { id: true, fieldSteps: { where: { kind: "Visit" }, select: { id: true, stepKey: true, templateSlug: true, deletedAt: true } } },
  });

  let updated = 0, added = 0, removed = 0;
  for (const g of goals) {
    const byKey = new Map(g.fieldSteps.map((s) => [s.stepKey, s]));
    for (const [i, t] of templates.entries()) {
      const ex = byKey.get(t.stepKey);
      if (ex) {
        await prisma.fieldStep.update({ where: { id: ex.id }, data: { title: t.title, order: i, mandatory: t.mandatory, formKind: t.formKind, formSchema: (t.formSchema ?? undefined) as never, deletedAt: null, templateSlug: MARKER } });
        updated++;
      } else {
        await prisma.fieldStep.create({ data: { goalId: g.id, kind: "Visit", title: t.title, order: i, stepKey: t.stepKey, mandatory: t.mandatory, formKind: t.formKind, formSchema: (t.formSchema ?? undefined) as never, templateSlug: MARKER } });
        added++;
      }
    }
    // Soft-delete recipe steps no longer in the template (keep ad-hoc = templateSlug null).
    for (const s of g.fieldSteps) {
      if (s.stepKey && !tKeys.has(s.stepKey) && s.templateSlug && !s.deletedAt) {
        await prisma.fieldStep.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
        removed++;
      }
    }
  }
  return Response.json({ ok: true, goals: goals.length, updated, added, removed });
}
