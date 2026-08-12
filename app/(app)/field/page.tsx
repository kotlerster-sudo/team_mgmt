import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { getFieldSession } from "@/lib/field/access";
import { loadClusterSummaries } from "@/lib/field/queries";

export const dynamic = "force-dynamic";

// Screen 1 — the RP's clusters. Tap one to see what's there (live + setting up).
export default async function FieldHomePage() {
  const sess = await getFieldSession();
  if (!sess) redirect("/operations");
  const clusters = await loadClusterSummaries(sess.userId);

  return (
    <div className="max-w-2xl mx-auto px-5 py-6 space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-stone-900">Your clusters</h1>
        <p className="text-sm text-stone-500 mt-0.5">Pick a cluster to see what needs doing.</p>
      </header>

      {clusters.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
          No clusters assigned yet.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {clusters.map((c) => (
            <li key={c.id}>
              <Link
                href={`/field/${c.id}`}
                className="group flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:shadow-sm"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
                  <MapPin size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-stone-900">{c.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
                    {c.live > 0 && <span>{c.live} live</span>}
                    {c.settingUp > 0 && <span>{c.settingUp} setting up</span>}
                    {c.attention > 0 && (
                      <span className="font-medium text-amber-700">{c.attention} need attention</span>
                    )}
                  </span>
                </span>
                <ChevronRight size={18} className="flex-shrink-0 text-stone-300 group-hover:text-stone-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
