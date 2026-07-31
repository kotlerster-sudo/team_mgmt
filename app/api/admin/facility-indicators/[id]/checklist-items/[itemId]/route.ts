import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";

/**
 * Single scored-checklist item. PUT edits text/category/flags/order/isActive
 * (itemKey immutable — it anchors seed idempotency + historical answers).
 * DELETE = soft-delete (isActive=false); answers reference the item id, so
 * hard deletes are blocked by the FK anyway.
 */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id, itemId } = await params;
  const body = await req.json();

  const text = typeof body?.text === "string" ? body.text.trim() : null;
  if (body?.text !== undefined && !text) {
    return Response.json({ error: "text cannot be empty" }, { status: 400 });
  }
  const category =
    body?.category === undefined
      ? undefined
      : typeof body.category === "string" && body.category.trim()
        ? body.category.trim()
        : null;
  const nonNegotiable = body?.nonNegotiable === undefined ? undefined : body.nonNegotiable === true;
  const naAllowed = body?.naAllowed === undefined ? undefined : body.naAllowed === true;
  const sortOrder =
    body?.sortOrder === undefined
      ? undefined
      : Number.isFinite(Number(body.sortOrder))
        ? Math.trunc(Number(body.sortOrder))
        : undefined;
  const isActive = body?.isActive === undefined ? undefined : body.isActive === true;

  const updated = await prisma.$executeRaw`
    UPDATE "IndicatorChecklistItemDef" SET
      text = COALESCE(${text}, text),
      -- category is nullable, so COALESCE can't express "not provided" — use
      -- an explicit provided flag instead.
      category = CASE WHEN ${category !== undefined}::boolean THEN ${category ?? null}::text ELSE category END,
      "nonNegotiable" = COALESCE(${nonNegotiable ?? null}::boolean, "nonNegotiable"),
      "naAllowed" = COALESCE(${naAllowed ?? null}::boolean, "naAllowed"),
      "sortOrder" = COALESCE(${sortOrder ?? null}::integer, "sortOrder"),
      "isActive" = COALESCE(${isActive ?? null}::boolean, "isActive"),
      "updatedAt" = NOW()
    WHERE id = ${itemId} AND "defId" = ${id}
  `;
  if (updated === 0) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id, itemId } = await params;
  const updated = await prisma.$executeRaw`
    UPDATE "IndicatorChecklistItemDef"
    SET "isActive" = false, "updatedAt" = NOW()
    WHERE id = ${itemId} AND "defId" = ${id}
  `;
  if (updated === 0) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ ok: true });
}
