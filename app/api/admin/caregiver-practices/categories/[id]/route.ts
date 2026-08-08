/** Admin: edit / soft-delete a caregiver-practice category. */
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
  const data: { name?: string; sortOrder?: number; isActive?: boolean } = {};
  if (typeof b.name === "string") data.name = b.name.trim();
  if (typeof b.sortOrder === "number") data.sortOrder = b.sortOrder;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive;

  const category = await prisma.caregiverPracticeCategory.update({ where: { id }, data });
  return Response.json({ category });
}
