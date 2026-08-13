// Push the current SetupStepTemplate for a domain onto its existing interventions.
//   POST { domain }
// Upsert by (goal, stepKey): updates structure (title/order/SLA/blocked-by/form),
// recomputes dueDate from the goal's anchor, but PRESERVES completion (status,
// answers, completedAt). New template steps are added (Todo); removed ones are
// soft-deleted. Only targets goals that already went through setup (have setup
// steps) — existing/auto-live centres without a setup phase are left alone.
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

const MARKER = "field-setup-template";

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export async function POST(req: NextRequest) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { domain } = await req.json().catch(() => ({ domain: "" }));
  if (!domain) return Response.json({ error: "domain required" }, { status: 400 });

  const [templates, cfg] = await Promise.all([
    prisma.setupStepTemplate.findMany({ where: { domain, isActive: true }, orderBy: { order: "asc" } }),
    prisma.fieldDomainConfig.findUnique({ where: { domain } }),
  ]);
  const tKeys = new Set(templates.map((t) => t.stepKey));

  const goals = await prisma.goal.findMany({
    where: { needsDomain: domain, deletedAt: null, fieldSteps: { some: { kind: "Setup" } } },
    select: { id: true, fieldAnchorAt: true, createdAt: true, fieldSteps: { where: { kind: "Setup" }, select: { id: true, stepKey: true, templateSlug: true, deletedAt: true } } },
  });

  let updated = 0, added = 0, removed = 0;
  for (const g of goals) {
    const anchor = g.fieldAnchorAt ?? g.createdAt;
    const byKey = new Map(g.fieldSteps.map((s) => [s.stepKey, s]));
    for (const [i, t] of templates.entries()) {
      const dueDate = t.slaDays != null ? addDays(anchor, t.slaDays) : null;
      const structure = { title: t.title, order: i, slaDays: t.slaDays, startSlaDays: t.startSlaDays, blockedByKey: t.blockedByKey, formKind: t.formKind, formSchema: (t.formSchema ?? undefined) as never, dueDate, templateSlug: MARKER };
      const ex = byKey.get(t.stepKey);
      if (ex) { await prisma.fieldStep.update({ where: { id: ex.id }, data: { ...structure, deletedAt: null } }); updated++; }
      else { await prisma.fieldStep.create({ data: { goalId: g.id, kind: "Setup", stepKey: t.stepKey, status: "Todo", ...structure } }); added++; }
    }
    for (const s of g.fieldSteps) {
      if (s.stepKey && !tKeys.has(s.stepKey) && s.templateSlug && !s.deletedAt) {
        await prisma.fieldStep.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
        removed++;
      }
    }
    if (cfg?.overallSlaDays != null) await prisma.goal.update({ where: { id: g.id }, data: { overallSlaDays: cfg.overallSlaDays } });
  }
  return Response.json({ ok: true, goals: goals.length, updated, added, removed });
}
