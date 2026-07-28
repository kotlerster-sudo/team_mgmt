import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildRbacContext, can } from "@/lib/rbac";
import { slugifyChecklistText } from "@/lib/templateDb";
import { auditLog } from "@/lib/auditLog";
import type { CatalogCategory, CatalogItem, CentreCatalogOverrides } from "@/lib/catalogDb";

/**
 * RP adds an off-catalog item during a visit. Appends the item to the centre's sparse
 * overrides (source "added") so it's tickable immediately, and opens a pending
 * CatalogItemApproval for a supervisor to confirm. Non-mandatory by default so a pending
 * item never blocks visit sign-off. Gated on catalog_item.create (OWN) + goal ownership.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;
  const actorId = ctx.userId;

  // "Anyone with rights" — gate purely on catalog_item.create, no ownership requirement.
  if (!(await can(ctx, "catalog_item", "create"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const text: string = (body?.text ?? "").trim();
  const categoryKey: string = (body?.categoryKey ?? "").trim();
  if (!text || !categoryKey) return Response.json({ error: "text and categoryKey required" }, { status: 400 });

  const centre = await prisma.centreCatalog.findFirst({
    where: { goalId },
    select: { id: true, snapshot: true, overrides: true },
  });
  if (!centre) return Response.json({ error: "Not a live centre" }, { status: 400 });

  const snapshot = (centre.snapshot ?? []) as unknown as CatalogCategory[];
  const overrides = (centre.overrides ?? {}) as unknown as CentreCatalogOverrides;

  const catKey = (c: { key?: string; label: string }) => c.key || slugifyChecklistText(c.label);
  const categoryExists =
    snapshot.some((c) => catKey(c) === categoryKey) ||
    (overrides.addedCategories ?? []).some((c) => catKey(c) === categoryKey);
  if (!categoryExists) return Response.json({ error: "Unknown category" }, { status: 400 });

  const itemKey = slugifyChecklistText(text);
  const itemKeyOf = (i: { key?: string; text: string }) => i.key || slugifyChecklistText(i.text);
  const alreadyInCatalog = [
    ...snapshot.flatMap((c) => c.items ?? []),
    ...(overrides.addedItems ?? []).map((a) => a.item),
    ...(overrides.addedCategories ?? []).flatMap((c) => c.items ?? []),
  ].some((i) => itemKeyOf(i) === itemKey);
  if (alreadyInCatalog) return Response.json({ error: "An item with this name already exists" }, { status: 409 });

  const item: CatalogItem = { key: itemKey, text, completionType: "Activity", blocksSignoff: false };
  const newOverrides: CentreCatalogOverrides = {
    ...overrides,
    addedItems: [...(overrides.addedItems ?? []), { categoryKey, item }],
  };

  await prisma.centreCatalog.update({
    where: { id: centre.id },
    data: { overrides: newOverrides as unknown as Prisma.InputJsonValue },
  });
  await prisma.catalogItemApproval.upsert({
    where: { goalId_itemKey: { goalId, itemKey } },
    create: { goalId, itemKey, addedById: actorId, status: "pending" },
    update: { status: "pending", addedById: actorId },
  });

  auditLog({
    entityType: "Goal", entityId: goalId, userId: actorId,
    action: "catalog_item_added", field: "itemKey", newValue: itemKey,
  });

  return Response.json({ ok: true, itemKey });
}
