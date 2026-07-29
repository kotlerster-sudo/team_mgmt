import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";
import prisma from "@/lib/prisma";

// Shared team state for a scouting doc. GET returns the current blob +
// version + who last touched it (for the "updated by X" chip and poll-based
// merging); PUT upserts the whole blob, stamps the updater, and bumps the
// version. Last-write-wins — good enough for a 2-3 person scouting desk.
// Candidate PII, so both are super-admin gated (mirroring the parent route).

export const runtime = "nodejs";

function slugOk(s: string) {
  return /^[a-z0-9-]+$/.test(s);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isSuperAdmin(session)) return Response.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!slugOk(slug)) return Response.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.recruitmentScoutState.findUnique({
    where: { slug },
    include: { updatedBy: { select: { id: true, name: true, email: true } } },
  });

  if (!row) {
    // First read for this doc — no server state yet. Client will do the
    // localStorage → server one-shot migration and PUT its cached blob.
    return Response.json({ state: {}, version: 0, updatedAt: null, updatedBy: null });
  }

  return Response.json({
    state: row.stateJson,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
      ? { id: row.updatedBy.id, name: row.updatedBy.name ?? row.updatedBy.email }
      : null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isSuperAdmin(session)) return Response.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!slugOk(slug)) return Response.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.state !== "object" || body.state === null) {
    return Response.json({ error: "Bad body — expected { state: object }" }, { status: 400 });
  }
  const state = body.state as Record<string, unknown>;

  const userId = (session as { user?: { id?: string } } | null)?.user?.id ?? null;

  const row = await prisma.recruitmentScoutState.upsert({
    where: { slug },
    // Cast because Prisma Json input types are picky about our
    // Record<string, unknown> shape; the DB just stores it as JSONB.
    create: { slug, stateJson: state as never, version: 1, updatedById: userId },
    update: { stateJson: state as never, version: { increment: 1 }, updatedById: userId },
    include: { updatedBy: { select: { id: true, name: true, email: true } } },
  });

  return Response.json({
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy
      ? { id: row.updatedBy.id, name: row.updatedBy.name ?? row.updatedBy.email }
      : null,
  });
}
