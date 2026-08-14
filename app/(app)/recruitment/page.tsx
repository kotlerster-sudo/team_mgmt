import { readdir, readFile } from "fs/promises";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, MapPin, UserSearch } from "lucide-react";
import { get, list } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import prisma from "@/lib/prisma";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "content", "recruitment");

type DocEntry = {
  slug: string;
  title: string;
  matchday: string | null;
  jobTitle: string | null;
  jobSlug: string | null;
  city: string | null;
  createdAt: number; // unix ms for sorting
  isLegacy: boolean;
};

function parseHtmlDoc(slug: string, html: string, createdAt: number): DocEntry {
  return {
    slug,
    title: html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? slug,
    matchday: html.match(/class="matchday">([^<]*)</)?.[1]?.trim() ?? null,
    jobTitle: null,
    jobSlug: null,
    city: null,
    createdAt,
    isLegacy: true,
  };
}

export default async function RecruitmentPage() {
  const session = await auth();
  const ctx = await buildRbacContext(session, { surface: "recruitment.list" });
  if (!(await can(ctx, "recruitment", "list"))) notFound();

  // 1. DB rows: the source of truth going forward. Each carries its JD chip.
  const dbRows = await prisma.recruitmentScoutingDay.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      slug: true,
      title: true,
      matchday: true,
      createdAt: true,
      job: { select: { slug: true, title: true, location: { select: { city: true } } } },
    },
  });
  const knownSlugs = new Set(dbRows.map((r) => r.slug));
  const docs: DocEntry[] = dbRows.map((r) => ({
    slug: r.slug,
    title: r.title,
    matchday: r.matchday ? r.matchday.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null,
    jobTitle: r.job?.title ?? null,
    jobSlug: r.job?.slug ?? null,
    city: r.job?.location.city ?? null,
    createdAt: +r.createdAt,
    isLegacy: false,
  }));

  // 2. Legacy blob-only docs (generated before Phase 1 landed). Same fs+blob
  // dual-source pattern as before; skip anything already in the DB.
  try {
    const { blobs } = await list({ prefix: "recruitment/docs/" });
    const legacyBlobs = blobs
      .filter((b) => b.pathname.endsWith(".html"))
      .filter((b) => {
        const slug = b.pathname.replace(/^recruitment\/docs\//, "").replace(/\.html$/, "");
        return !knownSlugs.has(slug);
      });
    const legacy = await Promise.all(
      legacyBlobs.map(async (b) => {
        const slug = b.pathname.replace(/^recruitment\/docs\//, "").replace(/\.html$/, "");
        const got = await get(b.url, { access: "private" });
        const html = got?.statusCode === 200 ? await new Response(got.stream).text() : "";
        return parseHtmlDoc(slug, html, +new Date(b.uploadedAt));
      }),
    );
    docs.push(...legacy);
  } catch {
    /* blob store unreachable — DB-only listing still works */
  }
  try {
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".html"));
    const committed = await Promise.all(
      files
        .filter((f) => !knownSlugs.has(f.replace(/\.html$/, "")))
        .map(async (f) => {
          const html = await readFile(path.join(DIR, f), "utf8");
          return parseHtmlDoc(f.replace(/\.html$/, ""), html, 0); // no timestamp on disk — sort last
        }),
    );
    docs.push(...committed);
  } catch {
    /* no committed docs */
  }

  docs.sort((a, b) => b.createdAt - a.createdAt);

  // JDs for the upload picker.
  const jobs = await prisma.recruitmentJob.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, title: true, location: { select: { city: true } } },
  });
  const pickerJobs = jobs.map((j) => ({ id: j.id, slug: j.slug, title: j.title, city: j.location.city }));

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2.5 mb-1">
        <UserSearch className="w-5 h-5 text-sky-500" />
        <h1 className="text-lg font-semibold text-stone-900">Recruitment</h1>
      </div>
      <p className="text-sm text-stone-500 mb-4">Scouting desks for interview days. Scores and notes sync across the team.</p>

      <div className="flex items-center gap-3 mb-6 text-sm">
        <Link href="/recruitment/jobs" className="inline-flex items-center gap-1.5 text-stone-500 hover:text-sky-600">
          <Briefcase className="w-4 h-4" /> Job descriptions
        </Link>
        <span className="text-stone-300">·</span>
        <Link href="/recruitment/locations" className="inline-flex items-center gap-1.5 text-stone-500 hover:text-sky-600">
          <MapPin className="w-4 h-4" /> Locations
        </Link>
      </div>

      <UploadForm jobs={pickerJobs} />

      {docs.length === 0 ? (
        <p className="text-sm text-stone-400">No scouting docs yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <Link
              key={d.slug}
              href={`/recruitment/${d.slug}`}
              className="block rounded-xl border border-stone-200 bg-white px-4 py-3.5 hover:border-sky-300 hover:bg-sky-50/40 transition-colors"
            >
              <p className="text-sm font-medium text-stone-800">{d.title}</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-stone-400">
                {d.matchday && <span>{d.matchday}</span>}
                {d.jobTitle && (
                  <>
                    <span className="text-stone-300">·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Briefcase className="w-3 h-3" /> {d.jobTitle}
                    </span>
                  </>
                )}
                {d.city && (
                  <>
                    <span className="text-stone-300">·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="w-3 h-3" /> {d.city}
                    </span>
                  </>
                )}
                {d.isLegacy && (
                  <>
                    <span className="text-stone-300">·</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">legacy</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
