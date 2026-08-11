import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { randomUUID } from "crypto";

const DEFAULTS = [
  { layerKey: "creches",          label: "Creche",                color: "#ec4899", needsDomain: "Creche",              sortOrder: 0, centreTypes: ["Creche"] },
  { layerKey: "children_centres", label: "Children Centre",       color: "#f97316", needsDomain: "ChildrenCentre",       sortOrder: 1, centreTypes: ["Children Centre"] },
  { layerKey: "youth_centres",    label: "Youth Resource Centre", color: "#8b5cf6", needsDomain: "YouthResourceCentre",  sortOrder: 2, centreTypes: ["Youth Centre"] },
  { layerKey: "elderly_centres",  label: "Elderly Centre",        color: "#0d9488", needsDomain: null,                   sortOrder: 3, centreTypes: ["Elderly Centre"] },
  { layerKey: "water_atms",       label: "Water ATM",             color: "#0ea5e9", needsDomain: null,                   sortOrder: 4, centreTypes: ["Water ATM"] },
  { layerKey: "resource_centres", label: "Resource Centre",       color: "#6366f1", needsDomain: null,                   sortOrder: 5, centreTypes: ["Resource Centre", "Community Resource Centre"] },
];

type LayerRow = { id: string; layerKey: string; label: string; color: string; needsDomain: string | null; sortOrder: number; centreTypes: string[] };
const SELECT = `SELECT id, "layerKey", label, color, "needsDomain", "sortOrder", "centreTypes" FROM "FacilityLayerConfig" WHERE "isActive" = true ORDER BY "sortOrder" ASC, label ASC`;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let rows = await prisma.$queryRawUnsafe<LayerRow[]>(SELECT);

  if (rows.length === 0) {
    for (const d of DEFAULTS) {
      await prisma.$executeRaw`
        INSERT INTO "FacilityLayerConfig" (id, "layerKey", label, color, "needsDomain", "sortOrder", "centreTypes", "isActive", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${d.layerKey}, ${d.label}, ${d.color}, ${d.needsDomain}, ${d.sortOrder}, ${JSON.stringify(d.centreTypes)}::jsonb, true, NOW(), NOW())
        ON CONFLICT ("layerKey") DO NOTHING
      `;
    }
  } else {
    for (const d of DEFAULTS) {
      // seed the color + centre-type suggestions where they were never set
      await prisma.$executeRaw`UPDATE "FacilityLayerConfig" SET color = ${d.color}, "updatedAt" = NOW() WHERE "layerKey" = ${d.layerKey} AND color = '#6366f1'`;
      await prisma.$executeRaw`UPDATE "FacilityLayerConfig" SET "centreTypes" = ${JSON.stringify(d.centreTypes)}::jsonb, "updatedAt" = NOW() WHERE "layerKey" = ${d.layerKey} AND "centreTypes" = '[]'::jsonb`;
    }
  }

  rows = await prisma.$queryRawUnsafe<LayerRow[]>(SELECT);
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { layerKey, label, color, needsDomain, sortOrder, centreTypes } = await req.json();
  if (!layerKey || !label) return Response.json({ error: "layerKey and label are required" }, { status: 400 });

  const id = randomUUID();
  const resolvedColor = color || "#6366f1";
  const cts = Array.isArray(centreTypes) ? centreTypes : [];
  try {
    await prisma.$executeRaw`
      INSERT INTO "FacilityLayerConfig" (id, "layerKey", label, color, "needsDomain", "sortOrder", "centreTypes", "isActive", "createdAt", "updatedAt")
      VALUES (${id}, ${layerKey}, ${label}, ${resolvedColor}, ${needsDomain ?? null}, ${sortOrder ?? 0}, ${JSON.stringify(cts)}::jsonb, true, NOW(), NOW())
    `;
  } catch {
    return Response.json({ error: "Layer key already exists" }, { status: 409 });
  }

  return Response.json({ id, layerKey, label, color: resolvedColor, needsDomain: needsDomain ?? null, sortOrder: sortOrder ?? 0, centreTypes: cts }, { status: 201 });
}
