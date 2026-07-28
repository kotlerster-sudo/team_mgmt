import { stat } from "fs/promises";
import path from "path";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

export const dynamic = "force-dynamic";

export default async function RecruitmentDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isSuperAdmin(session)) notFound();

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  try {
    await stat(path.join(process.cwd(), "content", "recruitment", `${slug}.html`));
  } catch {
    notFound();
  }

  return <iframe src={`/api/recruitment/${slug}`} title="Scouting desk" className="block w-full h-full" />;
}
