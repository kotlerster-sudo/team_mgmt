"use client";

// One query thread against a budget line. The lead raises a query off the review
// diff, the grantee answers it inline on the line, and the lead closes it out —
// so the same component renders on both sides, with the capability flags
// deciding who may post and who may resolve.

import { useState, useTransition } from "react";
import { addBudgetLineNote, setBudgetLineNoteResolved, type DraftNote } from "../../partner-draft-actions";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

export function openQueryCount(notes: DraftNote[]): number {
  return notes.filter(n => !n.resolvedAt).length;
}

export default function LineNoteThread({
  budgetId, budgetLineId, notes, canComment, canResolve, placeholder,
}: {
  budgetId: string;
  budgetLineId: string;
  notes: DraftNote[];
  canComment: boolean;
  canResolve: boolean;
  placeholder?: string;
}) {
  // Seeded from the server payload, then advanced locally: the action revalidates
  // both routes, but the poster shouldn't wait for a round-trip to see their own
  // words.
  const [items, setItems] = useState<DraftNote[]>(notes);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      try { await fn(); setError(null); }
      catch (e) { setError(e instanceof Error ? e.message : "That didn't post."); }
    });

  const post = () =>
    run(async () => {
      const note = await addBudgetLineNote(budgetId, budgetLineId, body);
      setItems(p => [...p, note]);
      setBody("");
    });

  const toggleResolved = (note: DraftNote) =>
    run(async () => {
      const updated = await setBudgetLineNoteResolved(note.id, !note.resolvedAt);
      setItems(p => p.map(n => n.id === updated.id ? updated : n));
    });

  return (
    <div className="space-y-2">
      {items.map(n => (
        <div key={n.id} className={`text-xs rounded-lg px-3 py-2 ${n.resolvedAt ? "bg-stone-100 text-stone-400" : "bg-white border border-stone-200"}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-stone-600">{n.authorName}</span>
            <span className="text-stone-400">{day(n.createdAt)}</span>
            {n.resolvedAt && <span className="text-emerald-600">resolved</span>}
            {canResolve && (
              <button disabled={saving} onClick={() => toggleResolved(n)}
                className="text-stone-400 hover:text-stone-700 ml-auto">
                {n.resolvedAt ? "Reopen" : "Mark resolved"}
              </button>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-stone-700">{n.body}</p>
        </div>
      ))}

      {canComment && (
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={2}
            placeholder={placeholder ?? (items.length ? "Reply…" : "What needs correcting on this line?")}
            className="flex-1 text-xs border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400" />
          <button disabled={saving || !body.trim()} onClick={post}
            className="self-start bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50">
            {saving ? "Posting…" : "Post"}
          </button>
        </div>
      )}

      {!canComment && items.length === 0 && <p className="text-xs text-stone-400">No queries on this line.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
