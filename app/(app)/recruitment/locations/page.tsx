import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import LocationsClient from "./LocationsClient";

export const dynamic = "force-dynamic";

export default async function RecruitmentLocationsPage() {
  const session = await auth();
  const ctx = await buildRbacContext(session, { surface: "recruitment.list" });
  if (!(await can(ctx, "recruitment", "read"))) notFound();
  const canEdit = await can(ctx, "recruitment", "update");
  const canCreate = await can(ctx, "recruitment", "create");
  const canDelete = await can(ctx, "recruitment", "delete");

  const rows = await prisma.recruitmentLocation.findMany({
    orderBy: [{ archivedAt: "asc" }, { city: "asc" }],
    include: { _count: { select: { jobs: true } } },
  });
  // Prisma Date -> string for the client component.
  const initial = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    city: r.city,
    state: r.state,
    country: r.country,
    primaryLanguage: r.primaryLanguage,
    localReferenceOrgs: r.localReferenceOrgs,
    localRedFlags: r.localRedFlags,
    mobilityDefault: r.mobilityDefault,
    notes: r.notes,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    jobCount: r._count.jobs,
  }));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/recruitment" className="text-stone-400 hover:text-stone-600">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <MapPin className="w-5 h-5 text-sky-500" />
        <h1 className="text-xl font-semibold text-stone-900">Recruitment locations</h1>
      </div>
      <p className="text-sm text-stone-500 mb-6 leading-relaxed">
        City-level context shared across many JDs — language, salary bands, reference orgs, mobility expectations.
        Five Chennai JDs shouldn&apos;t restate &quot;Tamil-primary, own two-wheeler&quot;.
      </p>
      <LocationsClient initial={initial} canEdit={canEdit} canCreate={canCreate} canDelete={canDelete} />
    </div>
  );
}
