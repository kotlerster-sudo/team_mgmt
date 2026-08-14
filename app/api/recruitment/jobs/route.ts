import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { toSlug } from "@/lib/recruitment/slug";

// GET  /api/recruitment/jobs — list (incl. archived; UI filters). Includes
//                              location + scoutingDay count for the library view.
// POST /api/recruitment/jobs — create.
// Both gated on recruitment.read / recruitment.create.

export async function GET(req: NextRequest) {
  const ctx = await buildRbacContext(await auth(), { req });
  if (!(await can(ctx, "recruitment", "read"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await prisma.recruitmentJob.findMany({
    orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
    include: {
      location: true,
      _count: { select: { scoutingDays: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  return NextResponse.json(rows);
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function coerceTheme(v: unknown): "football" | "neutral" {
  return v === "neutral" ? "neutral" : "football";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { req });
  if (!(await can(ctx, "recruitment", "create"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Bad body" }, { status: 400 });

  const title = String(body.title || "").trim();
  const locationId = String(body.locationId || "").trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!locationId) return NextResponse.json({ error: "Location is required" }, { status: 400 });

  const location = await prisma.recruitmentLocation.findUnique({ where: { id: locationId }, select: { city: true } });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  // Slug = title + city, deduped on collision.
  const base = toSlug(`${title}-${location.city}`);
  let slug = base;
  for (let n = 2; await prisma.recruitmentJob.findUnique({ where: { slug } }); n++) {
    slug = `${base}-${n}`;
  }

  // `sourceDocUrl` + `extractedAt` are set when a JD came out of the doc-upload
  // extraction flow (POST /api/recruitment/jobs/extract). Manual JDs leave them null.
  const sourceDocUrl = typeof body.sourceDocUrl === "string" && body.sourceDocUrl.startsWith("https://")
    ? body.sourceDocUrl
    : null;

  const row = await prisma.recruitmentJob.create({
    data: {
      slug,
      title,
      seniority: body.seniority ? String(body.seniority).trim() || null : null,
      locationId,
      dayToDay: body.dayToDay ? String(body.dayToDay) : "",
      mustHaves: coerceStringArray(body.mustHaves),
      niceToHaves: coerceStringArray(body.niceToHaves),
      hardDisqualifiers: coerceStringArray(body.hardDisqualifiers),
      salaryBand: body.salaryBand ? String(body.salaryBand).trim() || null : null,
      theme: coerceTheme(body.theme),
      notes: body.notes ? String(body.notes) : "",
      redFlagRules: coerceStringArray(body.redFlagRules),
      yellowFlagRules: coerceStringArray(body.yellowFlagRules),
      scrutiniseFor: coerceStringArray(body.scrutiniseFor),
      lockedAxes: coerceStringArray(body.lockedAxes),
      sourceDocUrl,
      extractedAt: sourceDocUrl ? new Date() : null,
      createdById: session!.user?.id ?? null,
    },
    include: { location: true },
  });
  return NextResponse.json(row, { status: 201 });
}
