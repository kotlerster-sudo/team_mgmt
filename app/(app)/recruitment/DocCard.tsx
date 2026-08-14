"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, MapPin, Trash2 } from "lucide-react";

export type DocCardEntry = {
  slug: string;
  title: string;
  matchday: string | null;
  jobTitle: string | null;
  jobSlug: string | null;
  city: string | null;
  isLegacy: boolean;
  isCommitted: boolean;
};

// One card in the /recruitment index. Whole card links to the scouting doc,
// with a small hover-only Delete button on the right — clicks on it are
// captured so the Link doesn't navigate. `canDelete` gates visibility; the API
// still checks RBAC + refuses to delete hand-committed docs.
export default function DocCard({
  entry,
  canDelete,
}: {
  entry: DocCardEntry;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (entry.isCommitted) {
      alert("Hand-committed docs must be removed from content/recruitment/ in the repo, not from the app.");
      return;
    }
    if (!confirm(`Delete "${entry.title}"? HTML, DB row and team scores/notes will be removed. This cannot be undone.`)) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/recruitment/${entry.slug}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null))?.error) || "Delete failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="group relative">
      <Link
        href={`/recruitment/${entry.slug}`}
        className="block rounded-xl border border-stone-200 bg-white px-4 py-3.5 pr-12 hover:border-sky-300 hover:bg-sky-50/40 transition-colors"
      >
        <p className="text-sm font-medium text-stone-800">{entry.title}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-stone-400">
          {entry.matchday && <span>{entry.matchday}</span>}
          {entry.jobTitle && (
            <>
              <span className="text-stone-300">·</span>
              <span className="inline-flex items-center gap-0.5">
                <Briefcase className="w-3 h-3" /> {entry.jobTitle}
              </span>
            </>
          )}
          {entry.city && (
            <>
              <span className="text-stone-300">·</span>
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="w-3 h-3" /> {entry.city}
              </span>
            </>
          )}
          {entry.isCommitted && (
            <>
              <span className="text-stone-300">·</span>
              <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">committed</span>
            </>
          )}
          {entry.isLegacy && !entry.isCommitted && (
            <>
              <span className="text-stone-300">·</span>
              <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">legacy</span>
            </>
          )}
        </div>
      </Link>
      {canDelete && !entry.isCommitted && (
        <button
          onClick={onDelete}
          disabled={deleting}
          title="Delete this scouting desk"
          className="absolute top-3 right-3 p-1.5 rounded text-stone-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-100"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-red-500 px-1">{error}</p>
      )}
    </div>
  );
}
