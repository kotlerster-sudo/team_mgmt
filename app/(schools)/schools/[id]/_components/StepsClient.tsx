"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import {
  setStepStatus, setStepOwner, setStepDueDate, setStepOwnerRole, setStepDueWeek,
  addSubstep, updateSubstep, setSubstepStatus, deleteSubstep,
  setSubstepOwnerRole, setSubstepDueWeek, setSubstepDueDate,
  addCategory, renameCategory, deleteCategory,
  addStep, updateStep, deleteStep,
} from "../../actions";
import { StepChip } from "../../_shared";
import { weekLabel } from "@/lib/seeding/weeks";
import type { SchoolPlanStepStatusValue } from "@/lib/schoolPlan/types";

type Substep = {
  id: string;
  title: string;
  description: string | null;
  status: SchoolPlanStepStatusValue;
  ownerUserId: string | null;
  ownerLabel: string | null;
  ownerRole: string | null;
  dueDate: string | null;
  dueWeek: number | null;
  blockingNote: string | null;
};

type Step = {
  id: string;
  stepNo: number;
  categoryId: string | null;
  title: string;
  description: string | null;
  planSection: string | null;
  requiredArtifactType: string | null;
  status: SchoolPlanStepStatusValue;
  ownerUserId: string | null;
  ownerLabel: string | null;
  ownerRole: string | null;
  dueDate: string | null;
  dueWeek: number | null;
  blockingNote: string | null;
  substeps: Substep[];
};

type Category = {
  id: string;
  key: string | null;
  title: string;
  description: string | null;
  sortOrder: number;
};

type UserOpt = { id: string; label: string };
type RoleOpt = { key: string; label: string };

// Special bucket id for steps whose category was deleted (categoryId = null).
const UNCATEGORISED_ID = "__uncategorised__";

// ── header rollup helpers ────────────────────────────────────────────────────

function ownerUnionLabel(
  subs: Substep[],
  stepOwnerLabel: string | null,
  stepOwnerRole: string | null,
  roleByKey: Map<string, string>,
): string {
  if (subs.length === 0) {
    const names = [stepOwnerLabel, stepOwnerRole ? roleByKey.get(stepOwnerRole) ?? null : null]
      .filter((n): n is string => !!n);
    return names.length ? names.join(" / ") : "—";
  }
  const names = new Set<string>();
  for (const s of subs) {
    if (s.ownerLabel) names.add(s.ownerLabel);
    if (s.ownerRole) names.add(roleByKey.get(s.ownerRole) ?? s.ownerRole);
  }
  const arr = [...names];
  if (arr.length === 0) return "—";
  if (arr.length === 1) return arr[0];
  return `${arr[0]} +${arr.length - 1}`;
}

/** Header due label: earliest across substeps if any, otherwise the step's own.
 *  Prefers weekLabel when the row is week-tagged + launchDate is set. */
function earliestDueLabel(
  subs: Substep[],
  step: Step,
  launchDate: Date | null,
): string {
  const rows = subs.length ? subs : [step];
  const withDate = rows
    .filter(r => r.dueDate || r.dueWeek !== null)
    .map(r => ({
      dueDate: r.dueDate,
      dueWeek: r.dueWeek,
      // Sort key: derived date (from dueWeek + launchDate) OR absolute dueDate.
      key:
        r.dueWeek !== null && launchDate
          ? new Date(launchDate.getTime() + r.dueWeek * 7 * 86400000).toISOString()
          : r.dueDate ?? "",
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (withDate.length === 0) return "—";
  const first = withDate[0];
  if (first.dueWeek !== null && launchDate) return weekLabel(launchDate, first.dueWeek);
  return first.dueDate?.slice(0, 10) ?? "—";
}

// ── component ────────────────────────────────────────────────────────────────

export default function StepsClient({
  planId,
  launchDate: launchDateIso,
  categories,
  steps,
  users,
  roles,
  canEdit,
}: {
  planId: string;
  launchDate: string | null;
  categories: Category[];
  steps: Step[];
  users: UserOpt[];
  roles: RoleOpt[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [blockingOpen, setBlockingOpen] = useState<{ kind: "step" | "substep"; id: string } | null>(null);
  const [blockingText, setBlockingText] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    new Set(steps.filter(s => s.substeps.length > 0).map(s => s.id)),
  );
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSubTitle, setNewSubTitle] = useState("");
  const [addingStepFor, setAddingStepFor] = useState<string | null>(null);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraftTitle, setStepDraftTitle] = useState("");
  const [stepDraftDesc, setStepDraftDesc] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(() => new Set());

  const launchDate = launchDateIso ? new Date(launchDateIso) : null;
  const weeksEnabled = !!launchDate;
  const roleByKey = new Map(roles.map(r => [r.key, r.label]));

  // Bucket steps by category, preserving DB order (steps are already sorted by
  // (sortOrder, stepNo) in the server query). Steps whose categoryId no longer
  // matches a live category (e.g. category was deleted, SetNull kicked in) land
  // in the Uncategorised bucket so nothing disappears from the UI.
  const catIds = useMemo(() => new Set(categories.map(c => c.id)), [categories]);
  const stepsByCategory = useMemo(() => {
    const m = new Map<string, Step[]>();
    for (const c of categories) m.set(c.id, []);
    m.set(UNCATEGORISED_ID, []);
    for (const s of steps) {
      const bucket = s.categoryId && catIds.has(s.categoryId) ? s.categoryId : UNCATEGORISED_ID;
      m.get(bucket)!.push(s);
    }
    return m;
  }, [categories, steps, catIds]);

  const displayCategories = useMemo(() => {
    const list: Category[] = [...categories];
    if ((stepsByCategory.get(UNCATEGORISED_ID)?.length ?? 0) > 0) {
      list.push({
        id: UNCATEGORISED_ID,
        key: null,
        title: "Uncategorised",
        description: "Steps whose category was deleted. Move each into a category.",
        sortOrder: 999,
      });
    }
    return list;
  }, [categories, stepsByCategory]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleCat = (id: string) => setCollapsedCats(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submitAddCategory = () => {
    const title = newCategoryTitle.trim();
    if (!title) return;
    startTransition(async () => {
      await addCategory(planId, { title });
      setNewCategoryTitle("");
      setAddingCategory(false);
    });
  };

  const submitRenameCategory = (categoryId: string) => {
    const title = categoryDraft.trim();
    if (!title) return;
    startTransition(async () => {
      await renameCategory(categoryId, { title });
      setEditingCategoryId(null);
      setCategoryDraft("");
    });
  };

  const submitAddStep = (categoryId: string) => {
    const title = newStepTitle.trim();
    if (!title) return;
    startTransition(async () => {
      await addStep(planId, { categoryId, title });
      setNewStepTitle("");
      setAddingStepFor(null);
    });
  };

  const submitRenameStep = (stepId: string) => {
    const title = stepDraftTitle.trim();
    if (!title) return;
    startTransition(async () => {
      await updateStep(stepId, { title, description: stepDraftDesc });
      setEditingStepId(null);
      setStepDraftTitle("");
      setStepDraftDesc("");
    });
  };

  return (
    <div className="space-y-4">
      {displayCategories.map((cat) => {
        const isUncat = cat.id === UNCATEGORISED_ID;
        const catSteps = stepsByCategory.get(cat.id) ?? [];
        const isCollapsed = collapsedCats.has(cat.id);
        const isEditingCat = editingCategoryId === cat.id;
        return (
          <section key={cat.id} className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <header className="flex items-start justify-between gap-3 px-4 py-3 bg-stone-50 border-b border-stone-100">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => toggleCat(cat.id)}
                  aria-label={isCollapsed ? "Expand category" : "Collapse category"}
                  className="text-stone-400 hover:text-stone-700 mt-0.5"
                >{isCollapsed ? "▸" : "▾"}</button>
                <div className="min-w-0 flex-1">
                  {isEditingCat ? (
                    <form
                      className="flex gap-2 items-center"
                      onSubmit={(e) => { e.preventDefault(); submitRenameCategory(cat.id); }}
                    >
                      <input
                        autoFocus
                        value={categoryDraft}
                        onChange={(e) => setCategoryDraft(e.target.value)}
                        className="text-sm font-semibold text-stone-800 rounded border border-stone-300 px-2 py-1 flex-1"
                        disabled={pending}
                      />
                      <button type="submit" disabled={pending || !categoryDraft.trim()}
                        className="text-[11px] px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
                        Save
                      </button>
                      <button type="button" onClick={() => { setEditingCategoryId(null); setCategoryDraft(""); }}
                        className="text-[11px] px-2 py-1 text-stone-500 hover:text-stone-800">Cancel</button>
                    </form>
                  ) : (
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h2 className="text-sm font-semibold text-stone-800">{cat.title}</h2>
                      <span className="text-[10px] text-stone-400">
                        {catSteps.length} step{catSteps.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  )}
                  {!isEditingCat && cat.description && (
                    <p className="text-[11px] text-stone-500 mt-0.5">{cat.description}</p>
                  )}
                </div>
              </div>
              {canEdit && !isUncat && !isEditingCat && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="text-[11px] text-stone-500 hover:text-stone-800 px-1.5 py-0.5"
                    onClick={() => { setEditingCategoryId(cat.id); setCategoryDraft(cat.title); }}
                    disabled={pending}
                    title="Rename category"
                  >Rename</button>
                  <button
                    type="button"
                    className="text-[11px] text-stone-400 hover:text-rose-600 px-1.5 py-0.5 disabled:opacity-50"
                    onClick={() => {
                      if (catSteps.length > 0) {
                        alert("Move or delete this category's steps first.");
                        return;
                      }
                      if (!confirm(`Delete category "${cat.title}"?`)) return;
                      startTransition(() => { void deleteCategory(cat.id); });
                    }}
                    disabled={pending || catSteps.length > 0}
                    title={catSteps.length > 0 ? "Move or delete the category's steps first" : "Delete category"}
                  >Delete</button>
                </div>
              )}
            </header>

            {!isCollapsed && (
              <>
                {catSteps.length === 0 ? (
                  <div className="px-4 py-3 text-[11px] text-stone-400 italic">
                    No steps in this category.
                    {canEdit && !isUncat && ` Add one below.`}
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-white text-stone-500 text-[10px] uppercase tracking-widest border-b border-stone-100">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium w-6"></th>
                        <th className="text-left px-3 py-2 font-medium">#</th>
                        <th className="text-left px-3 py-2 font-medium">Step</th>
                        <th className="text-left px-3 py-2 font-medium">Owner</th>
                        <th className="text-left px-3 py-2 font-medium">Due</th>
                        <th className="text-left px-3 py-2 font-medium">Status</th>
                        {canEdit && <th className="px-2 py-2 w-6"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {catSteps.map((s) => {
                        const hasSubs = s.substeps.length > 0;
                        const isOpen = expanded.has(s.id);
                        const isEditingStep = editingStepId === s.id;
                        return (
                          <Fragment key={s.id}>
                            <tr className="border-t border-stone-100 align-top">
                              <td className="px-2 py-2 text-stone-400">
                                <button
                                  type="button"
                                  onClick={() => toggle(s.id)}
                                  aria-label={isOpen ? "Collapse substeps" : "Expand substeps"}
                                  className="hover:text-stone-700"
                                >{isOpen ? "▾" : "▸"}</button>
                              </td>
                              <td className="px-3 py-2 text-stone-500 whitespace-nowrap">
                                {s.stepNo}
                                {s.planSection && <span className="ml-1 text-[9px] text-stone-400">§{s.planSection}</span>}
                              </td>
                              <td className="px-3 py-2">
                                {isEditingStep ? (
                                  <form
                                    onSubmit={(e) => { e.preventDefault(); submitRenameStep(s.id); }}
                                    className="space-y-1"
                                  >
                                    <input
                                      autoFocus
                                      value={stepDraftTitle}
                                      onChange={(e) => setStepDraftTitle(e.target.value)}
                                      className="w-full text-xs font-medium text-stone-800 rounded border border-stone-300 px-2 py-1"
                                      disabled={pending}
                                    />
                                    <textarea
                                      value={stepDraftDesc}
                                      onChange={(e) => setStepDraftDesc(e.target.value)}
                                      className="w-full text-[11px] rounded border border-stone-200 px-2 py-1"
                                      rows={2}
                                      placeholder="Description (optional)"
                                      disabled={pending}
                                    />
                                    <div className="flex gap-2 text-[11px]">
                                      <button type="submit" disabled={pending || !stepDraftTitle.trim()}
                                        className="px-2 py-0.5 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">Save</button>
                                      <button type="button"
                                        onClick={() => { setEditingStepId(null); setStepDraftTitle(""); setStepDraftDesc(""); }}
                                        className="text-stone-500 hover:text-stone-800">Cancel</button>
                                    </div>
                                    {canEdit && !isUncat && categories.length > 1 && (
                                      <div className="text-[10px] text-stone-500 pt-1">
                                        Move to:{" "}
                                        <select
                                          className="rounded border border-stone-200 px-1 py-0.5"
                                          defaultValue={s.categoryId ?? ""}
                                          onChange={(e) => {
                                            const targetId = e.target.value;
                                            if (targetId && targetId !== s.categoryId) {
                                              startTransition(() => { void updateStep(s.id, { categoryId: targetId }); });
                                              setEditingStepId(null);
                                            }
                                          }}
                                          disabled={pending}
                                        >
                                          {categories.map((c) => (
                                            <option key={c.id} value={c.id}>{c.title}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </form>
                                ) : (
                                  <>
                                    <div className="font-medium text-stone-800">
                                      {s.title}
                                      {hasSubs && <span className="ml-2 text-[10px] text-stone-400 font-normal">· {s.substeps.length} substep{s.substeps.length === 1 ? "" : "s"} (rolled up)</span>}
                                    </div>
                                    {s.description && <div className="text-[11px] text-stone-500 mt-0.5">{s.description}</div>}
                                    {s.requiredArtifactType && (
                                      <div className="text-[10px] text-stone-400 mt-0.5">requires artefact · {s.requiredArtifactType}</div>
                                    )}
                                    {s.blockingNote && !hasSubs && (
                                      <div className="text-[11px] text-rose-700 mt-1 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                                        ⚠ {s.blockingNote}
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {hasSubs ? (
                                  <span className="text-stone-500" title="Rolled up from substeps">
                                    {ownerUnionLabel(s.substeps, s.ownerLabel, s.ownerRole, roleByKey)}
                                  </span>
                                ) : canEdit ? (
                                  <div className="flex flex-col gap-1">
                                    <select
                                      className="text-[11px] rounded-lg border border-stone-200 bg-white px-2 py-1"
                                      value={s.ownerUserId ?? ""}
                                      onChange={(e) => startTransition(() => { void setStepOwner(s.id, e.target.value || null); })}
                                      disabled={pending}
                                    >
                                      <option value="">— person —</option>
                                      {users.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
                                    </select>
                                    <select
                                      className="text-[11px] rounded-lg border border-stone-200 bg-white px-2 py-1"
                                      value={s.ownerRole ?? ""}
                                      onChange={(e) => startTransition(() => { void setStepOwnerRole(s.id, e.target.value || null); })}
                                      disabled={pending}
                                    >
                                      <option value="">— role —</option>
                                      {roles.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
                                    </select>
                                  </div>
                                ) : (
                                  <div className="flex flex-col text-stone-500">
                                    <span>{s.ownerLabel ?? "—"}</span>
                                    {s.ownerRole && <span className="text-[10px] text-stone-400">{roleByKey.get(s.ownerRole) ?? s.ownerRole}</span>}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {hasSubs ? (
                                  <span className="text-stone-500" title="Earliest substep due">
                                    {earliestDueLabel(s.substeps, s, launchDate)}
                                  </span>
                                ) : canEdit ? (
                                  <DueEditor
                                    weeksEnabled={weeksEnabled}
                                    launchDate={launchDate}
                                    dueDate={s.dueDate}
                                    dueWeek={s.dueWeek}
                                    pending={pending}
                                    onDate={(iso) => startTransition(() => { void setStepDueDate(s.id, iso); })}
                                    onWeek={(w) => startTransition(() => { void setStepDueWeek(s.id, w); })}
                                  />
                                ) : (
                                  <span className="text-stone-500">
                                    {s.dueWeek !== null && launchDate ? weekLabel(launchDate, s.dueWeek)
                                      : s.dueDate ? s.dueDate.slice(0, 10) : "—"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <StepChip status={s.status} />
                                  {canEdit && !hasSubs && (
                                    <select
                                      className="text-[11px] rounded-lg border border-stone-200 bg-white px-2 py-1"
                                      value={s.status}
                                      onChange={(e) => {
                                        const next = e.target.value as SchoolPlanStepStatusValue;
                                        if (next === "blocked") {
                                          setBlockingOpen({ kind: "step", id: s.id });
                                          setBlockingText(s.blockingNote ?? "");
                                          return;
                                        }
                                        startTransition(() => { void setStepStatus(s.id, next); });
                                      }}
                                      disabled={pending}
                                    >
                                      <option value="pending">Pending</option>
                                      <option value="in_progress">In progress</option>
                                      <option value="done">Done</option>
                                      <option value="blocked">Blocked…</option>
                                      <option value="not_applicable">N/A</option>
                                    </select>
                                  )}
                                  {hasSubs && <span className="text-[10px] text-stone-400">rolled up</span>}
                                </div>
                                {blockingOpen?.kind === "step" && blockingOpen.id === s.id && (
                                  <BlockingEditor
                                    text={blockingText} setText={setBlockingText}
                                    onSave={() => startTransition(() => {
                                      void setStepStatus(s.id, "blocked", blockingText).then(() => setBlockingOpen(null));
                                    })}
                                    onCancel={() => setBlockingOpen(null)}
                                  />
                                )}
                              </td>
                              {canEdit && (
                                <td className="px-2 py-2 whitespace-nowrap text-right">
                                  <button
                                    type="button"
                                    className="text-stone-400 hover:text-stone-700 text-[11px] px-1"
                                    onClick={() => {
                                      setEditingStepId(s.id);
                                      setStepDraftTitle(s.title);
                                      setStepDraftDesc(s.description ?? "");
                                    }}
                                    disabled={pending}
                                    title="Edit step"
                                  >✎</button>
                                  <button
                                    type="button"
                                    className="text-stone-400 hover:text-rose-600 text-[11px] px-1"
                                    onClick={() => {
                                      if (!confirm(`Delete step "${s.title}"?\nAll substeps will be deleted too.`)) return;
                                      startTransition(() => { void deleteStep(s.id); });
                                    }}
                                    disabled={pending}
                                    title="Delete step"
                                  >✕</button>
                                </td>
                              )}
                            </tr>

                            {isOpen && (
                              <tr className="bg-stone-50/50">
                                <td colSpan={canEdit ? 7 : 6} className="px-3 py-3">
                                  <SubstepsPanel
                                    step={s}
                                    users={users}
                                    roles={roles}
                                    roleByKey={roleByKey}
                                    canEdit={canEdit}
                                    weeksEnabled={weeksEnabled}
                                    launchDate={launchDate}
                                    pending={pending}
                                    startTransition={startTransition}
                                    blockingOpen={blockingOpen}
                                    setBlockingOpen={setBlockingOpen}
                                    blockingText={blockingText}
                                    setBlockingText={setBlockingText}
                                    addingFor={addingSubFor}
                                    setAddingFor={setAddingSubFor}
                                    newTitle={newSubTitle}
                                    setNewTitle={setNewSubTitle}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {canEdit && !isUncat && (
                  <div className="border-t border-stone-100 px-4 py-2">
                    {addingStepFor === cat.id ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => { e.preventDefault(); submitAddStep(cat.id); }}
                      >
                        <input
                          autoFocus
                          value={newStepTitle}
                          onChange={(e) => setNewStepTitle(e.target.value)}
                          placeholder="Step title"
                          className="flex-1 text-xs rounded border border-stone-200 px-2 py-1"
                          disabled={pending}
                        />
                        <button type="submit" disabled={pending || !newStepTitle.trim()}
                          className="text-[11px] px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">Add</button>
                        <button type="button"
                          onClick={() => { setAddingStepFor(null); setNewStepTitle(""); }}
                          className="text-[11px] px-2 py-1 text-stone-500 hover:text-stone-800">Cancel</button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingStepFor(cat.id)}
                        className="text-[11px] text-sky-700 hover:text-sky-800"
                        disabled={pending}
                      >
                        + Add step to {cat.title}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      {canEdit && (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 px-4 py-3">
          {addingCategory ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); submitAddCategory(); }}
            >
              <input
                autoFocus
                value={newCategoryTitle}
                onChange={(e) => setNewCategoryTitle(e.target.value)}
                placeholder="Category title"
                className="flex-1 text-sm rounded border border-stone-300 px-2 py-1"
                disabled={pending}
              />
              <button type="submit" disabled={pending || !newCategoryTitle.trim()}
                className="text-xs px-3 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">Add</button>
              <button type="button"
                onClick={() => { setAddingCategory(false); setNewCategoryTitle(""); }}
                className="text-xs px-3 py-1 text-stone-500 hover:text-stone-800">Cancel</button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCategory(true)}
              className="text-xs text-sky-700 hover:text-sky-800"
              disabled={pending}
            >
              + Add category
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

function DueEditor({
  weeksEnabled, launchDate, dueDate, dueWeek, pending, onDate, onWeek, compact,
}: {
  weeksEnabled: boolean;
  launchDate: Date | null;
  dueDate: string | null;
  dueWeek: number | null;
  pending: boolean;
  onDate: (iso: string | null) => void;
  onWeek: (week: number | null) => void;
  compact?: boolean;
}) {
  const inputSize = compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-1";
  const showWeekPreview = weeksEnabled && dueWeek !== null && launchDate;
  return (
    <div className="flex flex-col gap-1">
      <input
        type="date"
        className={`${inputSize} rounded-lg border border-stone-200 bg-white`}
        defaultValue={dueDate ? dueDate.slice(0, 10) : ""}
        onBlur={(e) => onDate(e.target.value || null)}
        disabled={pending}
        title={dueWeek !== null ? "Editing the date clears the week intent." : undefined}
      />
      {weeksEnabled && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-stone-400">W</span>
          <input
            type="number"
            className={`${inputSize} w-14 rounded-lg border border-stone-200 bg-white`}
            defaultValue={dueWeek ?? ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              onWeek(raw === "" ? null : parseInt(raw, 10));
            }}
            disabled={pending}
          />
          {showWeekPreview && <span className="text-[9px] text-stone-400">{weekLabel(launchDate!, dueWeek!)}</span>}
        </div>
      )}
    </div>
  );
}

function BlockingEditor({ text, setText, onSave, onCancel }: {
  text: string;
  setText: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 space-y-1">
      <textarea
        className="w-full text-[11px] rounded border border-stone-200 px-2 py-1"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's blocking?"
      />
      <div className="flex gap-2 text-[11px]">
        <button className="px-2 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-700" onClick={onSave}>Save block</button>
        <button className="px-2 py-0.5 text-stone-500 hover:text-stone-800" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── substeps panel ───────────────────────────────────────────────────────────

function SubstepsPanel({
  step, users, roles, roleByKey, canEdit, weeksEnabled, launchDate,
  pending, startTransition,
  blockingOpen, setBlockingOpen, blockingText, setBlockingText,
  addingFor, setAddingFor, newTitle, setNewTitle,
}: {
  step: Step;
  users: UserOpt[];
  roles: RoleOpt[];
  roleByKey: Map<string, string>;
  canEdit: boolean;
  weeksEnabled: boolean;
  launchDate: Date | null;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  blockingOpen: { kind: "step" | "substep"; id: string } | null;
  setBlockingOpen: (v: { kind: "step" | "substep"; id: string } | null) => void;
  blockingText: string;
  setBlockingText: (v: string) => void;
  addingFor: string | null;
  setAddingFor: (v: string | null) => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
}) {
  const isAdding = addingFor === step.id;
  const empty = step.substeps.length === 0;
  const submitAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      await addSubstep(step.id, { title });
      setNewTitle("");
      setAddingFor(null);
    });
  };

  return (
    <div className="ml-8 rounded-xl border border-stone-200 bg-white">
      {empty ? (
        <div className="px-3 py-2 text-[11px] text-stone-400 italic">
          No substeps yet.{canEdit && " Add one below to break this step down (parent status will then roll up)."}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-stone-50 text-stone-500 text-[9px] uppercase tracking-widest">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Substep</th>
              <th className="text-left px-3 py-1.5 font-medium">Owner</th>
              <th className="text-left px-3 py-1.5 font-medium">Due</th>
              <th className="text-left px-3 py-1.5 font-medium">Status</th>
              {canEdit && <th className="px-2 py-1.5 w-6"></th>}
            </tr>
          </thead>
          <tbody>
            {step.substeps.map((ss) => (
              <tr key={ss.id} id={`substep-${ss.id}`} className="border-t border-stone-100 align-top">
                <td className="px-3 py-1.5">
                  <div className="font-medium text-stone-800">{ss.title}</div>
                  {ss.description && <div className="text-[10px] text-stone-500 mt-0.5">{ss.description}</div>}
                  {ss.blockingNote && (
                    <div className="text-[10px] text-rose-700 mt-1 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                      ⚠ {ss.blockingNote}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {canEdit ? (
                    <div className="flex flex-col gap-1">
                      <select
                        className="text-[10px] rounded border border-stone-200 bg-white px-1.5 py-0.5"
                        value={ss.ownerUserId ?? ""}
                        onChange={(e) => startTransition(() => { void updateSubstep(ss.id, { ownerUserId: e.target.value || null }); })}
                        disabled={pending}
                      >
                        <option value="">— person —</option>
                        {users.map((u) => (<option key={u.id} value={u.id}>{u.label}</option>))}
                      </select>
                      <select
                        className="text-[10px] rounded border border-stone-200 bg-white px-1.5 py-0.5"
                        value={ss.ownerRole ?? ""}
                        onChange={(e) => startTransition(() => { void setSubstepOwnerRole(ss.id, e.target.value || null); })}
                        disabled={pending}
                      >
                        <option value="">— role —</option>
                        {roles.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
                      </select>
                    </div>
                  ) : (
                    <div className="flex flex-col text-stone-500">
                      <span>{ss.ownerLabel ?? "—"}</span>
                      {ss.ownerRole && <span className="text-[9px] text-stone-400">{roleByKey.get(ss.ownerRole) ?? ss.ownerRole}</span>}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {canEdit ? (
                    <DueEditor
                      weeksEnabled={weeksEnabled}
                      launchDate={launchDate}
                      dueDate={ss.dueDate}
                      dueWeek={ss.dueWeek}
                      pending={pending}
                      onDate={(iso) => startTransition(() => { void setSubstepDueDate(ss.id, iso); })}
                      onWeek={(w) => startTransition(() => { void setSubstepDueWeek(ss.id, w); })}
                      compact
                    />
                  ) : (
                    <span className="text-stone-500">
                      {ss.dueWeek !== null && launchDate ? weekLabel(launchDate, ss.dueWeek)
                        : ss.dueDate ? ss.dueDate.slice(0, 10) : "—"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <StepChip status={ss.status} />
                    {canEdit && (
                      <select
                        className="text-[10px] rounded border border-stone-200 bg-white px-1.5 py-0.5"
                        value={ss.status}
                        onChange={(e) => {
                          const next = e.target.value as SchoolPlanStepStatusValue;
                          if (next === "blocked") {
                            setBlockingOpen({ kind: "substep", id: ss.id });
                            setBlockingText(ss.blockingNote ?? "");
                            return;
                          }
                          startTransition(() => { void setSubstepStatus(ss.id, next); });
                        }}
                        disabled={pending}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                        <option value="blocked">Blocked…</option>
                        <option value="not_applicable">N/A</option>
                      </select>
                    )}
                  </div>
                  {blockingOpen?.kind === "substep" && blockingOpen.id === ss.id && (
                    <BlockingEditor
                      text={blockingText} setText={setBlockingText}
                      onSave={() => startTransition(() => {
                        void setSubstepStatus(ss.id, "blocked", blockingText).then(() => setBlockingOpen(null));
                      })}
                      onCancel={() => setBlockingOpen(null)}
                    />
                  )}
                </td>
                {canEdit && (
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      className="text-stone-400 hover:text-rose-600 disabled:opacity-50"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Delete substep "${ss.title}"?`)) return;
                        startTransition(() => { void deleteSubstep(ss.id); });
                      }}
                      title="Delete substep"
                      aria-label={`Delete substep ${ss.title}`}
                    >✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="border-t border-stone-100 px-3 py-2">
          {isAdding ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); submitAdd(); }}
            >
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Substep title"
                className="flex-1 text-[11px] rounded border border-stone-200 px-2 py-1"
                disabled={pending}
              />
              <button type="submit" disabled={pending || !newTitle.trim()} className="text-[11px] px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">Add</button>
              <button type="button" onClick={() => { setAddingFor(null); setNewTitle(""); }} className="text-[11px] px-2 py-1 text-stone-500 hover:text-stone-800">Cancel</button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingFor(step.id)}
              className="text-[11px] text-sky-700 hover:text-sky-800"
              disabled={pending}
            >
              + Add substep
            </button>
          )}
        </div>
      )}
    </div>
  );
}
