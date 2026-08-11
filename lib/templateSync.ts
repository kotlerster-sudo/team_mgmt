// Template sync engine. Computes a diff between a GoalTemplateDef (current
// admin-edited version) and each goal previously created from that template,
// then optionally applies the diff to bring instances in line.
//
// Matching is by templateKey at every level:
//   Pitstop.templateKey ↔ DbPitstop.key
//   ChecklistItem.key   ↔ DbChecklistItem.key  (scoped by parent pitstop)
//   PitstopEvent.templateKey ↔ DbActivity.key  (scoped by parent checklistItem)
//
// Rows without a templateKey are user-created and never touched.
// Completed work (Pitstop.status="Done", ChecklistItem.status="Done",
// PitstopEvent.status="Done") is never modified; sync surfaces a "blocked"
// flag so the admin sees what skipped.
//
// Limitations (V1):
//   * Pitstop date offsets in the template are NOT propagated to instances
//     whose dates have already been set / cascade-shifted. Instances keep
//     their current dates.
//   * Template repeatCount changes don't add or remove recurring instances.

import prisma from "./prisma";
import type { DbTemplate, DbPitstop, DbChecklistItem, DbActivity } from "./templateDb";
import { slugifyChecklistText, normalizeActivities } from "./templateDb";
import { snapToWeekday, addDaysUTC, dayDeltaUTC, scheduleActivitiesInWindow } from "./scheduleActivities";
import { auditLog } from "./auditLog";
import { sendPushToUsers } from "./push";
import { RELATIONAL_READS, templatePitstopsFromRelational } from "./controlplane/read";

// ── Public types ────────────────────────────────────────────────────────────

export type SyncChange = {
  kind: "add" | "edit" | "remove";
  entity: "pitstop" | "checklistItem" | "activity" | "goal";
  templateKey: string;
  parentTemplateKey?: string;   // checklist item key (for activities) or pitstop key (for items)
  instanceId?: string;          // present for edit/remove; absent for add
  pitstopInstanceId?: string;   // useful for grouping; present except for "add pitstop"
  field?: string;               // for edits
  oldValue?: string | null;
  newValue?: string | null;
  description: string;
  blocked?: boolean;
  blockedReason?: string;
};

export type GoalSyncPlan = {
  goalId: string;
  goalTitle: string;
  goalStatus: string;
  pitstopInstanceCount: number;
  skipped: null | "complete" | "deleted";
  changes: SyncChange[];
};

export type SyncPreview = {
  templateId: string;
  templateSlug: string;
  templateName: string;
  totalGoals: number;
  goalsWithChanges: number;
  totalChanges: number;
  goals: GoalSyncPlan[];
};

// ── Internal shape: instance data we need from the DB ───────────────────────

type DbPitstopInstance = {
  id: string;
  templateKey: string | null;
  title: string;
  type: string;
  notes: string | null;
  recurrence: string;
  progressTag: string | null;
  status: string;
  startDate: Date | null;
  targetDate: Date | null;
  goalId: string;
  checklistItems: DbChecklistItemInstance[];
};

type DbChecklistItemInstance = {
  id: string;
  pitstopId: string;
  key: string | null;
  templateSlug: string | null;
  text: string;
  status: string;
  checked: boolean;
  completionType: string;
  activities: DbActivityInstance[];
};

type DbActivityInstance = {
  id: string;
  checklistItemId: string;
  templateKey: string | null;
  title: string;
  status: string;
  scheduledAt: Date | null;
};

type GoalSnapshot = {
  id: string;
  title: string;
  status: string;
  startDate: Date | null;
  targetDate: Date | null;
  pitstops: DbPitstopInstance[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

function effectiveKey(explicit: string | null | undefined, fallback: string): string {
  return (explicit ?? "").trim() || slugifyChecklistText(fallback);
}

function isDoneOrCancelled(status: string): boolean {
  return status === "Done" || status === "Cancelled";
}

// Mirror of /api/templates/[id]/apply cadence map. Returns 0 for non-recurring.
function getCadenceDays(recurrence: string | null | undefined): number {
  if (recurrence === "Weekly")    return 7;
  if (recurrence === "Quarterly") return 90;
  if (recurrence === "Monthly")   return 30;
  return 0;
}

// Compute the scheduledAt for an activity given a pitstop window + optional
// dayOffset. Clamps to [start, end] when both are known. Falls back to start
// when offset is unset.
function offsetScheduledAt(
  start: Date | null | undefined,
  end: Date | null | undefined,
  dayOffset: number | undefined,
): Date {
  const base = start ?? new Date();
  if (!Number.isFinite(dayOffset)) return snapToWeekday(base);
  const raw = addDaysUTC(base, dayOffset as number);
  let snapped = snapToWeekday(raw);
  const startSnap = snapToWeekday(base);
  const endSnap = end ? snapToWeekday(end) : null;
  if (snapped < startSnap) snapped = startSnap;
  else if (endSnap && snapped > endSnap) snapped = endSnap;
  return snapped;
}

// Where the pitstop's startDate/targetDate SHOULD land given the current
// template SLA + recurrence index. Used both by the pitstop field-diff
// (line 276) and the activity scheduling diff so the latter computes against
// the post-sync window — not the snapshot.
function computeExpectedWindow(
  tpl: DbPitstop,
  instanceIdx: number,
  goalStartDate: Date | null,
): { start: Date; target: Date } | null {
  if (!goalStartDate) return null;
  const cadence = getCadenceDays(tpl.recurrence);
  const startOffset = Number.isFinite(tpl.startSlaDays) ? tpl.startSlaDays : 0;
  const targetOffset = Number.isFinite(tpl.slaDays) ? tpl.slaDays : startOffset;
  return {
    start:  snapToWeekday(addDaysUTC(goalStartDate, startOffset + instanceIdx * cadence)),
    target: snapToWeekday(addDaysUTC(goalStartDate, targetOffset + instanceIdx * cadence)),
  };
}

// Plain Mon–Fri enumeration between two dates (UTC). Used to seed the
// distribute-evenly fallback in activity scheduling. Does NOT honour
// city-specific blocked days (travel/non-travel meeting rule lives in
// AppSetting + city — too heavy to load per pitstop in the sync path); the
// initial template-apply route does honour them. Acceptable divergence: the
// RP can drag-reschedule within the new window if the exact day matters.
function workingDaysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setUTCHours(23, 59, 59, 999);
  while (cur <= endDay) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Build a templateKey → expected scheduledAt map for every activity under one
// template pitstop, given the expected pitstop window. Mirrors what
// /api/templates/[id]/apply does on initial goal creation: activities with
// `dayOffset` pin to start+offset (clamped to window), the rest distribute
// evenly across the working days. Activities are flattened across all
// checklist items in declaration order, matching the apply route's behaviour.
function computeActivitySchedule(
  tpl: DbPitstop,
  expectedStart: Date,
  expectedTarget: Date,
): Map<string, Date> {
  const out = new Map<string, Date>();
  // Flat list of {key, dayOffset} across all activities, preserving declaration order.
  const flat: { key: string; dayOffset?: number }[] = [];
  for (const tplItem of tpl.checklist) {
    for (const act of normalizeActivities(tplItem)) {
      const k = effectiveKey(act.key, act.title);
      if (!k) continue;
      flat.push({ key: k, dayOffset: act.dayOffset });
    }
  }
  if (flat.length === 0) return out;
  const workingDays = workingDaysBetween(expectedStart, expectedTarget);
  if (workingDays.length === 0) {
    // No working days in window (e.g. weekend-only window — shouldn't happen
    // since pitstop dates are snapped to weekdays). Fall back to the snapped
    // start so nothing is null.
    for (const a of flat) out.set(a.key, snapToWeekday(expectedStart));
    return out;
  }
  const { dates } = scheduleActivitiesInWindow(flat, expectedStart, workingDays);
  for (let i = 0; i < flat.length; i++) {
    if (dates[i]) out.set(flat[i].key, dates[i]);
  }
  return out;
}

// ── Diff: template vs one goal snapshot ─────────────────────────────────────

function diffGoal(template: DbTemplate, snapshot: GoalSnapshot): SyncChange[] {
  const changes: SyncChange[] = [];

  // Group instance pitstops by templateKey. Multiple instances may share a key
  // (recurring clones); we apply changes to each.
  const instanceByKey = new Map<string, DbPitstopInstance[]>();
  for (const p of snapshot.pitstops) {
    if (!p.templateKey) continue;
    const arr = instanceByKey.get(p.templateKey) ?? [];
    arr.push(p);
    instanceByKey.set(p.templateKey, arr);
  }

  const templateKeys = new Set<string>();

  // Collect targetDate candidates from every pitstop that will survive sync,
  // so we can reconcile Goal.targetDate against MAX(pitstop.targetDate) per
  // the [[recurring-pitstop-target-date]] invariant. Done instances keep
  // their current targetDate; non-Done instances move to expected.target;
  // Cancelled and removed instances are excluded.
  const candidateTargets: Date[] = [];

  // Walk template pitstop slots
  for (const tplPt of template.pitstops) {
    const pKey = effectiveKey(tplPt.key, tplPt.title);
    if (!pKey) continue;
    templateKeys.add(pKey);

    const instances = instanceByKey.get(pKey) ?? [];

    if (instances.length === 0) {
      // ADD new pitstop on this goal
      changes.push({
        kind: "add",
        entity: "pitstop",
        templateKey: pKey,
        description: `Add pitstop "${tplPt.title}"`,
      });
      // The apply branch creates ONE instance at goalStart + slaDays (V1
      // limitation — repeatCount > 1 not yet honoured on add). Mirror that
      // here for the goal-target MAX.
      if (snapshot.startDate) {
        const targetOffset = Number.isFinite(tplPt.slaDays) ? tplPt.slaDays : (tplPt.startSlaDays ?? 0);
        candidateTargets.push(snapToWeekday(addDaysUTC(snapshot.startDate, targetOffset)));
      }
      continue;
    }

    // Diff each instance against this template slot. Index within the
    // templateKey group is the recurrence position — used to compute the
    // expected start/target date for that instance.
    instances.forEach((inst, idx) => {
      // Goal-target candidate: Done keeps current; Cancelled excluded;
      // everything else picks up expected.target.
      const expected = computeExpectedWindow(tplPt, idx, snapshot.startDate);
      if (inst.status === "Done") {
        if (inst.targetDate) candidateTargets.push(inst.targetDate);
      } else if (inst.status !== "Cancelled") {
        if (expected) candidateTargets.push(expected.target);
        else if (inst.targetDate) candidateTargets.push(inst.targetDate);
      }

      if (isDoneOrCancelled(inst.status)) {
        // Completed pitstop — skip all changes, surface a single blocked entry
        // only if there are template changes that would have applied
        return;
      }

      // Compute the expected post-sync window ONCE per instance and reuse
      // for both the pitstop-field diff and the activity scheduling diff.
      // This is the fix to the snapshot-vs-mutation bug: previously
      // diffActivities computed scheduledAt against inst.startDate (the
      // pre-sync value), so SLA changes never propagated to activity dates.
      const expectedSchedule = expected
        ? computeActivitySchedule(tplPt, expected.start, expected.target)
        : new Map<string, Date>();

      diffPitstopFields(tplPt, inst, idx, snapshot.startDate, changes, expected);
      diffChecklist(tplPt, inst, expectedSchedule, changes);
    });
  }

  // Find instance pitstops whose templateKey is no longer in the template → REMOVE
  for (const [key, instances] of instanceByKey) {
    if (templateKeys.has(key)) continue;
    for (const inst of instances) {
      const blocked = isDoneOrCancelled(inst.status);
      changes.push({
        kind: "remove",
        entity: "pitstop",
        templateKey: key,
        instanceId: inst.id,
        pitstopInstanceId: inst.id,
        description: `Cancel pitstop "${inst.title}" (removed from template)`,
        ...(blocked
          ? { blocked: true, blockedReason: `Pitstop is ${inst.status}` }
          : {}),
      });
    }
  }

  // Goal-target reconciliation. Only bump UP — never shrink, so a goal whose
  // owner manually extended the deadline keeps that buffer. Apply-time also
  // re-reads true MAX after writes to catch user-added (non-template)
  // pitstops the snapshot doesn't load.
  if (snapshot.targetDate && candidateTargets.length > 0) {
    const maxTarget = candidateTargets.reduce(
      (m, d) => (d.getTime() > m.getTime() ? d : m),
      candidateTargets[0],
    );
    if (dayDeltaUTC(snapshot.targetDate, maxTarget) > 0) {
      changes.push({
        kind: "edit",
        entity: "goal",
        templateKey: "__goal_target__",
        instanceId: snapshot.id,
        field: "targetDate",
        oldValue: snapshot.targetDate.toISOString(),
        newValue: maxTarget.toISOString(),
        description: `Extend goal deadline to cover updated pitstop schedule`,
      });
    }
  }

  return changes;
}

function diffPitstopFields(
  tpl: DbPitstop,
  inst: DbPitstopInstance,
  instanceIdx: number,
  goalStartDate: Date | null,
  changes: SyncChange[],
  expected: { start: Date; target: Date } | null,
) {
  if (tpl.title && tpl.title !== inst.title) {
    changes.push({
      kind: "edit",
      entity: "pitstop",
      templateKey: inst.templateKey!,
      instanceId: inst.id,
      pitstopInstanceId: inst.id,
      field: "title",
      oldValue: inst.title,
      newValue: tpl.title,
      description: `Rename pitstop "${inst.title}" → "${tpl.title}"`,
    });
  }
  if (tpl.notes !== undefined && tpl.notes !== inst.notes && (tpl.notes || inst.notes)) {
    changes.push({
      kind: "edit",
      entity: "pitstop",
      templateKey: inst.templateKey!,
      instanceId: inst.id,
      pitstopInstanceId: inst.id,
      field: "notes",
      oldValue: inst.notes ?? "",
      newValue: tpl.notes ?? "",
      description: `Update notes on "${inst.title}"`,
    });
  }

  // Phase tag — propagated as-is.
  const tplTag = tpl.progressTag ?? null;
  const instTag = inst.progressTag ?? null;
  if (tplTag !== instTag) {
    changes.push({
      kind: "edit",
      entity: "pitstop",
      templateKey: inst.templateKey!,
      instanceId: inst.id,
      pitstopInstanceId: inst.id,
      field: "progressTag",
      oldValue: instTag,
      newValue: tplTag,
      description: `Change phase tag of "${inst.title}" from ${instTag ?? "(none)"} → ${tplTag ?? "(none)"}`,
    });
  }

  // SLA day offsets — recompute startDate / targetDate from goal start +
  // template offsets, shifted by the instance's recurrence index. Mirrors the
  // formula used in /api/templates/[id]/apply on initial goal creation.
  // Will overwrite any manual reschedules — this is the agreed behaviour.
  // `expected` is precomputed once per instance by the caller so the same
  // values are reused for activity scheduling (see computeActivitySchedule).
  if (expected) {
    const startOffset = Number.isFinite(tpl.startSlaDays) ? tpl.startSlaDays : 0;
    const targetOffset = Number.isFinite(tpl.slaDays) ? tpl.slaDays : startOffset;
    if (!inst.startDate || dayDeltaUTC(inst.startDate, expected.start) !== 0) {
      changes.push({
        kind: "edit",
        entity: "pitstop",
        templateKey: inst.templateKey!,
        instanceId: inst.id,
        pitstopInstanceId: inst.id,
        field: "startDate",
        oldValue: inst.startDate ? inst.startDate.toISOString() : null,
        newValue: expected.start.toISOString(),
        description: `Reschedule start of "${inst.title}" to day ${startOffset}${instanceIdx > 0 ? ` (+${instanceIdx} cycle${instanceIdx === 1 ? "" : "s"})` : ""} after goal start`,
      });
    }
    if (!inst.targetDate || dayDeltaUTC(inst.targetDate, expected.target) !== 0) {
      changes.push({
        kind: "edit",
        entity: "pitstop",
        templateKey: inst.templateKey!,
        instanceId: inst.id,
        pitstopInstanceId: inst.id,
        field: "targetDate",
        oldValue: inst.targetDate ? inst.targetDate.toISOString() : null,
        newValue: expected.target.toISOString(),
        description: `Reschedule target of "${inst.title}" to day ${targetOffset}${instanceIdx > 0 ? ` (+${instanceIdx} cycle${instanceIdx === 1 ? "" : "s"})` : ""} after goal start`,
      });
    }
  }
  // Pitstop type is set on apply; sync respects it as immutable to avoid
  // breaking the activity-type mapping. Skip.
  void goalStartDate; void instanceIdx; // kept for signature stability
}

function diffChecklist(
  tpl: DbPitstop,
  inst: DbPitstopInstance,
  expectedSchedule: Map<string, Date>,
  changes: SyncChange[],
) {
  // Group template items by key
  const tplItems = new Map<string, DbChecklistItem>();
  for (const tplItem of tpl.checklist) {
    const k = effectiveKey(tplItem.key, tplItem.text);
    if (!k) continue;
    tplItems.set(k, tplItem);
  }

  // Group instance items by key (only template-owned)
  const instItems = new Map<string, DbChecklistItemInstance>();
  for (const ci of inst.checklistItems) {
    if (!ci.templateSlug || !ci.key) continue;
    instItems.set(ci.key, ci);
  }

  // ADD: template items missing on instance
  for (const [k, tplItem] of tplItems) {
    if (instItems.has(k)) continue;
    const activities = normalizeActivities(tplItem);
    const ctyp = tplItem.completionType ?? activities[0]?.completionType ?? "Activity";
    changes.push({
      kind: "add",
      entity: "checklistItem",
      templateKey: k,
      parentTemplateKey: inst.templateKey!,
      pitstopInstanceId: inst.id,
      description: `Add checklist item "${tplItem.text}" to "${inst.title}" (${activities.length} activit${activities.length === 1 ? "y" : "ies"})`,
      newValue: tplItem.text,
      field: ctyp,
    });
  }

  // EDIT + activity diff for items present on both sides
  for (const [k, tplItem] of tplItems) {
    const instItem = instItems.get(k);
    if (!instItem) continue;
    const itemBlocked = isDoneOrCancelled(instItem.status);

    // Text change
    if (tplItem.text !== instItem.text) {
      changes.push({
        kind: "edit",
        entity: "checklistItem",
        templateKey: k,
        parentTemplateKey: inst.templateKey!,
        instanceId: instItem.id,
        pitstopInstanceId: inst.id,
        field: "text",
        oldValue: instItem.text,
        newValue: tplItem.text,
        description: `Rename checklist item "${instItem.text}" → "${tplItem.text}"`,
        ...(itemBlocked
          ? { blocked: true, blockedReason: `Checklist item is ${instItem.status}` }
          : {}),
      });
    }

    // Completion type change — only if not blocked
    const tplActivities = normalizeActivities(tplItem);
    const tplCtyp = tplItem.completionType ?? tplActivities[0]?.completionType ?? "Activity";
    if (tplCtyp && tplCtyp !== instItem.completionType) {
      changes.push({
        kind: "edit",
        entity: "checklistItem",
        templateKey: k,
        parentTemplateKey: inst.templateKey!,
        instanceId: instItem.id,
        pitstopInstanceId: inst.id,
        field: "completionType",
        oldValue: instItem.completionType,
        newValue: tplCtyp,
        description: `Change completion type of "${instItem.text}" from ${instItem.completionType} → ${tplCtyp}`,
        ...(itemBlocked
          ? { blocked: true, blockedReason: `Checklist item is ${instItem.status}` }
          : {}),
      });
    }

    diffActivities(tplItem, instItem, inst, expectedSchedule, changes);
  }

  // REMOVE: instance items not in template
  for (const [k, instItem] of instItems) {
    if (tplItems.has(k)) continue;
    const itemBlocked = isDoneOrCancelled(instItem.status);
    changes.push({
      kind: "remove",
      entity: "checklistItem",
      templateKey: k,
      parentTemplateKey: inst.templateKey!,
      instanceId: instItem.id,
      pitstopInstanceId: inst.id,
      description: `Cancel checklist item "${instItem.text}" on "${inst.title}" (removed from template)`,
      ...(itemBlocked
        ? { blocked: true, blockedReason: `Checklist item is ${instItem.status}` }
        : {}),
    });
  }
}

function diffActivities(
  tplItem: DbChecklistItem,
  instItem: DbChecklistItemInstance,
  inst: DbPitstopInstance,
  expectedSchedule: Map<string, Date>,
  changes: SyncChange[],
) {
  const tplActivities = normalizeActivities(tplItem);

  // Group template activities by key
  const tplActs = new Map<string, DbActivity>();
  for (const a of tplActivities) {
    const k = effectiveKey(a.key, a.title);
    if (!k) continue;
    tplActs.set(k, a);
  }

  // Group instance events by templateKey
  const instActs = new Map<string, DbActivityInstance>();
  for (const ev of instItem.activities) {
    if (!ev.templateKey) continue;
    instActs.set(ev.templateKey, ev);
  }

  // ADD activities
  for (const [k, a] of tplActs) {
    if (instActs.has(k)) continue;
    changes.push({
      kind: "add",
      entity: "activity",
      templateKey: k,
      parentTemplateKey: instItem.key!,
      pitstopInstanceId: inst.id,
      newValue: a.title,
      description: `Add activity "${a.title}" under "${instItem.text}" on "${inst.title}"`,
    });
  }

  // EDIT activities
  for (const [k, a] of tplActs) {
    const ev = instActs.get(k);
    if (!ev) continue;
    const evBlocked = isDoneOrCancelled(ev.status);
    if (a.title !== ev.title) {
      changes.push({
        kind: "edit",
        entity: "activity",
        templateKey: k,
        parentTemplateKey: instItem.key!,
        instanceId: ev.id,
        pitstopInstanceId: inst.id,
        field: "title",
        oldValue: ev.title,
        newValue: a.title,
        description: `Rename activity "${ev.title}" → "${a.title}"`,
        ...(evBlocked
          ? { blocked: true, blockedReason: `Activity is ${ev.status}` }
          : {}),
      });
    }

    // Schedule diff — compute against the EXPECTED post-sync pitstop window
    // (passed in via expectedSchedule). Covers two cases that the previous
    // dayOffset-only path missed:
    //   1. Activities without dayOffset now also reschedule, distributed
    //      evenly across the new working-day window (mirrors the apply route).
    //   2. Even with dayOffset, the scheduledAt is computed against the new
    //      pitstop start — previously it used inst.startDate (the pre-sync
    //      snapshot), so SLA changes never propagated to activity dates in
    //      the same sync run.
    const target = expectedSchedule.get(k);
    if (target) {
      const sameDay = ev.scheduledAt && dayDeltaUTC(ev.scheduledAt, target) === 0;
      if (!sameDay) {
        const reasonNote = Number.isFinite(a.dayOffset)
          ? ` to day ${a.dayOffset} of pitstop`
          : ` to match new pitstop window`;
        changes.push({
          kind: "edit",
          entity: "activity",
          templateKey: k,
          parentTemplateKey: instItem.key!,
          instanceId: ev.id,
          pitstopInstanceId: inst.id,
          field: "scheduledAt",
          oldValue: ev.scheduledAt ? ev.scheduledAt.toISOString() : null,
          newValue: target.toISOString(),
          description: `Reschedule "${ev.title}"${reasonNote}`,
          ...(evBlocked
            ? { blocked: true, blockedReason: `Activity is ${ev.status}` }
            : {}),
        });
      }
    }
  }

  // REMOVE activities
  for (const [k, ev] of instActs) {
    if (tplActs.has(k)) continue;
    const evBlocked = isDoneOrCancelled(ev.status);
    changes.push({
      kind: "remove",
      entity: "activity",
      templateKey: k,
      parentTemplateKey: instItem.key!,
      instanceId: ev.id,
      pitstopInstanceId: inst.id,
      description: `Cancel activity "${ev.title}" under "${instItem.text}" (removed from template)`,
      ...(evBlocked
        ? { blocked: true, blockedReason: `Activity is ${ev.status}` }
        : {}),
    });
  }
}

// ── Loaders ────────────────────────────────────────────────────────────────

async function loadTemplate(templateId: string): Promise<DbTemplate | null> {
  const row = await prisma.goalTemplateDef.findUnique({
    where: { id: templateId },
  });
  if (!row) return null;
  const pitstops = RELATIONAL_READS
    ? ((await templatePitstopsFromRelational(row.id)) as unknown as DbTemplate["pitstops"])
    : ((row.pitstops as unknown as DbTemplate["pitstops"]) ?? []);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    needsDomain: row.needsDomain,
    linkedFacilityLayerKey: row.linkedFacilityLayerKey,
    sortOrder: row.sortOrder,
    parameters: (row.parameters as unknown as DbTemplate["parameters"]) ?? [],
    pitstops,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadGoalSnapshots(templateSlug: string): Promise<GoalSnapshot[]> {
  // Find all goals with at least one pitstop owned by this template, then load
  // their full pitstop trees (incl. checklist items and activities).
  const pitstops = await prisma.$queryRaw<{
    id: string; goalId: string; templateKey: string | null;
    title: string; type: string; notes: string | null;
    recurrence: string; progressTag: string | null; status: string;
    startDate: Date | null; targetDate: Date | null;
  }[]>`
    SELECT p.id, p."goalId", p."templateKey",
           p.title, p.type::text AS type, p.notes,
           p.recurrence::text AS recurrence, p."progressTag", p.status::text AS status,
           p."startDate", p."targetDate"
    FROM "Pitstop" p
    JOIN "Goal" g ON g.id = p."goalId"
    WHERE p."templateSlug" = ${templateSlug}
      AND p."deletedAt" IS NULL
      AND g."deletedAt" IS NULL
      AND g.status != 'Complete'
    ORDER BY g.id, p."order" ASC
  `;
  if (pitstops.length === 0) return [];

  const goalIds = Array.from(new Set(pitstops.map(p => p.goalId)));
  const pitstopIds = pitstops.map(p => p.id);

  const goals = await prisma.goal.findMany({
    where: { id: { in: goalIds } },
    select: { id: true, title: true, status: true, startDate: true, targetDate: true },
  });
  const goalById = new Map(goals.map(g => [g.id, g]));

  const checklistItems = await prisma.$queryRaw<{
    id: string; pitstopId: string; key: string | null; templateSlug: string | null;
    text: string; status: string; checked: boolean; completionType: string;
  }[]>`
    SELECT id, "pitstopId", key, "templateSlug",
           text, status::text AS status, checked, "completionType"::text AS "completionType"
    FROM "ChecklistItem"
    WHERE "pitstopId" = ANY(${pitstopIds})
    ORDER BY "order" ASC
  `;
  const checklistByPitstop = new Map<string, DbChecklistItemInstance[]>();
  const checklistById = new Map<string, DbChecklistItemInstance>();
  for (const ci of checklistItems) {
    const inst: DbChecklistItemInstance = { ...ci, activities: [] };
    checklistById.set(ci.id, inst);
    const arr = checklistByPitstop.get(ci.pitstopId) ?? [];
    arr.push(inst);
    checklistByPitstop.set(ci.pitstopId, arr);
  }

  const checklistIds = checklistItems.map(c => c.id);
  if (checklistIds.length > 0) {
    const events = await prisma.$queryRaw<{
      id: string; checklistItemId: string; templateKey: string | null;
      title: string; status: string; scheduledAt: Date | null;
    }[]>`
      SELECT id, "checklistItemId", "templateKey", title, status::text AS status, "scheduledAt"
      FROM "PitstopEvent"
      WHERE "checklistItemId" = ANY(${checklistIds}) AND "deletedAt" IS NULL
    `;
    for (const ev of events) {
      const ci = checklistById.get(ev.checklistItemId);
      if (ci) ci.activities.push(ev);
    }
  }

  // Assemble snapshots
  const snapshotByGoal = new Map<string, GoalSnapshot>();
  for (const g of goals) {
    snapshotByGoal.set(g.id, {
      id: g.id,
      title: g.title,
      status: g.status,
      startDate: g.startDate,
      targetDate: g.targetDate,
      pitstops: [],
    });
  }
  for (const p of pitstops) {
    const snap = snapshotByGoal.get(p.goalId);
    const goal = goalById.get(p.goalId);
    if (!snap || !goal) continue;
    snap.pitstops.push({
      ...p,
      checklistItems: checklistByPitstop.get(p.id) ?? [],
    });
  }

  return Array.from(snapshotByGoal.values());
}

// ── Public: preview ────────────────────────────────────────────────────────

export async function previewSync(templateId: string): Promise<SyncPreview | null> {
  const template = await loadTemplate(templateId);
  if (!template) return null;

  const snapshots = await loadGoalSnapshots(template.slug);

  const goalPlans: GoalSyncPlan[] = snapshots.map(snap => {
    const changes = diffGoal(template, snap);
    return {
      goalId: snap.id,
      goalTitle: snap.title,
      goalStatus: snap.status,
      pitstopInstanceCount: snap.pitstops.length,
      skipped: null,
      changes,
    };
  });

  const goalsWithChanges = goalPlans.filter(g => g.changes.length > 0).length;
  const totalChanges = goalPlans.reduce((s, g) => s + g.changes.length, 0);

  return {
    templateId: template.id,
    templateSlug: template.slug,
    templateName: template.name,
    totalGoals: snapshots.length,
    goalsWithChanges,
    totalChanges,
    goals: goalPlans,
  };
}

// ── Public: apply ──────────────────────────────────────────────────────────

export async function applySync(
  templateId: string,
  actorId: string,
  opts: { onlyGoalIds?: string[] } = {},
): Promise<{ goalsTouched: number; changesApplied: number; changesBlocked: number; errors: string[] }> {
  const preview = await previewSync(templateId);
  if (!preview) return { goalsTouched: 0, changesApplied: 0, changesBlocked: 0, errors: ["template not found"] };

  const template = await loadTemplate(templateId);
  if (!template) return { goalsTouched: 0, changesApplied: 0, changesBlocked: 0, errors: ["template not found"] };

  let goalsTouched = 0;
  let changesApplied = 0;
  let changesBlocked = 0;
  const errors: string[] = [];

  const goalIdFilter = opts.onlyGoalIds ? new Set(opts.onlyGoalIds) : null;

  for (const plan of preview.goals) {
    if (goalIdFilter && !goalIdFilter.has(plan.goalId)) continue;
    if (plan.changes.length === 0) continue;

    // Snapshot the goal to derive per-pitstop scheduling context for new
    // activities or new checklist items added by this sync. coOwners ride
    // along on every event we create here — matches the rule applied
    // everywhere else activities are materialised.
    const goalRow = await prisma.goal.findUnique({
      where: { id: plan.goalId },
      select: {
        id: true, title: true, status: true, startDate: true, targetDate: true, ownerId: true,
        coOwners: { select: { userId: true } },
      },
    });
    if (!goalRow) continue;
    const goal = {
      ...goalRow,
      coOwnerIds: goalRow.coOwners.map(co => co.userId),
    };

    const applicable = plan.changes.filter(c => !c.blocked);
    const blocked    = plan.changes.filter(c =>  c.blocked);
    changesBlocked += blocked.length;
    if (applicable.length === 0) continue;

    try {
      const applied = await applyGoalChanges(template, goal, plan, applicable, actorId);
      changesApplied += applied;
      if (applied > 0) {
        goalsTouched += 1;
        // Heads-up to the goal owner (not the actor — they triggered it).
        if (goal.ownerId && goal.ownerId !== actorId) {
          const adds    = applicable.filter(c => c.kind === "add").length;
          const edits   = applicable.filter(c => c.kind === "edit").length;
          const removes = applicable.filter(c => c.kind === "remove").length;
          const parts: string[] = [];
          if (adds)    parts.push(`${adds} added`);
          if (edits)   parts.push(`${edits} edited`);
          if (removes) parts.push(`${removes} cancelled`);
          const body = `Template "${template.name}" was updated: ${parts.join(", ")}.`;
          await prisma.notification.create({
            data: {
              userId: goal.ownerId,
              type: "BroadcastUpdate",
              title: `"${goal.title}" updated from template`,
              body,
              link: `/goals/${goal.id}`,
            },
          }).catch(() => {});
          sendPushToUsers([goal.ownerId], {
            title: `"${goal.title}" updated from template`,
            body,
            link: `/goals/${goal.id}`,
          });
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`goal ${plan.goalId}: ${msg}`);
    }
  }

  // Top-level audit
  auditLog({
    entityType: "Goal",
    entityId: templateId,
    userId: actorId,
    action: "template_sync_apply",
    field: "templateSlug",
    oldValue: null,
    newValue: `${goalsTouched} goals, ${changesApplied} changes applied, ${changesBlocked} blocked, ${errors.length} errors`,
  });

  return { goalsTouched, changesApplied, changesBlocked, errors };
}

// ── Apply: one goal's changes inside a transaction ─────────────────────────

async function applyGoalChanges(
  template: DbTemplate,
  goal: { id: string; ownerId: string; startDate: Date | null; targetDate: Date | null; coOwnerIds: string[] },
  plan: GoalSyncPlan,
  changes: SyncChange[],
  actorId: string,
): Promise<number> {
  // Deduped attendee set used for every event we materialise below — goal owner
  // plus every goal co-owner. Co-owners are seeded as accepted (visibility +
  // calendar presence by design, no confirmation needed).
  const eventAttendeeCreate = Array.from(new Set([goal.ownerId, ...goal.coOwnerIds]))
    .map((userId) => ({ userId, status: "accepted" as const }));
  let applied = 0;

  // Group adds-of-pitstops first; we need their IDs for downstream adds.
  // Order: add pitstops → add/edit/remove checklist items → add/edit/remove activities.
  const sorted = [...changes].sort((a, b) => orderRank(a) - orderRank(b));

  // Reload current pitstops/checklist items by key so we can resolve parent IDs.
  const currentPitstops = await prisma.pitstop.findMany({
    where: { goalId: goal.id, templateSlug: template.slug, deletedAt: null },
    select: { id: true, templateKey: true, startDate: true, targetDate: true, status: true, recurrence: true, order: true, type: true },
  });
  // For pitstops that share templateKey (recurring), we don't add — V1 limitation.
  // When we add a brand-new pitstop, we pick the first instance's parent ownership.

  // We'll mutate this map as we add new pitstops:
  const pitstopByKey = new Map<string, typeof currentPitstops[0]>();
  for (const p of currentPitstops) {
    if (p.templateKey && !pitstopByKey.has(p.templateKey)) pitstopByKey.set(p.templateKey, p);
  }

  let maxOrder = currentPitstops.reduce((m, p) => Math.max(m, p.order), -1);

  for (const ch of sorted) {
    try {
      if (ch.kind === "add" && ch.entity === "pitstop") {
        // Find the template pitstop slot
        const tplPt = template.pitstops.find(p => effectiveKey(p.key, p.title) === ch.templateKey);
        if (!tplPt) continue;
        const start = goal.startDate ?? new Date();
        const startD = new Date(start);
        startD.setDate(startD.getDate() + (Number.isFinite(tplPt.startSlaDays) ? tplPt.startSlaDays : 0));
        const targetD = new Date(start);
        targetD.setDate(targetD.getDate() + (Number.isFinite(tplPt.slaDays) ? tplPt.slaDays : tplPt.startSlaDays));
        maxOrder += 1;
        const validTypes = ["Meeting", "Training", "SiteVisit", "Discussion", "AppDevelopment", "Budgeting", "Proposal", "Research", "Review", "Custom"];
        const validRec   = ["None", "Weekly", "Monthly", "Quarterly"];
        const created = await prisma.pitstop.create({
          data: {
            goalId: goal.id,
            title: tplPt.title,
            type: (validTypes.includes(tplPt.type) ? tplPt.type : "Discussion") as never,
            notes: tplPt.notes ?? null,
            order: maxOrder,
            ownerId: goal.ownerId,
            ownerInherited: true,
            recurrence: (tplPt.recurrence && validRec.includes(tplPt.recurrence) ? tplPt.recurrence : "None") as never,
            startDate: snapToWeekday(startD),
            targetDate: snapToWeekday(targetD),
            templateSlug: template.slug,
            templateKey: ch.templateKey,
          },
          select: { id: true, templateKey: true, startDate: true, targetDate: true, status: true, recurrence: true, order: true, type: true },
        });
        pitstopByKey.set(ch.templateKey, created);
        auditLog({ entityType: "Pitstop", entityId: created.id, userId: actorId, action: "template_sync_add", field: "title", oldValue: null, newValue: tplPt.title });
        applied += 1;

        // Materialise checklist items + activities for the new pitstop
        for (const tplItem of tplPt.checklist) {
          const k = effectiveKey(tplItem.key, tplItem.text);
          if (!k) continue;
          const ctyp = tplItem.completionType ?? normalizeActivities(tplItem)[0]?.completionType ?? "Activity";
          const ci = await prisma.checklistItem.create({
            data: {
              pitstopId: created.id,
              text: tplItem.text,
              order: 0,
              key: k,
              templateSlug: template.slug,
              ...(ctyp !== "Activity" ? { completionType: ctyp as "Voice" | "Upload" } : {}),
            },
            select: { id: true },
          });
          for (const act of normalizeActivities(tplItem)) {
            const ak = effectiveKey(act.key, act.title);
            if (!ak) continue;
            const actScheduledAt = offsetScheduledAt(created.startDate, created.targetDate, act.dayOffset);
            await prisma.pitstopEvent.create({
              data: {
                title: act.title,
                scheduledAt: actScheduledAt,
                originalScheduledAt: actScheduledAt,
                createdById: actorId,
                templateKey: ak,
                pitstops: { create: [{ pitstopId: created.id }] },
                // Attach the goal owner as accepted attendee. Mirrors the
                // official template-apply route (app/api/templates/[id]/apply
                // route.ts:323). Without this, sync-added activities are
                // invisible on every user's calendar (no attendee match).
                attendees: { create: eventAttendeeCreate },
              },
            });
            // Link to checklist item (Lambda-cache safety)
            await prisma.$executeRaw`UPDATE "PitstopEvent" SET "checklistItemId" = ${ci.id} WHERE "templateKey" = ${ak} AND "checklistItemId" IS NULL AND id IN (SELECT id FROM "PitstopEvent" WHERE id IN (SELECT "pitstopEventId" FROM "PitstopEventPitstop" WHERE "pitstopId" = ${created.id}))`;
          }
        }
      }

      else if (ch.kind === "add" && ch.entity === "checklistItem") {
        // Find parent pitstop instance(s)
        if (!ch.parentTemplateKey) continue;
        const tplPt = template.pitstops.find(p => effectiveKey(p.key, p.title) === ch.parentTemplateKey);
        const tplItem = tplPt?.checklist.find(i => effectiveKey(i.key, i.text) === ch.templateKey);
        if (!tplItem || !ch.pitstopInstanceId) continue;
        const parentPt = pitstopByKey.get(ch.parentTemplateKey);
        if (!parentPt) continue;
        const ctyp = tplItem.completionType ?? normalizeActivities(tplItem)[0]?.completionType ?? "Activity";
        // Compute order at end of existing items
        const maxItemOrder = await prisma.checklistItem.findFirst({
          where: { pitstopId: ch.pitstopInstanceId },
          orderBy: { order: "desc" },
          select: { order: true },
        });
        const ci = await prisma.checklistItem.create({
          data: {
            pitstopId: ch.pitstopInstanceId,
            text: tplItem.text,
            order: (maxItemOrder?.order ?? -1) + 1,
            key: ch.templateKey,
            templateSlug: template.slug,
            ...(ctyp !== "Activity" ? { completionType: ctyp as "Voice" | "Upload" } : {}),
          },
          select: { id: true },
        });
        auditLog({ entityType: "Checklist", entityId: ci.id, userId: actorId, action: "template_sync_add", field: "text", oldValue: null, newValue: tplItem.text });
        applied += 1;

        // Materialise activities for this new checklist item
        for (const act of normalizeActivities(tplItem)) {
          const ak = effectiveKey(act.key, act.title);
          if (!ak) continue;
          const actScheduledAt = offsetScheduledAt(parentPt.startDate, parentPt.targetDate, act.dayOffset);
          const ev = await prisma.pitstopEvent.create({
            data: {
              title: act.title,
              scheduledAt: actScheduledAt,
              originalScheduledAt: actScheduledAt,
              createdById: actorId,
              templateKey: ak,
              pitstops: { create: [{ pitstopId: parentPt.id }] },
              // Attendee on the goal owner — see add-pitstop branch above.
              attendees: { create: eventAttendeeCreate },
            },
            select: { id: true },
          });
          await prisma.$executeRaw`UPDATE "PitstopEvent" SET "checklistItemId" = ${ci.id} WHERE id = ${ev.id}`;
        }
      }

      else if (ch.kind === "add" && ch.entity === "activity") {
        if (!ch.parentTemplateKey || !ch.pitstopInstanceId) continue;
        // Find parent checklist item by key
        const parentCi = await prisma.checklistItem.findFirst({
          where: { pitstopId: ch.pitstopInstanceId, key: ch.parentTemplateKey, templateSlug: template.slug },
          select: { id: true },
        });
        if (!parentCi) continue;
        const parent = await prisma.pitstop.findUnique({
          where: { id: ch.pitstopInstanceId },
          select: { id: true, startDate: true, targetDate: true, templateKey: true },
        });
        // Resolve the template-side activity to read its dayOffset (if any)
        const tplPtForAct = template.pitstops.find(p => effectiveKey(p.key, p.title) === parent?.templateKey);
        const tplItemForAct = tplPtForAct?.checklist.find(i => effectiveKey(i.key, i.text) === ch.parentTemplateKey);
        const tplActForAct = tplItemForAct
          ? normalizeActivities(tplItemForAct).find(a => effectiveKey(a.key, a.title) === ch.templateKey)
          : undefined;
        const newActScheduledAt = offsetScheduledAt(parent?.startDate, parent?.targetDate, tplActForAct?.dayOffset);
        const ev = await prisma.pitstopEvent.create({
          data: {
            title: ch.newValue ?? "Activity",
            scheduledAt: newActScheduledAt,
            originalScheduledAt: newActScheduledAt,
            createdById: actorId,
            templateKey: ch.templateKey,
            pitstops: { create: [{ pitstopId: ch.pitstopInstanceId }] },
            // Attendee on the goal owner — see add-pitstop branch above.
            attendees: { create: eventAttendeeCreate },
          },
          select: { id: true },
        });
        await prisma.$executeRaw`UPDATE "PitstopEvent" SET "checklistItemId" = ${parentCi.id} WHERE id = ${ev.id}`;
        auditLog({ entityType: "Activity", entityId: ev.id, userId: actorId, action: "template_sync_add", field: "title", oldValue: null, newValue: ch.newValue ?? null });
        applied += 1;
      }

      else if (ch.kind === "edit" && ch.instanceId) {
        if (ch.entity === "goal") {
          // Goal-target reconciliation. instanceId is the goalId. Only the
          // targetDate field is emitted today; future goal-level edits can
          // extend this branch.
          if (ch.field === "targetDate" && ch.newValue) {
            await prisma.goal.update({
              where: { id: ch.instanceId },
              data: { targetDate: new Date(ch.newValue) },
            });
            auditLog({
              entityType: "Goal", entityId: ch.instanceId, userId: actorId,
              action: "template_sync_edit", field: "targetDate",
              oldValue: ch.oldValue ?? null, newValue: ch.newValue,
            });
            applied += 1;
          }
        } else if (ch.entity === "pitstop") {
          if (ch.field === "startDate" || ch.field === "targetDate") {
            await prisma.pitstop.update({
              where: { id: ch.instanceId },
              data: { [ch.field]: ch.newValue ? new Date(ch.newValue) : null } as never,
            });
          } else {
            // title | notes | progressTag — all plain string columns
            await prisma.pitstop.update({
              where: { id: ch.instanceId },
              data: { [ch.field as "title" | "notes" | "progressTag"]: ch.newValue ?? null } as never,
            });
          }
          auditLog({ entityType: "Pitstop", entityId: ch.instanceId, userId: actorId, action: "template_sync_edit", field: ch.field, oldValue: ch.oldValue ?? null, newValue: ch.newValue ?? null });
          applied += 1;
        } else if (ch.entity === "checklistItem") {
          if (ch.field === "completionType") {
            await prisma.$executeRaw`
              UPDATE "ChecklistItem" SET "completionType" = ${ch.newValue}::"ChecklistCompletionType", "updatedAt" = NOW() WHERE id = ${ch.instanceId}
            `;
          } else {
            await prisma.checklistItem.update({
              where: { id: ch.instanceId },
              data: { [ch.field as "text"]: ch.newValue ?? "" } as never,
            });
          }
          auditLog({ entityType: "Checklist", entityId: ch.instanceId, userId: actorId, action: "template_sync_edit", field: ch.field, oldValue: ch.oldValue ?? null, newValue: ch.newValue ?? null });
          applied += 1;
        } else if (ch.entity === "activity") {
          if (ch.field === "scheduledAt") {
            if (!ch.newValue) continue;
            await prisma.pitstopEvent.update({
              where: { id: ch.instanceId },
              data: { scheduledAt: new Date(ch.newValue) },
            });
          } else {
            await prisma.pitstopEvent.update({
              where: { id: ch.instanceId },
              data: { [ch.field as "title"]: ch.newValue ?? "" } as never,
            });
          }
          auditLog({ entityType: "Activity", entityId: ch.instanceId, userId: actorId, action: "template_sync_edit", field: ch.field, oldValue: ch.oldValue ?? null, newValue: ch.newValue ?? null });
          applied += 1;
        }
      }

      else if (ch.kind === "remove" && ch.instanceId) {
        if (ch.entity === "pitstop") {
          // Soft-delete the pitstop. Keep its status as-is so any audit
          // looking at this row sees what state it was in before removal.
          await prisma.pitstop.update({
            where: { id: ch.instanceId },
            data: { deletedAt: new Date() },
          });
          auditLog({ entityType: "Pitstop", entityId: ch.instanceId, userId: actorId, action: "template_sync_remove", /* field omitted */ oldValue: null, newValue: "removed from template" });
          // Cascade-cancel non-Done events under this pitstop. Without this,
          // events linger as orphans on every user's activities calendar even
          // though the parent pitstop is gone — confused user 2026-06-04 when
          // Abdul's activities page kept showing visits that no longer
          // appeared on /visits. Done events stay as historical record.
          const cancelled = await prisma.$executeRaw`
            UPDATE "PitstopEvent"
            SET status = 'Cancelled'::"PitstopEventStatus",
                "cancellationReason" = 'Parent pitstop removed via template sync',
                "updatedAt" = NOW()
            WHERE id IN (
              SELECT pep."eventId"
              FROM "PitstopEventPitstop" pep
              WHERE pep."pitstopId" = ${ch.instanceId}
            )
              AND status NOT IN ('Done'::"PitstopEventStatus", 'Cancelled'::"PitstopEventStatus")
              AND "deletedAt" IS NULL
          `;
          if (cancelled > 0) {
            auditLog({
              entityType: "Pitstop", entityId: ch.instanceId, userId: actorId,
              action: "template_sync_remove_cascade",
              field: "events", oldValue: null,
              newValue: `${cancelled} non-Done event(s) cancelled`,
            });
          }
          applied += 1;
        } else if (ch.entity === "checklistItem") {
          await prisma.$executeRaw`
            UPDATE "ChecklistItem" SET status = 'Cancelled'::"ChecklistItemStatus", "updatedAt" = NOW() WHERE id = ${ch.instanceId}
          `;
          auditLog({ entityType: "Checklist", entityId: ch.instanceId, userId: actorId, action: "template_sync_remove", /* field omitted */ oldValue: null, newValue: "removed from template" });
          applied += 1;
        } else if (ch.entity === "activity") {
          await prisma.$executeRaw`
            UPDATE "PitstopEvent" SET status = 'Cancelled'::"PitstopEventStatus", "cancellationReason" = 'Removed from template', "updatedAt" = NOW() WHERE id = ${ch.instanceId}
          `;
          auditLog({ entityType: "Activity", entityId: ch.instanceId, userId: actorId, action: "template_sync_remove", /* field omitted */ oldValue: null, newValue: "removed from template" });
          applied += 1;
        }
      }
    } catch (e: unknown) {
      // Continue with other changes — sync is best-effort per goal.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[templateSync] change failed", { goalId: goal.id, change: ch, error: msg });
    }
  }

  return applied;
}

function orderRank(c: SyncChange): number {
  // Add pitstops first (others may need their IDs), then everything else.
  if (c.kind === "add" && c.entity === "pitstop") return 0;
  if (c.kind === "add") return 1;
  if (c.kind === "edit") return 2;
  if (c.kind === "remove") return 3;
  return 4;
}
