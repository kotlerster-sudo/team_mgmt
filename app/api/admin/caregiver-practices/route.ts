/**
 * Admin: caregiver-practice taxonomy.
 *   GET  ?all=1        → { categories:[{…, practices:[…]}] }  (all=1 includes inactive)
 *   POST { code, name, sortOrder? }  → create a category
 * Read: any authed user (the capture drill needs the taxonomy). Write: admin.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const all = new URL(req.url).searchParams.get("all") === "1";

  const categories = await prisma.caregiverPracticeCategory.findMany({
    where: all ? {} : { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true, code: true, name: true, sortOrder: true, isActive: true,
      practices: {
        where: all ? {} : { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, subcategory: true, shortLabel: true, fullText: true, trainingModule: true, sortOrder: true, isActive: true },
      },
    },
  });
  return Response.json({ categories });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const code = String(b?.code ?? "").trim().toUpperCase();
  const name = String(b?.name ?? "").trim();
  if (!code || !name) return Response.json({ error: "code + name required" }, { status: 400 });
  if (await prisma.caregiverPracticeCategory.findUnique({ where: { code } })) {
    return Response.json({ error: "code already exists" }, { status: 409 });
  }
  const max = await prisma.caregiverPracticeCategory.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.caregiverPracticeCategory.create({
    data: { code, name, sortOrder: b?.sortOrder ?? (max._max.sortOrder ?? 0) + 10 },
  });
  return Response.json({ category });
}
