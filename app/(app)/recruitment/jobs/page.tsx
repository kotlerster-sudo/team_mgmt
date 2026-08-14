import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Briefcase, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import NewJobButton from "./NewJobButton";

export const dynamic = "force-dynamic";

export default async function RecruitmentJobsPage() {
  const session = await auth();
  const ctx = await buildRbacContext(session, { surface: "recruitment.list" });
  if (!(await can(ctx, "recruitment", "read"))) notFound();
  const canCreate = await can(ctx, "recruitment", "create");

  const [jobs, locations] = await Promise.all([
    prisma.recruitmentJob.findMany({
      orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
      include: {
        location: true,
        _count: { select: { scoutingDays: true } },
      },
    }),
    prisma.recruitmentLocation.findMany({
      where: { archivedAt: null },
      orderBy: { city: "asc" },
      select: { id: true, city: true, state: true },
    }),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/recruitment" className="text-stone-400 hover:text-stone-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <Briefcase className="w-5 h-5 text-sky-500" />
        <h1 className="text-xl font-semibold text-stone-900">Job descriptions</h1>
      </div>
      <p className="text-sm text-stone-500 mb-6 leading-relaxed">
        Saved JDs the scouting-desk generator uses. Each JD is frozen into every scouting day at generation time, so editing a JD later doesn&apos;t rewrite old docs.{" "}
        <Link href="/recruitment/locations" className="text-sky-600 hover:underline">Manage locations →</Link>
      </p>

      {locations.length === 0 && canCreate && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Add at least one <Link href="/recruitment/locations" className="underline">location</Link> before creating a JD.
        </div>
      )}

      <div className="space-y-2 mb-4">
        {jobs.map((j) => (
          <Link
            key={j.id}
            href={`/recruitment/jobs/${j.slug}`}
            className={`block bg-white border border-stone-200 rounded-xl p-3 hover:border-sky-300 hover:bg-sky-50/40 ${j.archivedAt ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-stone-800">{j.title}</span>
                  {j.seniority && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">{j.seniority}</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 inline-flex items-center gap-0.5">
                    <MapPin className="w-2.5 h-2.5" /> {j.location.city}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-50 text-stone-500">{j.theme}</span>
                  {j.archivedAt && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">archived</span>
                  )}
                </div>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  {j._count.scoutingDays} scouting day{j._count.scoutingDays === 1 ? "" : "s"}
                  {" · "}updated {j.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            </div>
          </Link>
        ))}
        {jobs.length === 0 && (
          <p className="text-sm text-stone-400 italic text-center py-8">No JDs yet.</p>
        )}
      </div>

      {canCreate && locations.length > 0 && (
        <NewJobButton locations={locations} />
      )}
    </div>
  );
}
