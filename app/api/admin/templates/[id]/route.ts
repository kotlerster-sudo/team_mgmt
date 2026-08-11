import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { syncTemplateDefs } from "@/lib/controlplane/sync";
import type { DbPitstop } from "@/lib/templateDb";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT id, slug, name, description, category, icon, "needsDomain",
           "linkedFacilityLayerKey", "sortOrder", parameters, pitstops, "isActive", "createdAt", "updatedAt"
    FROM "GoalTemplateDef"
    WHERE id = ${id}
    LIMIT 1
  `;
  if (!rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(rows[0]);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    const body = await req.json();
    const { name, description, category, icon, needsDomain, linkedFacilityLayerKey, sortOrder, parameters, pitstops, isActive } = body;

    if (!name || !category) {
      return Response.json({ error: "name and category are required" }, { status: 400 });
    }

    await prisma.$executeRaw`
      UPDATE "GoalTemplateDef" SET
        name        = ${name},
        description = ${description ?? ""},
        category    = ${category},
        icon        = ${icon ?? "🎯"},
        "needsDomain" = ${needsDomain ?? null},
        "linkedFacilityLayerKey" = ${linkedFacilityLayerKey ?? null},
        "sortOrder" = ${sortOrder ?? 99},
        parameters  = ${JSON.stringify(parameters ?? [])}::jsonb,
        pitstops    = ${JSON.stringify(pitstops ?? [])}::jsonb,
        "isActive"  = ${isActive ?? true},
        "updatedAt" = NOW()
      WHERE id = ${id}
    `;

    // Dual-write: mirror pitstops JSON into the relational config-graph tables (P2). Non-blocking —
    // a sync failure never fails the save; drift is recoverable via scripts/backfill-control-plane-defs.
    try {
      await syncTemplateDefs(id, (pitstops ?? []) as DbPitstop[]);
    } catch (syncErr) {
      console.error("[admin/templates PUT] control-plane dual-write failed:", syncErr);
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[admin/templates PUT] failed:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Save failed: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const permanent = new URL(req.url).searchParams.get("permanent") === "true";

  if (permanent) {
    await prisma.$executeRaw`DELETE FROM "GoalTemplateDef" WHERE id = ${id}`;
  } else {
    // Soft delete — hides from the goal modal but keeps the row
    await prisma.$executeRaw`
      UPDATE "GoalTemplateDef" SET "isActive" = false, "updatedAt" = NOW() WHERE id = ${id}
    `;
  }

  return Response.json({ ok: true });
}
