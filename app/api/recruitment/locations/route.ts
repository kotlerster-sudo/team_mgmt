import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { toSlug } from "@/lib/recruitment/slug";

// GET /api/recruitment/locations — list all (including archived; UI filters)
// POST /api/recruitment/locations — create
// Both gated on recruitment.read / recruitment.create respectively.

export async function GET(req: NextRequest) {
  const ctx = await buildRbacContext(await auth(), { req });
  if (!(await can(ctx, "recruitment", "read"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await prisma.recruitmentLocation.findMany({
    orderBy: [{ archivedAt: "asc" }, { city: "asc" }],
    include: { _count: { select: { jobs: true } } },
  });
  return NextResponse.json(rows);
}

type LocationBody = {
  city?: unknown;
  state?: unknown;
  country?: unknown;
  primaryLanguage?: unknown;
  localSalaryBands?: unknown;
  localReferenceOrgs?: unknown;
  localRedFlags?: unknown;
  mobilityDefault?: unknown;
  notes?: unknown;
};

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

export async function POST(req: NextRequest) {
  const ctx = await buildRbacContext(await auth(), { req });
  if (!(await can(ctx, "recruitment", "create"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as LocationBody | null;
  const city = String(body?.city || "").trim();
  if (!city) return NextResponse.json({ error: "City is required" }, { status: 400 });

  const state = body?.state ? String(body.state).trim() || null : null;
  const country = String(body?.country || "IN").trim() || "IN";
  const base = toSlug([city, state].filter(Boolean).join("-"));
  // Suffix on collision to allow same-city rows (rare but not blocked — e.g. "Chennai · outer").
  let slug = base;
  for (let n = 2; await prisma.recruitmentLocation.findUnique({ where: { slug } }); n++) {
    slug = `${base}-${n}`;
  }

  const row = await prisma.recruitmentLocation.create({
    data: {
      slug,
      city,
      state,
      country,
      primaryLanguage: body?.primaryLanguage ? String(body.primaryLanguage).trim() || null : null,
      localSalaryBands: body?.localSalaryBands ? (body.localSalaryBands as Prisma.InputJsonValue) : Prisma.JsonNull,
      localReferenceOrgs: coerceStringArray(body?.localReferenceOrgs),
      localRedFlags: coerceStringArray(body?.localRedFlags),
      mobilityDefault: body?.mobilityDefault ? String(body.mobilityDefault).trim() || null : null,
      notes: body?.notes ? String(body.notes) : "",
    },
  });
  return NextResponse.json(row, { status: 201 });
}
