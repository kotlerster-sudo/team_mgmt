// Assembles the programme control-plane graph from the RELATIONAL config tables (P2b cutover).
// Reads TemplatePitstopDef/ChecklistDef + CatalogCategoryDef/ItemDef + FacilityIndicatorDef +
// the FK-clean anchors on ActivityIndicatorBinding / ProgrammeJourneyOutcome. Because anchors are
// real FKs, edges structurally have endpoints; "broken" now means a binding with NO anchor at all.

import prisma from "@/lib/prisma";
import type { CpGraph, CpNode, CpEdge } from "./types";

const tplNodeId = (id: string) => `tpl:${id}`;
const ckNodeId = (id: string) => `ck:${id}`;
const catNodeId = (id: string) => `cat:${id}`;
const indNodeId = (id: string) => `ind:${id}`;
const outNodeId = (id: string) => `out:${id}`;

export async function assembleControlPlaneGraph(
  domainFilter?: string | null,
  opts: { connectedOnly?: boolean } = {},
): Promise<CpGraph> {
  const [templates, catalogs, indicators, bindings, outcomes] = await Promise.all([
    prisma.goalTemplateDef.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, slug: true, needsDomain: true,
        pitstopDefs: { orderBy: { order: "asc" }, select: { title: true, checklist: { orderBy: { order: "asc" }, select: { id: true, text: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.catalogTemplateDef.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, needsDomain: true,
        categoryDefs: { orderBy: { order: "asc" }, select: { label: true, items: { orderBy: { order: "asc" }, select: { id: true, text: true, checklistDefId: true } } } },
      },
    }),
    prisma.facilityIndicatorDef.findMany({ where: { isActive: true }, select: { id: true, key: true, label: true, domain: true } }),
    prisma.activityIndicatorBinding.findMany({ select: { id: true, defId: true, checklistDefId: true, catalogItemDefId: true, templateSlug: true, checklistKey: true } }),
    prisma.programmeJourneyOutcome.findMany({
      where: { isActive: true, OR: [{ bindingChecklistDefId: { not: null } }, { bindingCatalogItemDefId: { not: null } }] },
      select: { id: true, label: true, journeyId: true, bindingChecklistDefId: true, bindingCatalogItemDefId: true, journey: { select: { primaryDomain: true } } },
    }),
  ]);

  const nodes = new Map<string, CpNode>();
  const edges: CpEdge[] = [];
  const put = (n: CpNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const hasIndicator = new Set(indicators.map((i) => i.id));

  for (const t of templates) {
    put({ id: tplNodeId(t.id), kind: "template", label: t.name, sublabel: t.slug, domain: t.needsDomain, href: `/settings/templates/${t.id}` });
    for (const pt of t.pitstopDefs) {
      for (const ci of pt.checklist) {
        put({ id: ckNodeId(ci.id), kind: "checklist", label: ci.text, sublabel: pt.title, domain: t.needsDomain, href: `/settings/templates/${t.id}` });
        edges.push({ id: `e:tc:${ci.id}`, from: tplNodeId(t.id), to: ckNodeId(ci.id), kind: "templateChecklist" });
      }
    }
  }

  for (const c of catalogs) {
    for (const cat of c.categoryDefs) {
      for (const it of cat.items) {
        put({ id: catNodeId(it.id), kind: "catalogItem", label: it.text, sublabel: `${c.name} · ${cat.label}`, domain: c.needsDomain, href: `/settings/catalogs/${c.id}` });
        if (it.checklistDefId) {
          edges.push({ id: `e:catref:${it.id}`, from: catNodeId(it.id), to: ckNodeId(it.checklistDefId), kind: "catalogRef" });
        }
      }
    }
  }

  for (const ind of indicators) {
    put({ id: indNodeId(ind.id), kind: "indicator", label: ind.label, sublabel: ind.key, domain: ind.domain, href: `/settings/facility-indicators` });
  }

  // Bindings: edge from the anchor (checklist OR catalog item) to the indicator. Unanchored = broken.
  for (const b of bindings) {
    if (!hasIndicator.has(b.defId)) continue;
    const from = b.checklistDefId ? ckNodeId(b.checklistDefId) : b.catalogItemDefId ? catNodeId(b.catalogItemDefId) : null;
    if (!from) {
      const phantom = `bad:${b.id}`;
      put({ id: phantom, kind: "checklist", label: b.checklistKey || "(unanchored)", sublabel: `unanchored in ${b.templateSlug}`, domain: null, broken: true });
      edges.push({ id: `e:bind:${b.id}`, from: phantom, to: indNodeId(b.defId), kind: "indicatorBinding", broken: true });
    } else {
      edges.push({ id: `e:bind:${b.id}`, from, to: indNodeId(b.defId), kind: "indicatorBinding" });
    }
  }

  for (const o of outcomes) {
    put({ id: outNodeId(o.id), kind: "journeyOutcome", label: o.label, sublabel: "journey outcome", domain: o.journey?.primaryDomain ?? null, href: `/programmes/${o.journeyId}` });
    const from = o.bindingChecklistDefId ? ckNodeId(o.bindingChecklistDefId) : o.bindingCatalogItemDefId ? catNodeId(o.bindingCatalogItemDefId) : null;
    if (from) edges.push({ id: `e:outbind:${o.id}`, from, to: outNodeId(o.id), kind: "outcomeBinding" });
  }

  let outNodes = [...nodes.values()];
  let outEdges = edges;

  // Connected-only: hide plain checklist items that only carry the structural template→checklist edge.
  if (opts.connectedOnly) {
    const cross = outEdges.filter((e) => e.kind !== "templateChecklist");
    const keep = new Set(cross.flatMap((e) => [e.from, e.to]));
    const structural = outEdges.filter((e) => e.kind === "templateChecklist" && keep.has(e.to));
    for (const e of structural) keep.add(e.from);
    outEdges = [...cross, ...structural];
    outNodes = outNodes.filter((n) => keep.has(n.id));
  }

  if (domainFilter) {
    const keep = new Set(outNodes.filter((n) => !n.domain || n.domain === domainFilter).map((n) => n.id));
    outNodes = outNodes.filter((n) => keep.has(n.id));
    outEdges = outEdges.filter((e) => keep.has(e.from) && keep.has(e.to));
    const connected = new Set(outEdges.flatMap((e) => [e.from, e.to]));
    outNodes = outNodes.filter((n) => n.domain === domainFilter || connected.has(n.id));
  }

  const domains = [...new Set(templates.map((t) => t.needsDomain).filter(Boolean) as string[])].sort();
  const brokenCount = outEdges.filter((e) => e.broken).length;

  return { nodes: outNodes, edges: outEdges, domains, brokenCount };
}
