import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { del, get, list } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";

// Serves scouting-day HTML docs (embedded in an iframe by /recruitment/[slug]):
// hand-committed ones from content/recruitment/, generated ones from the
// private blob store. Candidate PII — RBAC-gated on `recruitment.read`.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { req });
  if (!(await can(ctx, "recruitment", "read"))) return Response.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return Response.json({ error: "Not found" }, { status: 404 });

  const html = await loadDoc(slug);
  if (html === null) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

// DELETE /api/recruitment/[slug]
//   Removes the scouting day everywhere it lives: the DB row (if any), the
//   private-blob HTML (if any), the RecruitmentScoutState team-scoring row
//   (if any). Hand-committed content/recruitment/*.html is NOT deletable via
//   API — those are code-owned and must be removed from the repo.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { req });
  if (!(await can(ctx, "recruitment", "delete"))) return Response.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return Response.json({ error: "Not found" }, { status: 404 });

  // Refuse to delete hand-committed docs — those live in the repo, not blob.
  const committedPath = path.join(process.cwd(), "content", "recruitment", `${slug}.html`);
  try {
    await readFile(committedPath, "utf8");
    return Response.json({ error: "This is a hand-committed doc — remove it from content/recruitment/ in the repo instead." }, { status: 400 });
  } catch {
    /* not committed — proceed */
  }

  // 1. Blob HTML (best-effort — legacy docs may not have a stored URL).
  try {
    const pathname = `recruitment/docs/${slug}.html`;
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    const blob = blobs.find((b) => b.pathname === pathname);
    if (blob) await del(blob.url);
  } catch {
    /* blob store unreachable — DB delete still proceeds */
  }

  // 2. DB row (may not exist for legacy blob-only docs).
  await prisma.recruitmentScoutingDay.deleteMany({ where: { slug } });

  // 3. Team-scoring state — same slug key, safe to delete unconditionally.
  await prisma.recruitmentScoutState.deleteMany({ where: { slug } });

  return Response.json({ ok: true });
}

async function loadDoc(slug: string): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), "content", "recruitment", `${slug}.html`), "utf8");
  } catch {
    /* not a committed doc — try the blob store */
  }
  try {
    const pathname = `recruitment/docs/${slug}.html`;
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    const blob = blobs.find((b) => b.pathname === pathname);
    if (!blob) return null;
    // Private blobs need the store token — a plain fetch of the URL 401s.
    const got = await get(blob.url, { access: "private" });
    return got?.statusCode === 200 ? await new Response(got.stream).text() : null;
  } catch {
    return null;
  }
}
