import { stat } from "fs/promises";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { list } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import ScoutingDayActions from "./ScoutingDayActions";

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

async function isCommittedDoc(slug: string): Promise<boolean> {
  try {
    await stat(path.join(process.cwd(), "content", "recruitment", `${slug}.html`));
    return true;
  } catch {
    return false;
  }
}

export default async function RecruitmentDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { surface: "recruitment.doc" });
  if (!(await can(ctx, "recruitment", "read"))) notFound();
  const canAddCvs = await can(ctx, "recruitment", "create");
  const canDelete = await can(ctx, "recruitment", "delete");

  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  if (!(await docExists(slug))) notFound();

  // DB-backed docs can accept new CVs (we have snapshotJson to append to).
  // Legacy blob-only + hand-committed docs cannot — no snapshot to extend.
  const day = await prisma.recruitmentScoutingDay.findUnique({
    where: { slug },
    select: { id: true, title: true, snapshotJson: true },
  });
  const committed = await isCommittedDoc(slug);

  // Pool size drives the append-vs-regenerate rule (server-side); we pass it
  // in so the modal can preview the choice for the user before they submit.
  const snap = day?.snapshotJson as { candidates?: unknown[] } | null | undefined;
  const poolSize = Array.isArray(snap?.candidates) ? snap.candidates.length : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2">
        <Link href="/recruitment" className="text-stone-400 hover:text-stone-600" title="Back to recruitment">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <p className="text-sm font-medium text-stone-800 truncate">{day?.title ?? slug}</p>
        {committed && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">committed</span>
        )}
        {!day && !committed && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">legacy</span>
        )}
        <div className="ml-auto">
          <ScoutingDayActions
            slug={slug}
            poolSize={poolSize}
            canAddCvs={canAddCvs && !!day}
            canDelete={canDelete && !committed}
            addDisabledReason={committed ? "Hand-committed doc" : !day ? "Legacy doc — no snapshot to extend" : ""}
            deleteDisabledReason={committed ? "Remove from content/recruitment/ in the repo instead" : ""}
          />
        </div>
      </header>
      <iframe src={`/api/recruitment/${slug}`} title="Scouting desk" className="block w-full flex-1" />
    </div>
  );
}
