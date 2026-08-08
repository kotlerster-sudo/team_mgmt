"use client";

/**
 * Tasks list + the raise-a-task form.
 *
 * Two tabs, because they answer different questions: "Mine" is what I have to
 * do, "Handed out" is what I'm waiting on from others. The second only appears
 * for someone who can assign, and it reads the same rows from the other side
 * via ?assignedByMe=1 — those rows are owned by the assignee, so they never
 * show up under scope=mine.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, ListChecks, Inbox } from "lucide-react";
import { ActionPointCard } from "@/components/action-points/ActionPointCard";
import { MarkAPDoneModal } from "@/components/action-points/MarkAPDoneModal";
import { EditAPModal } from "@/components/action-points/EditAPModal";
import type { ActionPoint } from "@/components/action-points/types";
import { NewTaskModal, type TaskScopeOptions } from "./NewTaskModal";

type Person = { id: string; name: string | null; image: string | null; designation: string | null };

export function TasksClient({
  currentUserId,
  canAssignOthers,
  people,
  clusters,
  cities,
  goals,
}: {
  currentUserId: string;
  canAssignOthers: boolean;
} & TaskScopeOptions & { people: Person[] }) {
  const [tab, setTab] = useState<"mine" | "handed">("mine");
  const [rows, setRows] = useState<ActionPoint[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [doneTarget, setDoneTarget] = useState<ActionPoint | null>(null);
  const [editTarget, setEditTarget] = useState<ActionPoint | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ source: "adhoc", status: showDone ? "done" : "open" });
    if (tab === "handed") params.set("assignedByMe", "1");
    const res = await fetch(`/api/action-points?${params}`);
    setRows(res.ok ? await res.json() : []);
  }, [tab, showDone]);

  useEffect(() => { setRows(null); load(); }, [load]);

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-stone-900">Tasks</h1>
          <Link
            href="/operations"
            className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 mt-1"
          >
            <ArrowLeft className="w-3 h-3" /> Operations
          </Link>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 transition-colors flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Task
        </button>
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-stone-200">
        <div className="flex items-center gap-1">
          <Tab active={tab === "mine"} onClick={() => setTab("mine")} icon={<ListChecks className="w-3.5 h-3.5" />}>
            Mine
          </Tab>
          {canAssignOthers && (
            <Tab active={tab === "handed"} onClick={() => setTab("handed")} icon={<Inbox className="w-3.5 h-3.5" />}>
              Handed out
            </Tab>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-stone-500 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="rounded border-stone-300"
          />
          Show done
        </label>
      </div>

      {rows === null ? (
        <p className="text-sm text-stone-400 py-8 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-400">
          {tab === "handed"
            ? "You haven't handed out any tasks."
            : showDone
              ? "Nothing closed yet."
              : "No open tasks. Anything that doesn't fit a visit belongs here."}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((ap) => (
            <ActionPointCard
              key={ap.id}
              ap={ap}
              currentUserId={currentUserId}
              onChanged={load}
              onOpenComplete={setDoneTarget}
              onOpenEdit={setEditTarget}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewTaskModal
          currentUserId={currentUserId}
          people={canAssignOthers ? people : people.filter((p) => p.id === currentUserId)}
          clusters={clusters}
          cities={cities}
          goals={goals}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
      {doneTarget && (
        <MarkAPDoneModal
          ap={doneTarget}
          onClose={() => setDoneTarget(null)}
          onDone={() => { setDoneTarget(null); load(); }}
        />
      )}
      {editTarget && (
        <EditAPModal
          ap={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function Tab({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-sky-500 text-sky-700"
          : "border-transparent text-stone-500 hover:text-stone-700"
      }`}
    >
      {icon} {children}
    </button>
  );
}
