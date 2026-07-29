import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildRbacContext, can } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { goalOwnedByAnyOf } from "@/lib/ownership";
import { slugifyChecklistText } from "@/lib/templateDb";
import { auditLog } from "@/lib/auditLog";
import type { CatalogCategory, CatalogItem, CentreCatalogOverrides } from "@/lib/catalogDb";

/**
 * Supervisor deploys catalog items onto an RP's LIVE centre — the "catalog shelf".
 *
 * Reuses the exact per-centre override mechanism the RP "Add item" flow uses: each deployed item
 * is appended to CentreCatalog.overrides under a dedicated "Assigned" added category, tagged with
 * its template `ref` so indicator/journey bindings resolve on completion, and marked APPROVED
 * (supervisor-authored — no pending review). Items materialise into the RP's next visit via the
 * standard materialiseVisitItems path. Optional by default; `required` sets blocksSignoff.
 *
 * Gated on catalog_item.deploy (TEAM) + the goal being in the supervisor's visible set.
 */

const ASSIGNED_CATEGORY = { key: "supervisor_assigned", label: "Assigned" };

type DeployItem = {
  templateSlug: string;
  checklistKey: string;
  text: string;
  completionType?: string;
  required?: boolean;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;

  if (!(await can(ctx, "catalog_item", "deploy"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Confine deployment to the supervisor's visible (team) set — you deploy to your reports' centres.
  const visibleIds = await getVisibleUserIds(ctx);
  const owned = await prisma.goal.count({ where: { id: goalId, deletedAt: null, ...goalOwnedByAnyOf(visibleIds) } });
  if (!owned) return Response.json({ error: "Not in your team" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rawItems: DeployItem[] = Array.isArray(body?.items) ? body.items : [];
  const items = rawItems.filter((i) => i && typeof i.templateSlug === "string" && typeof i.text === "string" && i.text.trim());
  if (items.length === 0) return Response.json({ error: "No items to deploy" }, { status: 400 });

  const centre = await prisma.centreCatalog.findFirst({
    where: { goalId },
    select: { id: true, snapshot: true, overrides: true },
  });
  if (!centre) return Response.json({ error: "Not a live centre" }, { status: 400 });

  const snapshot = (centre.snapshot ?? []) as unknown as CatalogCategory[];
  const overrides = (centre.overrides ?? {}) as unknown as CentreCatalogOverrides;

  const itemKeyOf = (i: { key?: string; text: string }) => i.key || slugifyChecklistText(i.text);
  const existingKeys = new Set<string>([
    ...snapshot.flatMap((c) => (c.items ?? []).map(itemKeyOf)),
    ...(overrides.addedItems ?? []).map((a) => itemKeyOf(a.item)),
    ...(overrides.addedCategories ?? []).flatMap((c) => (c.items ?? []).map(itemKeyOf)),
  ]);

  const toAdd: CatalogItem[] = [];
  for (const it of items) {
    const checklistKey = it.checklistKey || slugifyChecklistText(it.text);
    if (existingKeys.has(checklistKey)) continue; // already on this centre's catalog — skip
    existingKeys.add(checklistKey);
    toAdd.push({
      key: checklistKey,
      text: it.text.trim(),
      completionType: it.completionType || "Activity",
      blocksSignoff: !!it.required,
      ref: { templateSlug: it.templateSlug, checklistKey },
    });
  }
  if (toAdd.length === 0) return Response.json({ ok: true, added: 0 });

  // Append into the dedicated "Assigned" added category (create it if absent).
  const addedCategories = [...(overrides.addedCategories ?? [])];
  const catKeyOf = (c: { key?: string; label: string }) => c.key || slugifyChecklistText(c.label);
  const idx = addedCategories.findIndex((c) => catKeyOf(c) === ASSIGNED_CATEGORY.key);
  if (idx >= 0) {
    addedCategories[idx] = { ...addedCategories[idx], items: [...(addedCategories[idx].items ?? []), ...toAdd] };
  } else {
    addedCategories.push({ ...ASSIGNED_CATEGORY, items: toAdd });
  }
  const newOverrides: CentreCatalogOverrides = { ...overrides, addedCategories };

  await prisma.centreCatalog.update({
    where: { id: centre.id },
    data: { overrides: newOverrides as unknown as Prisma.InputJsonValue },
  });

  // Supervisor-authored → approved outright (RP-added items are pending; these aren't).
  for (const it of toAdd) {
    await prisma.catalogItemApproval.upsert({
      where: { goalId_itemKey: { goalId, itemKey: it.key } },
      create: { goalId, itemKey: it.key, addedById: ctx.userId, status: "approved" },
      update: { status: "approved", addedById: ctx.userId },
    });
  }

  auditLog({
    entityType: "Goal", entityId: goalId, userId: ctx.userId,
    action: "catalog_items_deployed", field: "count", newValue: String(toAdd.length),
  });

  return Response.json({ ok: true, added: toAdd.length });
}
