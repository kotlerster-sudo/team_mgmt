import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { slugifyChecklistText, type DbPitstop } from "@/lib/templateDb";
import type { CatalogCategory } from "@/lib/catalogDb";
import { syncTemplateDefs, syncCatalogDefs } from "@/lib/controlplane/sync";

const keyOf = (explicit: string | undefined, fallback: string) => (explicit ?? "").trim() || slugifyChecklistText(fallback);

// PATCH { nodeId, text } — inline content edit from the control-plane graph.
// For checklist/catalog items the text edit PINS the item's explicit key (so the auto-slug can't
// shift and orphan bindings), writes the JSON source of truth, then reconciles the relational rows.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { nodeId, text } = await req.json();
  if (!nodeId || typeof text !== "string" || !text.trim()) return Response.json({ error: "nodeId and non-empty text required" }, { status: 400 });
  const newText = text.trim();

  try {
    if (nodeId.startsWith("ind:")) {
      await prisma.facilityIndicatorDef.update({ where: { id: nodeId.slice(4) }, data: { label: newText } });
    } else if (nodeId.startsWith("out:")) {
      await prisma.programmeJourneyOutcome.update({ where: { id: nodeId.slice(4) }, data: { label: newText } });
    } else if (nodeId.startsWith("tpl:")) {
      await prisma.goalTemplateDef.update({ where: { id: nodeId.slice(4) }, data: { name: newText } });
    } else if (nodeId.startsWith("ck:")) {
      const cd = await prisma.templateChecklistDef.findUnique({
        where: { id: nodeId.slice(3) },
        select: { key: true, pitstop: { select: { key: true, template: { select: { id: true, pitstops: true } } } } },
      });
      if (!cd) return Response.json({ error: "checklist item not found" }, { status: 404 });
      const templateId = cd.pitstop.template.id;
      const pitstops = (cd.pitstop.template.pitstops as unknown as DbPitstop[]) ?? [];
      const pt = pitstops.find((p) => keyOf(p.key, p.title) === cd.pitstop.key);
      const it = pt?.checklist?.find((c) => keyOf(c.key, c.text) === cd.key);
      if (!it) return Response.json({ error: "checklist item not found in template JSON" }, { status: 404 });
      it.key = cd.key; // pin the key so the slug can't shift
      it.text = newText;
      await prisma.$executeRaw`UPDATE "GoalTemplateDef" SET pitstops = ${JSON.stringify(pitstops)}::jsonb, "updatedAt" = NOW() WHERE id = ${templateId}`;
      await syncTemplateDefs(templateId, pitstops);
    } else if (nodeId.startsWith("cat:")) {
      const ci = await prisma.catalogItemDef.findUnique({
        where: { id: nodeId.slice(4) },
        select: { key: true, category: { select: { key: true, catalog: { select: { id: true, categories: true } } } } },
      });
      if (!ci) return Response.json({ error: "catalog item not found" }, { status: 404 });
      const catalogId = ci.category.catalog.id;
      const categories = (ci.category.catalog.categories as unknown as CatalogCategory[]) ?? [];
      const cat = categories.find((c) => keyOf(c.key, c.label) === ci.category.key);
      const it = cat?.items?.find((i) => keyOf(i.key, i.text) === ci.key);
      if (!it) return Response.json({ error: "catalog item not found in catalog JSON" }, { status: 404 });
      it.key = ci.key; // pin
      it.text = newText;
      await prisma.catalogTemplateDef.update({ where: { id: catalogId }, data: { categories: categories as object[] } });
      await syncCatalogDefs(catalogId, categories);
    } else {
      return Response.json({ error: "this node kind can't be edited here" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
