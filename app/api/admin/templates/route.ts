import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { syncTemplateDefs } from "@/lib/controlplane/sync";
import type { DbPitstop } from "@/lib/templateDb";

export async function GET() {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT id, slug, name, description, category, icon, "needsDomain",
           "linkedFacilityLayerKey", "sortOrder", parameters, pitstops, "isActive", "createdAt", "updatedAt"
    FROM "GoalTemplateDef"
    ORDER BY "sortOrder" ASC, name ASC
  `;
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { slug, name, description, category, icon, needsDomain, linkedFacilityLayerKey, sortOrder, parameters, pitstops } = body;

    if (!slug || !name || !category) {
      return Response.json({ error: "slug, name, and category are required" }, { status: 400 });
    }

    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "GoalTemplateDef" WHERE slug = ${slug} LIMIT 1
    `;
    if (existing.length > 0) {
      return Response.json({ error: "A template with this slug already exists" }, { status: 409 });
    }

    // Use Prisma client (not raw SQL) so the @default(cuid()) on id is applied —
    // raw INSERT would skip the client-side default and violate the NOT NULL constraint.
    const created = await prisma.goalTemplateDef.create({
      data: {
        slug,
        name,
        description: description ?? "",
        category,
        icon: icon ?? "🎯",
        needsDomain: needsDomain ?? null,
        linkedFacilityLayerKey: linkedFacilityLayerKey ?? null,
        sortOrder: sortOrder ?? 99,
        parameters: parameters ?? [],
        pitstops: pitstops ?? [],
        isActive: true,
      },
      select: { id: true },
    });

    // Dual-write the relational config-graph tables (critical: reads may be on relational).
    try {
      await syncTemplateDefs(created.id, (pitstops ?? []) as DbPitstop[]);
    } catch (syncErr) {
      console.error("[admin/templates POST] control-plane dual-write failed:", syncErr);
    }

    return Response.json({ id: created.id }, { status: 201 });
  } catch (e) {
    console.error("[admin/templates POST] failed:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Create failed: ${message}` }, { status: 500 });
  }
}
