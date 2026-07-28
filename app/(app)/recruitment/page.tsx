import { readdir, readFile } from "fs/promises";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserSearch } from "lucide-react";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "content", "recruitment");

export default async function RecruitmentPage() {
  const session = await auth();
  if (!isSuperAdmin(session)) notFound();

  let docs: { slug: string; title: string; matchday: string | null }[] = [];
  try {
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".html")).sort().reverse();
    docs = await Promise.all(
      files.map(async (f) => {
        const html = await readFile(path.join(DIR, f), "utf8");
        return {
          slug: f.replace(/\.html$/, ""),
          title: html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? f,
          matchday: html.match(/class="matchday">([^<]*)</)?.[1]?.trim() ?? null,
        };
      }),
    );
  } catch {
    // no docs yet
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2.5 mb-1">
        <UserSearch className="w-5 h-5 text-sky-500" />
        <h1 className="text-lg font-semibold text-stone-900">Recruitment</h1>
      </div>
      <p className="text-sm text-stone-500 mb-6">Scouting desks for interview days. Scores and notes save on your device.</p>

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
              {d.matchday && <p className="text-xs text-stone-400 mt-0.5">{d.matchday}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
