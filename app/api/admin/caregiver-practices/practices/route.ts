/** Admin: create a caregiver practice. */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const code = String(b?.code ?? "").trim().toUpperCase();
  const categoryId = String(b?.categoryId ?? "").trim();
  const subcategory = String(b?.subcategory ?? "").trim();
  const shortLabel = String(b?.shortLabel ?? "").trim();
  const fullText = String(b?.fullText ?? "").trim();
  if (!code || !categoryId || !subcategory || !shortLabel || !fullText) {
    return Response.json({ error: "code, categoryId, subcategory, shortLabel, fullText required" }, { status: 400 });
  }
  if (await prisma.caregiverPractice.findUnique({ where: { code } })) {
    return Response.json({ error: "code already exists" }, { status: 409 });
  }
  const max = await prisma.caregiverPractice.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
  const practice = await prisma.caregiverPractice.create({
    data: {
      code, categoryId, subcategory, shortLabel, fullText,
      trainingModule: typeof b?.trainingModule === "number" ? b.trainingModule : null,
      sortOrder: b?.sortOrder ?? (max._max.sortOrder ?? 0) + 10,
    },
  });
  return Response.json({ practice });
}
