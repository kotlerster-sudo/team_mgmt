// Create a new /field intervention: a Goal (the intervention) plus its
// materialised FieldStep rows, straight from the domain's templates. This is the
// minimal replacement for the old template-apply + go-live machinery.
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

const SETUP_MARKER = "field-setup-template";
const VISIT_MARKER = "field-visit-template";

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export async function createIntervention(opts: {
  domain: string;
  title: string;
  ownerId: string;
  mode: "setup" | "live";
  anchorAt: Date;
  settlementId?: string | null;
  clusterId?: string | null;
  facilityId?: string | null;
}): Promise<{ goalId: string; setupSteps: number; visitSteps: number }> {
  const cfg = await prisma.fieldDomainConfig.findUnique({ where: { domain: opts.domain } });
  if (!cfg) throw new Error(`Domain ${opts.domain} is not configured`);

  // Resolve geography: a settlement implies its cluster.
  let settlementId = opts.settlementId ?? null;
  let clusterId = opts.clusterId ?? null;
  if (settlementId && !clusterId) {
    const s = await prisma.settlement.findUnique({ where: { id: settlementId }, select: { clusterId: true } });
    clusterId = s?.clusterId ?? null;
  }

  const [setupTmpls, visitTmpls] = await Promise.all([
    prisma.setupStepTemplate.findMany({ where: { domain: opts.domain, isActive: true }, orderBy: { order: "asc" } }),
    cfg.hasLivePhase ? prisma.visitStepTemplate.findMany({ where: { domain: opts.domain, isActive: true }, orderBy: { order: "asc" } }) : Promise.resolve([]),
  ]);

  const goal = await prisma.goal.create({
    data: {
      title: opts.title,
      status: "Active",
      mode: opts.mode,
      ownerId: opts.ownerId,
      needsDomain: opts.domain,
      startDate: opts.anchorAt,
      fieldAnchorAt: opts.anchorAt,
      overallSlaDays: cfg.overallSlaDays,
      cadenceCount: cfg.cadenceCount,
      cadencePeriod: cfg.cadencePeriod,
      needsSettlementId: settlementId,
      needsClusterId: clusterId,
      linkedFacilityId: opts.facilityId ?? null,
    },
    select: { id: true },
  });

  const rows: Prisma.FieldStepUncheckedCreateInput[] = [];
  // Setup steps only when starting in setup mode (a "live" creation = existing centre).
  if (opts.mode === "setup") {
    setupTmpls.forEach((t, i) => rows.push({
      goalId: goal.id, kind: "Setup", title: t.title, order: i, templateSlug: SETUP_MARKER, stepKey: t.stepKey,
      slaDays: t.slaDays, startSlaDays: t.startSlaDays, blockedByKey: t.blockedByKey,
      dueDate: t.slaDays != null ? addDays(opts.anchorAt, t.slaDays) : null,
      formKind: t.formKind, formSchema: (t.formSchema ?? undefined) as never, status: "Todo",
    }));
  }
  // Visit recipe (materialised now; dormant until the intervention is live).
  visitTmpls.forEach((t, i) => rows.push({
    goalId: goal.id, kind: "Visit", title: t.title, order: i, templateSlug: VISIT_MARKER, stepKey: t.stepKey,
    mandatory: t.mandatory, formKind: t.formKind, formSchema: (t.formSchema ?? undefined) as never,
  }));
  if (rows.length) await prisma.fieldStep.createMany({ data: rows });

  return { goalId: goal.id, setupSteps: opts.mode === "setup" ? setupTmpls.length : 0, visitSteps: visitTmpls.length };
}
