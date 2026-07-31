import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { randomUUID } from "crypto";

/**
 * Scored-checklist items on a FacilityIndicatorDef (creche 24-point safety
 * etc.). GET lists all (incl. inactive, so admins can see soft-deleted
 * history anchors); POST creates one. Item identity = (defId, itemKey);
 * itemKey is server-slugified from text when not supplied and immutable
 * afterwards (historical IndicatorPointAnswer rows hang off the item id).
 */

type ItemRow = {
  id: string;
  defId: string;
  itemKey: string;
  text: string;
  category: string | null;
  nonNegotiable: boolean;
  naAllowed: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
};

function slugifyKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rows = await prisma.$queryRaw<ItemRow[]>`
    SELECT id, "defId", "itemKey", text, category, "nonNegotiable",
           "naAllowed", "sortOrder", "isActive", "createdAt"
    FROM "IndicatorChecklistItemDef"
    WHERE "defId" = ${id}
    ORDER BY "sortOrder", "createdAt"
  `;

  return Response.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  const itemKey =
    typeof body?.itemKey === "string" && body.itemKey.trim()
      ? slugifyKey(body.itemKey)
      : slugifyKey(text);
  if (!itemKey) return Response.json({ error: "Couldn't derive a key from text" }, { status: 400 });

  const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;
  const nonNegotiable = body?.nonNegotiable === true;
  const naAllowed = body?.naAllowed === true;
  const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0;

  const itemId = randomUUID();
  try {
    await prisma.$executeRaw`
      INSERT INTO "IndicatorChecklistItemDef" (
        id, "defId", "itemKey", text, category, "nonNegotiable",
        "naAllowed", "sortOrder", "isActive", "createdAt", "updatedAt"
      ) VALUES (
        ${itemId}, ${id}, ${itemKey}, ${text}, ${category}, ${nonNegotiable},
        ${naAllowed}, ${sortOrder}, true, NOW(), NOW()
      )
    `;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return Response.json({ error: "An item with this key already exists on this indicator" }, { status: 409 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }

  return Response.json(
    { id: itemId, defId: id, itemKey, text, category, nonNegotiable, naAllowed, sortOrder, isActive: true },
    { status: 201 },
  );
}
