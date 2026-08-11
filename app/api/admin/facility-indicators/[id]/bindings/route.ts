import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { randomUUID } from "crypto";
import { resolveBindingAnchor } from "@/lib/controlplane/sync";
import { isValidChecklistKey } from "@/lib/controlplane/keys";

type BindingRow = {
  id: string;
  defId: string;
  templateSlug: string;
  checklistKey: string;
  numericField: string;
  createdAt: Date;
  templateName: string | null;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rows = await prisma.$queryRaw<BindingRow[]>`
    SELECT b.id, b."defId", b."templateSlug", b."checklistKey",
           b."numericField", b."createdAt",
           t.name AS "templateName"
    FROM "ActivityIndicatorBinding" b
    LEFT JOIN "GoalTemplateDef" t ON t.slug = b."templateSlug"
    WHERE b."defId" = ${id}
    ORDER BY t.name, b."checklistKey"
  `;

  return Response.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { templateSlug, checklistKey } = body;

  if (!templateSlug || !checklistKey) {
    return Response.json({ error: "templateSlug and checklistKey required" }, { status: 400 });
  }

  // Integrity: reject a binding on a key that exists in no template and no catalog — it would be a
  // silent orphan (never fires at runtime, shows broken in the control-plane graph).
  if (!(await isValidChecklistKey(templateSlug, checklistKey))) {
    return Response.json({ error: `No checklist item "${checklistKey}" in template "${templateSlug}" (or any catalog). Fix the key first.` }, { status: 400 });
  }

  const bindingId = randomUUID();
  const numericField = `binding_${bindingId.slice(0, 8)}`;

  try {
    await prisma.$executeRaw`
      INSERT INTO "ActivityIndicatorBinding" (id, "defId", "templateSlug", "checklistKey", "numericField", "createdAt")
      VALUES (${bindingId}, ${id}, ${templateSlug}, ${checklistKey}, ${numericField}, NOW())
    `;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return Response.json({ error: "This checklist item is already bound to this indicator" }, { status: 409 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }

  // Dual-write: set the FK-clean anchor (template checklist def or catalog-native item). Non-blocking.
  try {
    const anchor = await resolveBindingAnchor(templateSlug, checklistKey);
    await prisma.activityIndicatorBinding.update({ where: { id: bindingId }, data: anchor });
  } catch (anchorErr) {
    console.error("[admin/bindings POST] anchor resolve failed:", anchorErr);
  }

  return Response.json({ id: bindingId, defId: id, templateSlug, checklistKey, numericField }, { status: 201 });
}
