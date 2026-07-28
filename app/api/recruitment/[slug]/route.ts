import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

// Serves scouting-day HTML docs from content/recruitment/ (embedded in an
// iframe by /recruitment/[slug]). Candidate PII — super-admin only.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isSuperAdmin(session)) return Response.json({ error: "Not found" }, { status: 404 });

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const file = path.join(process.cwd(), "content", "recruitment", `${slug}.html`);
    const html = await readFile(file, "utf8");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
