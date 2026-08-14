import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import { decideMode } from "@/lib/recruitment/decideMode";
import { appendCandidates, regenerateScoutingDay, type CvRef } from "@/lib/recruitment/scoutingDayOps";

// POST /api/recruitment/[slug]/add-cvs
//   body: { cvs: [{ url, name }] }
//
// Single entry point for the recruiter after they've uploaded more CVs. The
// server picks between append and regenerate via `decideMode(poolSize, addCount)`
// — the recruiter does NOT choose (see lib/recruitment/decideMode.ts for the
// rule). The response reports which mode was used so the client can label the
// success + refresh.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { req: request });
  if (!(await can(ctx, "recruitment", "create"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const cvs: CvRef[] = Array.isArray(body?.cvs) ? body.cvs : [];
  if (cvs.length === 0) return NextResponse.json({ error: "At least one CV is required" }, { status: 400 });
  for (const cv of cvs) {
    const u = new URL(cv.url);
    if (!u.hostname.endsWith(".blob.vercel-storage.com") || !u.pathname.includes("recruitment/cv-tmp/")) {
      return NextResponse.json({ error: "Invalid CV reference" }, { status: 400 });
    }
  }

  // Peek at pool size to decide the mode. Missing snapshot => can't dispatch.
  const day = await prisma.recruitmentScoutingDay.findUnique({
    where: { slug },
    select: { snapshotJson: true },
  });
  if (!day) return NextResponse.json({ error: "Scouting day not found (or a legacy blob-only doc that can't be extended)" }, { status: 404 });
  if (!day.snapshotJson) return NextResponse.json({ error: "This scouting day is missing its saved snapshot — extend not supported" }, { status: 400 });
  const existing = day.snapshotJson as unknown as { candidates: unknown[] };
  const poolSize = Array.isArray(existing?.candidates) ? existing.candidates.length : 0;
  const mode = decideMode(poolSize, cvs.length);

  const result = mode === "append"
    ? await appendCandidates(slug, cvs, session)
    : await regenerateScoutingDay(slug, cvs, session);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    slug: result.slug,
    mode: result.mode,
    addedCount: result.addedCount,
    totalCount: result.totalCount,
  });
}
