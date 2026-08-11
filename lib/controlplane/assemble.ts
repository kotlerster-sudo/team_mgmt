// Assembles the programme control-plane graph from the CURRENT data sources (GoalTemplateDef +
// CatalogTemplateDef JSON, FacilityIndicatorDef, ActivityIndicatorBinding, ProgrammeJourneyOutcome).
// After the P2 relational cutover, only the loaders below change — the node/edge output is stable.
//
// The headline value: fragile string-join edges (indicator/outcome bindings, catalog refs) whose
// (templateSlug, checklistKey) is NOT present in the template's key set are surfaced as BROKEN,
// pointing at a phantom checklist node — the silent-orphan bug made visible.

import prisma from "@/lib/prisma";
import { slugifyChecklistText, type DbPitstop } from "@/lib/templateDb";
import type { CatalogCategory } from "@/lib/catalogDb";
import type { CpGraph, CpNode, CpEdge } from "./types";

const tplNodeId = (slug: string) => `tpl:${slug}`;
const ckNodeId = (slug: string, key: string) => `ck:${slug}:${key}`;
const indNodeId = (id: string) => `ind:${id}`;
const outNodeId = (id: string) => `out:${id}`;
const catItemNodeId = (catSlug: string, catKey: string, itemKey: string) => `cat:${catSlug}:${catKey}:${itemKey}`;

export async function assembleControlPlaneGraph(
  domainFilter?: string | null,
  opts: { connectedOnly?: boolean } = {},
): Promise<CpGraph> {
  const [templates, catalogs, indicators, bindings, outcomes] = await Promise.all([
    prisma.goalTemplateDef.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, needsDomain: true, pitstops: true },
      orderBy: { name: "asc" },
    }),
    prisma.catalogTemplateDef.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, needsDomain: true, categories: true },
    }),
    prisma.facilityIndicatorDef.findMany({
      where: { isActive: true },
      select: { id: true, key: true, label: true, domain: true },
    }),
    prisma.activityIndicatorBinding.findMany({
      select: { id: true, defId: true, templateSlug: true, checklistKey: true },
    }),
    prisma.programmeJourneyOutcome.findMany({
      where: { isActive: true, bindingChecklistKey: { not: null } },
      select: {
        id: true, label: true, journeyId: true, bindingTemplateSlug: true, bindingChecklistKey: true,
        journey: { select: { primaryDomain: true } },
      },
    }),
  ]);

  const nodes = new Map<string, CpNode>();
  const edges: CpEdge[] = [];
  const put = (n: CpNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };

  // Canonical checklist-key set + node ids per (slug, key), and the template's domain.
  const keyToNode = new Map<string, string>(); // "slug::key" -> node id
  const templateDomain = new Map<string, string | null>(); // slug -> domain
  const indicatorLabel = new Map<string, string>(); // defId -> label

  // A catalog item with a `ref` also materialises a visit ChecklistItem stamped with that
  // (templateSlug, checklistKey) — so an indicator/outcome binding on that key is functional
  // even when the template no longer contains the item. The valid key universe is therefore
  // TEMPLATE keys ∪ CATALOG-REF keys; only a key in NEITHER is truly broken.
  const catRefKeys = new Set<string>();
  for (const c of catalogs) {
    for (const cat of (c.categories as unknown as CatalogCategory[]) ?? []) {
      for (const item of cat.items ?? []) {
        if (item.ref) catRefKeys.add(`${item.ref.templateSlug}::${item.ref.checklistKey}`);
      }
    }
  }
  const keyIsValid = (slug: string, key: string) => keyToNode.has(`${slug}::${key}`) || catRefKeys.has(`${slug}::${key}`);

  for (const t of templates) {
    templateDomain.set(t.slug, t.needsDomain);
    put({ id: tplNodeId(t.slug), kind: "template", label: t.name, sublabel: t.slug, domain: t.needsDomain, href: `/settings/templates/${t.id}` });
    const pts = (t.pitstops as unknown as DbPitstop[]) ?? [];
    for (const pt of pts) {
      for (const item of pt.checklist ?? []) {
        const key = (item.key ?? "").trim() || slugifyChecklistText(item.text);
        if (!key) continue;
        const id = ckNodeId(t.slug, key);
        put({ id, kind: "checklist", label: item.text, sublabel: pt.title, domain: t.needsDomain, href: `/settings/templates/${t.id}` });
        keyToNode.set(`${t.slug}::${key}`, id);
        edges.push({ id: `e:tc:${t.slug}:${key}`, from: tplNodeId(t.slug), to: id, kind: "templateChecklist" });
      }
    }
  }

  // Resolve a (slug, key) reference to a checklist node. Three cases:
  //  - present in a template  → the real checklist node
  //  - catalog-anchored only  → a valid node (not broken), materialised via the catalog
  //  - neither                → a phantom BROKEN node so the dangling edge is still visible
  const resolveChecklist = (slug: string, key: string): string => {
    const hit = keyToNode.get(`${slug}::${key}`);
    if (hit) return hit;
    const id = ckNodeId(slug, key);
    const catalogAnchored = catRefKeys.has(`${slug}::${key}`);
    put({
      id, kind: "checklist", label: key,
      sublabel: catalogAnchored ? `catalog-anchored (${slug})` : `missing in ${slug}`,
      domain: templateDomain.get(slug) ?? null,
      broken: !catalogAnchored,
    });
    return id;
  };

  for (const ind of indicators) {
    indicatorLabel.set(ind.id, ind.label);
    put({ id: indNodeId(ind.id), kind: "indicator", label: ind.label, sublabel: ind.key, domain: ind.domain, href: `/settings/facility-indicators` });
  }

  // Catalog items that TAG a template checklist (the connective ones). Free-text items have no ref.
  for (const c of catalogs) {
    const cats = (c.categories as unknown as CatalogCategory[]) ?? [];
    for (const cat of cats) {
      for (const item of cat.items ?? []) {
        if (!item.ref) continue;
        const key = (item.key ?? "").trim() || slugifyChecklistText(item.text);
        const nodeId = catItemNodeId(c.slug, cat.key ?? "", key);
        put({ id: nodeId, kind: "catalogItem", label: item.text, sublabel: `${c.name} · ${cat.label}`, domain: c.needsDomain, href: `/settings/catalogs/${c.id}` });
        const target = resolveChecklist(item.ref.templateSlug, item.ref.checklistKey);
        const broken = !keyIsValid(item.ref.templateSlug, item.ref.checklistKey);
        edges.push({ id: `e:catref:${nodeId}`, from: nodeId, to: target, kind: "catalogRef", broken });
      }
    }
  }

  // The fragile ones: indicator bindings (checklist → indicator).
  for (const b of bindings) {
    if (!indicatorLabel.has(b.defId)) continue; // inactive/removed indicator
    const src = resolveChecklist(b.templateSlug, b.checklistKey);
    const broken = !keyIsValid(b.templateSlug, b.checklistKey);
    edges.push({ id: `e:bind:${b.id}`, from: src, to: indNodeId(b.defId), kind: "indicatorBinding", broken });
  }

  // Programme-journey outcome bindings (checklist → outcome).
  for (const o of outcomes) {
    if (!o.bindingTemplateSlug || !o.bindingChecklistKey) continue;
    put({ id: outNodeId(o.id), kind: "journeyOutcome", label: o.label, sublabel: "journey outcome", domain: o.journey?.primaryDomain ?? null, href: `/programmes/${o.journeyId}` });
    const src = resolveChecklist(o.bindingTemplateSlug, o.bindingChecklistKey);
    const broken = !keyIsValid(o.bindingTemplateSlug, o.bindingChecklistKey);
    edges.push({ id: `e:outbind:${o.id}`, from: src, to: outNodeId(o.id), kind: "outcomeBinding", broken });
  }

  let outNodes = [...nodes.values()];
  let outEdges = edges;

  // Connected-only: hide the ~1000 plain checklist items that only have the structural
  // template→checklist edge. Keep nodes that participate in a cross-layer edge (catalog ref /
  // indicator or outcome binding) plus the template parent of any surviving checklist.
  if (opts.connectedOnly) {
    const cross = outEdges.filter((e) => e.kind !== "templateChecklist");
    const keep = new Set(cross.flatMap((e) => [e.from, e.to]));
    const structural = outEdges.filter((e) => e.kind === "templateChecklist" && keep.has(e.to));
    for (const e of structural) keep.add(e.from);
    outEdges = [...cross, ...structural];
    outNodes = outNodes.filter((n) => keep.has(n.id));
  }

  // Domain filter: keep nodes with no domain (cross-cutting) or the requested domain; drop edges
  // whose endpoints were removed.
  if (domainFilter) {
    const keep = new Set(outNodes.filter((n) => !n.domain || n.domain === domainFilter).map((n) => n.id));
    outNodes = outNodes.filter((n) => keep.has(n.id));
    outEdges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    // drop now-isolated cross-cutting nodes (no domain + no surviving edge)
    const connected = new Set(outEdges.flatMap((e) => [e.from, e.to]));
    outNodes = outNodes.filter((n) => n.domain === domainFilter || connected.has(n.id));
  }

  const domains = [...new Set(templates.map((t) => t.needsDomain).filter(Boolean) as string[])].sort();
  const brokenCount = outEdges.filter((e) => e.broken).length;

  return { nodes: outNodes, edges: outEdges, domains, brokenCount };
}
