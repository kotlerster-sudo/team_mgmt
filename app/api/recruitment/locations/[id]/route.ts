import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";

// PUT   /api/recruitment/locations/[id] — update
// DELETE /api/recruitment/locations/[id] — soft-archive (never hard delete; JDs FK to it)
// Both gated on recruitment.update / recruitment.delete.

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await buildRbacContext(await auth(), { req });
  if (!(await can(ctx, "recruitment", "update"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Bad body" }, { status: 400 });
  const city = String(body.city || "").trim();
  if (!city) return NextResponse.json({ error: "City is required" }, { status: 400 });

  const row = await prisma.recruitmentLocation.update({
    where: { id },
    data: {
      city,
      state: body.state ? String(body.state).trim() || null : null,
      country: String(body.country || "IN").trim() || "IN",
      primaryLanguage: body.primaryLanguage ? String(body.primaryLanguage).trim() || null : null,
      localSalaryBands: body.localSalaryBands ? (body.localSalaryBands as Prisma.InputJsonValue) : Prisma.JsonNull,
      localReferenceOrgs: coerceStringArray(body.localReferenceOrgs),
      localRedFlags: coerceStringArray(body.localRedFlags),
      mobilityDefault: body.mobilityDefault ? String(body.mobilityDefault).trim() || null : null,
      notes: body.notes ? String(body.notes) : "",
    },
  });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await buildRbacContext(await auth(), { req });
  if (!(await can(ctx, "recruitment", "delete"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;

  // Soft-archive. Any RecruitmentJob still FKs to it, so a hard delete would
  // ON DELETE RESTRICT and 500; and we want the audit trail anyway.
  await prisma.recruitmentLocation.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
