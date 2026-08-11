import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { hasLauncher, withLauncher, withoutLauncher } from "@/lib/caregiverPractices";
import { syncCatalogDefs } from "@/lib/controlplane/sync";
import type { CatalogCategory } from "@/lib/catalogDb";

// The Caregiver-Practices subsystem as a bindable target: a catalog is "bound" iff it contains the
// reserved launcher item. GET lists catalogs + bound state; POST/DELETE wire/unwire (add/remove the
// launcher, dual-write relational). RP behaviour unchanged — the visit UI still keys off the item.

export async function GET() {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const catalogs = await prisma.catalogTemplateDef.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, needsDomain: true, categories: true },
    orderBy: { name: "asc" },
  });
  return Response.json(catalogs.map((c) => ({
    catalogId: c.id, slug: c.slug, name: c.name, needsDomain: c.needsDomain,
    bound: hasLauncher((c.categories as unknown as CatalogCategory[]) ?? []),
  })));
}

async function setBinding(catalogId: string, bind: boolean) {
  const c = await prisma.catalogTemplateDef.findUnique({ where: { id: catalogId }, select: { id: true, categories: true } });
  if (!c) return { error: "Catalog not found", status: 404 as const };
  const cats = (c.categories as unknown as CatalogCategory[]) ?? [];
  const next = bind ? withLauncher(cats) : withoutLauncher(cats);
  await prisma.catalogTemplateDef.update({ where: { id: catalogId }, data: { categories: next as object[] } });
  try { await syncCatalogDefs(catalogId, next); } catch (e) { console.error("[caregiver catalog-binding] sync failed:", e); }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { catalogId } = await req.json();
  if (!catalogId) return Response.json({ error: "catalogId required" }, { status: 400 });
  const r = await setBinding(catalogId, true);
  return "error" in r ? Response.json({ error: r.error }, { status: r.status }) : Response.json(r);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { catalogId } = await req.json();
  if (!catalogId) return Response.json({ error: "catalogId required" }, { status: 400 });
  const r = await setBinding(catalogId, false);
  return "error" in r ? Response.json({ error: r.error }, { status: r.status }) : Response.json(r);
}
