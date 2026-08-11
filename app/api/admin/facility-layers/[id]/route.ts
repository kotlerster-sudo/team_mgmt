import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { layerKey, label, color, needsDomain, sortOrder, centreTypes } = await req.json();
  if (!layerKey || !label) return Response.json({ error: "layerKey and label are required" }, { status: 400 });

  const resolvedColor = color || "#6366f1";
  const cts = Array.isArray(centreTypes) ? centreTypes : [];
  await prisma.$executeRaw`
    UPDATE "FacilityLayerConfig"
    SET "layerKey" = ${layerKey}, label = ${label}, color = ${resolvedColor},
        "needsDomain" = ${needsDomain ?? null},
        "sortOrder" = ${sortOrder ?? 0}, "centreTypes" = ${JSON.stringify(cts)}::jsonb, "updatedAt" = NOW()
    WHERE id = ${id}
  `;

  return Response.json({ id, layerKey, label, color: resolvedColor, needsDomain: needsDomain ?? null, sortOrder: sortOrder ?? 0, centreTypes: cts });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.$executeRaw`
    UPDATE "FacilityLayerConfig" SET "isActive" = false, "updatedAt" = NOW() WHERE id = ${id}
  `;

  return Response.json({ ok: true });
}
