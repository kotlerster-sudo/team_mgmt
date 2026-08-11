import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { normalizeCategories, type CatalogCategory } from "@/lib/catalogDb";
import { syncCatalogDefs } from "@/lib/controlplane/sync";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const row = await prisma.catalogTemplateDef.findUnique({ where: { id } });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    const body = await req.json();
    const { name, needsDomain, categories, defaultCadenceCount, defaultCadencePeriod, isActive } = body;

    if (!name) return Response.json({ error: "name is required" }, { status: 400 });

    const normalized = normalizeCategories((categories ?? []) as CatalogCategory[]);
    await prisma.catalogTemplateDef.update({
      where: { id },
      data: {
        name,
        needsDomain: needsDomain ?? null,
        categories: normalized as object[],
        defaultCadenceCount: defaultCadenceCount ?? null,
        defaultCadencePeriod: defaultCadencePeriod ?? null,
        isActive: isActive ?? true,
      },
    });

    // Dual-write: mirror categories into the relational config-graph tables (P2). Non-blocking.
    try {
      await syncCatalogDefs(id, normalized);
    } catch (syncErr) {
      console.error("[admin/catalogs PUT] control-plane dual-write failed:", syncErr);
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[admin/catalogs PUT] failed:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Save failed: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const permanent = new URL(req.url).searchParams.get("permanent") === "true";

  if (permanent) {
    await prisma.catalogTemplateDef.delete({ where: { id } });
  } else {
    await prisma.catalogTemplateDef.update({ where: { id }, data: { isActive: false } });
  }
  return Response.json({ ok: true });
}
