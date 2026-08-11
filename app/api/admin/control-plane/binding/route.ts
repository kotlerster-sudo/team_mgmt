import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { randomUUID } from "crypto";

// Inline editing from the control-plane graph: create / delete an indicator binding by node ids.
// Sets BOTH the FK anchor and the legacy (templateSlug, checklistKey) — runtime capture still reads
// the string keys until that path is cut over.

// POST { indicatorDefId, anchorNodeId }  — anchorNodeId = "ck:<checklistDefId>" | "cat:<catalogItemDefId>"
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { indicatorDefId, anchorNodeId } = await req.json();
  if (!indicatorDefId || !anchorNodeId) return Response.json({ error: "indicatorDefId and anchorNodeId required" }, { status: 400 });

  let templateSlug: string, checklistKey: string;
  let checklistDefId: string | null = null;
  let catalogItemDefId: string | null = null;

  if (anchorNodeId.startsWith("ck:")) {
    const id = anchorNodeId.slice(3);
    const cd = await prisma.templateChecklistDef.findUnique({ where: { id }, select: { key: true, pitstop: { select: { template: { select: { slug: true } } } } } });
    if (!cd) return Response.json({ error: "checklist item not found" }, { status: 404 });
    templateSlug = cd.pitstop.template.slug;
    checklistKey = cd.key;
    checklistDefId = id;
  } else if (anchorNodeId.startsWith("cat:")) {
    const id = anchorNodeId.slice(4);
    const ci = await prisma.catalogItemDef.findUnique({ where: { id }, select: { refTemplateSlug: true, refChecklistKey: true } });
    if (!ci) return Response.json({ error: "catalog item not found" }, { status: 404 });
    if (!ci.refTemplateSlug || !ci.refChecklistKey) return Response.json({ error: "This catalog item is free-text (no materialisation key) — it can't feed an indicator." }, { status: 400 });
    templateSlug = ci.refTemplateSlug;
    checklistKey = ci.refChecklistKey;
    catalogItemDefId = id;
  } else {
    return Response.json({ error: "anchor must be a checklist or catalog item" }, { status: 400 });
  }

  const id = randomUUID();
  try {
    await prisma.activityIndicatorBinding.create({
      data: { id, defId: indicatorDefId, templateSlug, checklistKey, numericField: `binding_${id.slice(0, 8)}`, checklistDefId, catalogItemDefId },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique") || msg.includes("unique") || msg.includes("P2002")) {
      return Response.json({ error: "This item is already bound to this indicator" }, { status: 409 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
  return Response.json({ id }, { status: 201 });
}

// DELETE { bindingId }
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { bindingId } = await req.json();
  if (!bindingId) return Response.json({ error: "bindingId required" }, { status: 400 });
  await prisma.activityIndicatorBinding.deleteMany({ where: { id: bindingId } });
  return Response.json({ ok: true });
}
