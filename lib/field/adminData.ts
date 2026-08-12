// Data for the /field backend console — the config that drives the RP frontend,
// plus a live-data snapshot so edits/actions can be watched taking effect.
import prisma from "@/lib/prisma";

export type DomainBackend = {
  config: {
    domain: string; label: string; unit: string; overallSlaDays: number | null;
    cadenceCount: number | null; cadencePeriod: string | null; hasLivePhase: boolean; isActive: boolean;
  };
  setupSteps: SetupRow[];
  visitSteps: VisitRow[];
  counts: { interventions: number; setupSteps: number; visitRecipe: number; visits: number; openFollowups: number };
};
export type SetupRow = { id: string; order: number; stepKey: string; title: string; slaDays: number | null; startSlaDays: number | null; blockedByKey: string | null; formKind: string | null; formItemCount: number };
export type VisitRow = { id: string; order: number; stepKey: string; title: string; mandatory: boolean; formKind: string | null; formItemCount: number };

function itemCount(formSchema: unknown): number {
  return ((formSchema as { items?: unknown[] } | null)?.items?.length) ?? 0;
}

export async function loadFieldBackend(): Promise<DomainBackend[]> {
  const configs = await prisma.fieldDomainConfig.findMany({ orderBy: { sortOrder: "asc" } });
  const out: DomainBackend[] = [];
  for (const c of configs) {
    const [setup, visit, interventions, setupSteps, visitRecipe, visits, openFollowups] = await Promise.all([
      prisma.setupStepTemplate.findMany({ where: { domain: c.domain }, orderBy: { order: "asc" } }),
      prisma.visitStepTemplate.findMany({ where: { domain: c.domain }, orderBy: { order: "asc" } }),
      prisma.goal.count({ where: { needsDomain: c.domain, deletedAt: null } }),
      prisma.fieldStep.count({ where: { kind: "Setup", deletedAt: null, goal: { needsDomain: c.domain } } }),
      prisma.fieldStep.count({ where: { kind: "Visit", deletedAt: null, goal: { needsDomain: c.domain } } }),
      prisma.fieldVisit.count({ where: { goal: { needsDomain: c.domain } } }),
      prisma.actionPoint.count({ where: { status: "open", goal: { needsDomain: c.domain } } }),
    ]);
    out.push({
      config: { domain: c.domain, label: c.label, unit: c.unit, overallSlaDays: c.overallSlaDays, cadenceCount: c.cadenceCount, cadencePeriod: c.cadencePeriod, hasLivePhase: c.hasLivePhase, isActive: c.isActive },
      setupSteps: setup.map((s) => ({ id: s.id, order: s.order, stepKey: s.stepKey, title: s.title, slaDays: s.slaDays, startSlaDays: s.startSlaDays, blockedByKey: s.blockedByKey, formKind: s.formKind, formItemCount: itemCount(s.formSchema) })),
      visitSteps: visit.map((s) => ({ id: s.id, order: s.order, stepKey: s.stepKey, title: s.title, mandatory: s.mandatory, formKind: s.formKind, formItemCount: itemCount(s.formSchema) })),
      counts: { interventions, setupSteps, visitRecipe, visits, openFollowups },
    });
  }
  return out;
}
