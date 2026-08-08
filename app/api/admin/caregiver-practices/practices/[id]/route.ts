/** Admin: edit / soft-delete a caregiver practice. */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const data: {
    categoryId?: string; subcategory?: string; shortLabel?: string; fullText?: string;
    trainingModule?: number | null; sortOrder?: number; isActive?: boolean;
  } = {};
  if (typeof b.categoryId === "string") data.categoryId = b.categoryId;
  if (typeof b.subcategory === "string") data.subcategory = b.subcategory.trim();
  if (typeof b.shortLabel === "string") data.shortLabel = b.shortLabel.trim();
  if (typeof b.fullText === "string") data.fullText = b.fullText.trim();
  if (b.trainingModule === null || typeof b.trainingModule === "number") data.trainingModule = b.trainingModule;
  if (typeof b.sortOrder === "number") data.sortOrder = b.sortOrder;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive;

  const practice = await prisma.caregiverPractice.update({ where: { id }, data });
  return Response.json({ practice });
}
