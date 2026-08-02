"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";

const KINDS = ["geo", "thematic", "operational"];

async function guard() {
  const session = await auth();
  if (!isBudgetAdminOrSuperAdmin(session)) throw new Error("Forbidden");
}

function revalidate() {
  revalidatePath("/admin/granting-units");
  revalidatePath("/admin/partners");
  revalidatePath("/budget");
  revalidatePath("/budget/dashboard");
}

export async function createGrantingUnit(input: { name: string; kind: string; registryCity: string }) {
  await guard();
  const name = input.name.trim();
  if (!name) throw new Error("Name required");
  if (!KINDS.includes(input.kind)) throw new Error("Unknown kind");
  const registryCity = input.registryCity.trim();
  if (!registryCity) throw new Error("Registry city required");

  const existing = await prisma.grantingUnit.findUnique({ where: { name }, select: { id: true } });
  if (existing) throw new Error(`A unit named "${name}" already exists.`);

  const last = await prisma.grantingUnit.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await prisma.grantingUnit.create({
    data: { name, kind: input.kind, registryCity, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  revalidate();
}

/**
 * Renaming has to sweep `Budget.city` / `GrantPartner.city` too: those columns
 * still hold the unit's name and every route (/budget/city/<name>, /admin?city=)
 * keys off it. Leaving them behind would orphan the budgets from their unit tab.
 */
export async function renameGrantingUnit(id: string, name: string) {
  await guard();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name required");
  const unit = await prisma.grantingUnit.findUnique({ where: { id }, select: { name: true } });
  if (!unit) throw new Error("Unit not found");
  if (unit.name === trimmed) return;

  await prisma.$transaction([
    prisma.grantingUnit.update({ where: { id }, data: { name: trimmed } }),
    prisma.budget.updateMany({ where: { grantingUnitId: id }, data: { city: trimmed } }),
    prisma.grantPartner.updateMany({ where: { grantingUnitId: id }, data: { city: trimmed } }),
  ]);
  revalidate();
}

export async function updateGrantingUnit(id: string, data: { kind?: string; registryCity?: string; sortOrder?: number }) {
  await guard();
  if (data.kind && !KINDS.includes(data.kind)) throw new Error("Unknown kind");
  await prisma.grantingUnit.update({
    where: { id },
    data: {
      ...(data.kind ? { kind: data.kind } : {}),
      ...(data.registryCity ? { registryCity: data.registryCity.trim() } : {}),
      ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
    },
  });
  revalidate();
}

/** Deactivate rather than delete — budgets keep pointing at it. */
export async function toggleGrantingUnit(id: string, isActive: boolean) {
  await guard();
  await prisma.grantingUnit.update({ where: { id }, data: { isActive } });
  revalidate();
}
