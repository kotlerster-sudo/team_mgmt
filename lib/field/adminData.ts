// Data for the /field backend console — the config that drives the RP frontend,
// plus a live-data snapshot so edits/actions can be watched taking effect.
import prisma from "@/lib/prisma";
import { activeFieldDomains } from "@/lib/field/access";

export type DomainBackend = {
  config: {
    domain: string; label: string; unit: string; overallSlaDays: number | null;
    cadenceCount: number | null; cadencePeriod: string | null; hasLivePhase: boolean; caregiverForm: boolean; isActive: boolean;
  };
  setupSteps: SetupRow[];
  visitSteps: VisitRow[];
  counts: { interventions: number; setupSteps: number; visitRecipe: number; visits: number; openFollowups: number };
};
export type SetupRow = { id: string; order: number; stepKey: string; title: string; slaDays: number | null; startSlaDays: number | null; blockedByKey: string | null; formKind: string | null; formSchema: unknown };
export type VisitRow = { id: string; order: number; stepKey: string; title: string; mandatory: boolean; formKind: string | null; formSchema: unknown };

/** needsDomains that aren't yet configured for /field — candidates for "Add domain". */
export async function loadAvailableDomains(): Promise<{ domain: string; label: string; unit: string }[]> {
  const [configured, all] = await Promise.all([
    prisma.fieldDomainConfig.findMany({ select: { domain: true } }),
    prisma.needsFormulaConfig.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { domain: true, label: true, assessmentLevel: true } }),
  ]);
  const taken = new Set(configured.map((c) => c.domain));
  return all
    .filter((d) => !taken.has(d.domain))
    .map((d) => ({ domain: d.domain, label: d.label ?? d.domain, unit: d.assessmentLevel === "settlement" ? "settlement" : "cluster" }));
}

/** Small lists for the "create intervention" modal. */
export async function loadCreatePickers(): Promise<{
  clusters: { id: string; name: string }[];
  users: { id: string; name: string; designation: string }[];
  layerKeyByDomain: Record<string, string>;
}> {
  const [clusters, users, layers] = await Promise.all([
    prisma.cluster.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }),
    prisma.facilityLayerConfig.findMany({ where: { isActive: true }, select: { layerKey: true, needsDomain: true } }),
  ]);
  const layerKeyByDomain: Record<string, string> = {};
  for (const l of layers) if (l.needsDomain) layerKeyByDomain[l.needsDomain] = l.layerKey;
  return { clusters, users: users.map((u) => ({ id: u.id, name: u.name ?? "—", designation: u.designation })), layerKeyByDomain };
}

/** Data for the assignments page: RP↔cluster + intervention geography. */
export async function loadAssignments(): Promise<{
  clusters: { id: string; name: string }[];
  rps: { id: string; name: string; designation: string; clusterIds: string[] }[];
  interventions: { id: string; title: string; domain: string; unit: string; status: string; mode: string; ownerId: string; ownerName: string; clusterId: string | null; clusterName: string | null; settlementId: string | null; settlementName: string | null; facilityId: string | null; facilityName: string | null }[];
}> {
  const domains = await activeFieldDomains();
  const [clusters, rps, goals] = await Promise.all([
    prisma.cluster.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { designation: { in: ["RP", "ZL", "PM", "Leader"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, rpClusters: { select: { id: true } } } }),
    prisma.goal.findMany({
      where: { deletedAt: null, needsDomain: { in: [...domains.keys()] } },
      orderBy: { title: "asc" },
      select: { id: true, title: true, needsDomain: true, status: true, mode: true, ownerId: true, owner: { select: { name: true } }, needsClusterId: true, needsSettlementId: true, linkedFacilityId: true, needsCluster: { select: { name: true } }, needsSettlement: { select: { name: true } }, linkedFacility: { select: { name: true } } },
    }),
  ]);
  return {
    clusters,
    rps: rps.map((u) => ({ id: u.id, name: u.name ?? "—", designation: u.designation, clusterIds: u.rpClusters.map((c) => c.id) })),
    interventions: goals.map((g) => ({
      id: g.id, title: g.title, domain: g.needsDomain ?? "", unit: domains.get(g.needsDomain ?? "")?.unit ?? "settlement",
      status: g.status, mode: g.mode, ownerId: g.ownerId, ownerName: g.owner?.name ?? "—",
      clusterId: g.needsClusterId, clusterName: g.needsCluster?.name ?? null,
      settlementId: g.needsSettlementId, settlementName: g.needsSettlement?.name ?? null,
      facilityId: g.linkedFacilityId, facilityName: g.linkedFacility?.name ?? null,
    })),
  };
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
      config: { domain: c.domain, label: c.label, unit: c.unit, overallSlaDays: c.overallSlaDays, cadenceCount: c.cadenceCount, cadencePeriod: c.cadencePeriod, hasLivePhase: c.hasLivePhase, caregiverForm: c.caregiverForm, isActive: c.isActive },
      setupSteps: setup.map((s) => ({ id: s.id, order: s.order, stepKey: s.stepKey, title: s.title, slaDays: s.slaDays, startSlaDays: s.startSlaDays, blockedByKey: s.blockedByKey, formKind: s.formKind, formSchema: s.formSchema })),
      visitSteps: visit.map((s) => ({ id: s.id, order: s.order, stepKey: s.stepKey, title: s.title, mandatory: s.mandatory, formKind: s.formKind, formSchema: s.formSchema })),
      counts: { interventions, setupSteps, visitRecipe, visits, openFollowups },
    });
  }
  return out;
}
