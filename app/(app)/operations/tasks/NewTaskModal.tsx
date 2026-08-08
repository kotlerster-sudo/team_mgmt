"use client";

/**
 * Raise a task. Everything except title and due date is optional — a task that
 * names nothing is still a valid task, which is the whole point of the feature.
 *
 * "Where" is one flat select rather than a cascade: the levels are alternatives,
 * not a hierarchy to walk. Picking a centre sets goalId; a cluster or city sets
 * the matching needs* field. The API validates whichever id comes back.
 */

import { useState } from "react";
import { X } from "lucide-react";
import type { APPriority } from "@/components/action-points/types";

type Person = { id: string; name: string | null; image: string | null; designation: string | null };

export type TaskScopeOptions = {
  clusters: { id: string; name: string }[];
  cities: { id: string; name: string }[];
  goals: { id: string; title: string; mode: string }[];
};

function defaultDueYmd(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function NewTaskModal({
  currentUserId,
  people,
  clusters,
  cities,
  goals,
  onClose,
  onCreated,
}: TaskScopeOptions & {
  currentUserId: string;
  people: Person[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueYmd, setDueYmd] = useState(defaultDueYmd());
  const [priority, setPriority] = useState<APPriority>("routine");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  // "goal:<id>" | "cluster:<id>" | "city:<id>" | "" — one token so the select
  // stays a single control across three different columns.
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !dueYmd) return;
    setBusy(true);
    setErr(null);

    const [kind, id] = place.split(":");
    const res = await fetch("/api/action-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        detail: detail.trim() || null,
        dueDate: new Date(`${dueYmd}T12:00:00`).toISOString(),
        priority,
        assigneeId,
        goalId:         kind === "goal"    ? id : null,
        needsClusterId: kind === "cluster" ? id : null,
        needsCityId:    kind === "city"    ? id : null,
      }),
    });

    setBusy(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({})))?.error ?? "Could not create the task");
      return;
    }
    onCreated();
  }

  const assigningToOther = assigneeId !== currentUserId;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 sticky top-0 bg-white">
          <h2 className="text-sm font-semibold text-stone-900">New task</h2>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="What needs doing">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chase BBMP on the water connection"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
            />
          </Field>

          <Field label="Detail" optional>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm resize-none focus:outline-none focus:border-sky-400"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due">
              <input
                type="date"
                value={dueYmd}
                onChange={(e) => setDueYmd(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
              />
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as APPriority)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-sky-400"
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
          </div>

          {people.length > 1 && (
            <Field label="Who">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-sky-400"
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === currentUserId ? "Myself" : `${p.name ?? "—"}${p.designation ? ` · ${p.designation}` : ""}`}
                  </option>
                ))}
              </select>
              {assigningToOther && (
                <p className="text-[11px] text-stone-400 mt-1">
                  They can close it but not change it — edit and cancel stay with you.
                </p>
              )}
            </Field>
          )}

          <Field label="Where" optional>
            <select
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm bg-white focus:outline-none focus:border-sky-400"
            >
              <option value="">Nothing in particular</option>
              {goals.length > 0 && (
                <optgroup label="Centre">
                  {goals.map((g) => (
                    <option key={g.id} value={`goal:${g.id}`}>
                      {g.title}{g.mode === "setup" ? " · setting up" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {clusters.length > 0 && (
                <optgroup label="Cluster">
                  {clusters.map((c) => (
                    <option key={c.id} value={`cluster:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
              )}
              {cities.length > 0 && (
                <optgroup label="City">
                  {cities.map((c) => (
                    <option key={c.id} value={`city:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <div className="px-5 py-3.5 border-t border-stone-200 flex items-center justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-xs px-3 py-2 text-stone-600 hover:bg-stone-100 rounded-lg font-medium">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !title.trim() || !dueYmd}
            className="text-xs px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-medium transition-colors"
          >
            {busy ? "Saving…" : assigningToOther ? "Assign" : "Add task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
        {label}
        {optional && <span className="ml-1 font-normal normal-case tracking-normal text-stone-400">optional</span>}
      </label>
      {children}
    </div>
  );
}
