import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildRbacContext, can } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { auditLog } from "@/lib/auditLog";
import type { CentreCatalogOverrides } from "@/lib/catalogDb";

/**
 * Supervisor approves / rejects an ad-hoc catalog item (CatalogItemApproval).
 * Body: { action: "approve" | "reject" }.
 *
 * - approve → status "approved"; the item stays in the catalog.
 * - reject  → status "rejected" AND the item is pulled from the centre's overrides
 *             (added to hiddenKeys + removed from addedItems) so it disappears from visits.
 *
 * Gated on catalog_item.approve (TEAM) + the item's goal being inside the caller's
 * visible set (mirrors the one-hop visibility used by the planner/pin routes).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await can(ctx, "catalog_item", "approve"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action: string = body?.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const appr = await prisma.catalogItemApproval.findUnique({
    where: { id },
    select: {
      id: true, goalId: true, itemKey: true, status: true, addedById: true,
      goal: { select: { centreCatalog: { select: { id: true, overrides: true } } } },
    },
  });
  if (!appr) return Response.json({ error: "Not found" }, { status: 404 });

  // Only a genuine supervisor may approve, and only additions made by one of their reports.
  // TEAM scope resolves to [self] for an RP, so the report-set (visible minus self) is what
  // enforces "you can't approve your own ad-hoc item" — matching the rbacSeed intent.
  const isAdmin = ctx.role === "admin" || ctx.role === "super-admin";
  const reportIds = new Set(await getVisibleUserIds(ctx));
  reportIds.delete(ctx.userId);
  if (!isAdmin && !reportIds.has(appr.addedById)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (appr.status !== "pending") {
    return Response.json({ ok: true, already: appr.status });
  }

  if (action === "approve") {
    await prisma.catalogItemApproval.update({ where: { id }, data: { status: "approved" } });
  } else {
    // Pull the item from the effective catalog, then mark rejected.
    const centre = appr.goal.centreCatalog;
    if (centre) {
      const overrides = (centre.overrides ?? {}) as unknown as CentreCatalogOverrides;
      const next: CentreCatalogOverrides = {
        ...overrides,
        addedItems: (overrides.addedItems ?? []).filter((a) => a.item.key !== appr.itemKey),
        hiddenKeys: [...new Set([...(overrides.hiddenKeys ?? []), appr.itemKey])],
      };
      await prisma.centreCatalog.update({
        where: { id: centre.id },
        data: { overrides: next as unknown as Prisma.InputJsonValue },
      });
    }
    await prisma.catalogItemApproval.update({ where: { id }, data: { status: "rejected" } });
  }

  auditLog({
    entityType: "Goal", entityId: appr.goalId, userId: ctx.userId,
    action: action === "approve" ? "catalog_item_approved" : "catalog_item_rejected",
    field: "itemKey", newValue: appr.itemKey,
  });

  return Response.json({ ok: true });
}
