import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { get, list } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

// Serves scouting-day HTML docs (embedded in an iframe by /recruitment/[slug]):
// hand-committed ones from content/recruitment/, generated ones from the
// private blob store. Candidate PII — super-admin only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isSuperAdmin(session)) return Response.json({ error: "Not found" }, { status: 404 });

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
