import { stat } from "fs/promises";
import path from "path";
import { notFound } from "next/navigation";
import { list } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

export const dynamic = "force-dynamic";

// Mirrors the fs-then-blob lookup in app/api/recruitment/[slug]/route.ts.
// Generated docs only exist in the blob store, never on disk.
async function docExists(slug: string): Promise<boolean> {
  try {
    await stat(path.join(process.cwd(), "content", "recruitment", `${slug}.html`));
    return true;
  } catch {
    /* not a committed doc — try the blob store */
  }
  try {
    const pathname = `recruitment/docs/${slug}.html`;
    const { blobs } = await list({ prefix: pathname, limit: 1 });
    return blobs.some((b) => b.pathname === pathname);
  } catch {
    return false;
  }
}

export default async function RecruitmentDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isSuperAdmin(session)) notFound();

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  if (!(await docExists(slug))) notFound();

  return <iframe src={`/api/recruitment/${slug}`} title="Scouting desk" className="block w-full h-full" />;
}
