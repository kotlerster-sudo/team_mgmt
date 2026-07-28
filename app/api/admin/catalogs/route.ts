import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { normalizeCategories, type CatalogCategory } from "@/lib/catalogDb";

// Domain-default visit catalogs (CatalogTemplateDef). Authored in /settings/catalogs.

export async function GET() {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.catalogTemplateDef.findMany({
    orderBy: [{ needsDomain: "asc" }, { name: "asc" }],
  });
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { slug, name, needsDomain, categories, defaultCadenceCount, defaultCadencePeriod } = body;

    if (!slug || !name) {
      return Response.json({ error: "slug and name are required" }, { status: 400 });
    }

    const existing = await prisma.catalogTemplateDef.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      return Response.json({ error: "A catalog with this slug already exists" }, { status: 409 });
    }

    const created = await prisma.catalogTemplateDef.create({
      data: {
        slug,
        name,
        needsDomain: needsDomain ?? null,
        categories: normalizeCategories((categories ?? []) as CatalogCategory[]) as object[],
        defaultCadenceCount: defaultCadenceCount ?? null,
        defaultCadencePeriod: defaultCadencePeriod ?? null,
        isActive: true,
      },
      select: { id: true },
    });

    return Response.json({ id: created.id }, { status: 201 });
  } catch (e) {
    console.error("[admin/catalogs POST] failed:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Create failed: ${message}` }, { status: 500 });
  }
}
