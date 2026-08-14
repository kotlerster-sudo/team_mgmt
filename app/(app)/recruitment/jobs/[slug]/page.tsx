import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Briefcase, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import JobEditor from "./JobEditor";

export const dynamic = "force-dynamic";

export default async function RecruitmentJobDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  const ctx = await buildRbacContext(session, { surface: "recruitment.list" });
  if (!(await can(ctx, "recruitment", "read"))) notFound();
  const canEdit = await can(ctx, "recruitment", "update");
  const canDelete = await can(ctx, "recruitment", "delete");

  const { slug } = await params;
  const [job, locations] = await Promise.all([
    prisma.recruitmentJob.findUnique({
      where: { slug },
      include: {
        location: true,
        scoutingDays: {
          orderBy: { createdAt: "desc" },
          select: { id: true, slug: true, title: true, matchday: true, createdAt: true },
        },
      },
    }),
    prisma.recruitmentLocation.findMany({
      where: { archivedAt: null },
      orderBy: { city: "asc" },
      select: { id: true, city: true, state: true },
    }),
  ]);
  if (!job) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/recruitment/jobs" className="text-stone-400 hover:text-stone-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <Briefcase className="w-5 h-5 text-sky-500" />
        <h1 className="text-xl font-semibold text-stone-900 truncate">{job.title}</h1>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 inline-flex items-center gap-0.5">
          <MapPin className="w-2.5 h-2.5" /> {job.location.city}
        </span>
        {job.archivedAt && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">archived</span>
        )}
      </div>

      <JobEditor
        initial={{
          id: job.id,
          slug: job.slug,
          title: job.title,
          seniority: job.seniority,
          locationId: job.locationId,
          dayToDay: job.dayToDay,
          mustHaves: job.mustHaves,
          niceToHaves: job.niceToHaves,
          hardDisqualifiers: job.hardDisqualifiers,
          salaryBand: job.salaryBand,
          theme: (job.theme === "neutral" ? "neutral" : "football") as "football" | "neutral",
          notes: job.notes,
          redFlagRules: job.redFlagRules,
          yellowFlagRules: job.yellowFlagRules,
          scrutiniseFor: job.scrutiniseFor,
          lockedAxes: job.lockedAxes,
          archivedAt: job.archivedAt ? job.archivedAt.toISOString() : null,
        }}
        locations={locations}
        canEdit={canEdit}
        canDelete={canDelete}
      />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-stone-700">Scouting days ({job.scoutingDays.length})</h2>
      {job.scoutingDays.length === 0 ? (
        <p className="text-sm text-stone-400 italic">No scouting days have used this JD yet.</p>
      ) : (
        <div className="space-y-2">
          {job.scoutingDays.map((d) => (
            <Link
              key={d.id}
              href={`/recruitment/${d.slug}`}
              className="block bg-white border border-stone-200 rounded-xl px-4 py-3 hover:border-sky-300 hover:bg-sky-50/40"
            >
              <p className="text-sm font-medium text-stone-800">{d.title}</p>
              <p className="text-[11px] text-stone-400 mt-0.5">
                {d.matchday
                  ? new Date(d.matchday).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                  : `Created ${d.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
