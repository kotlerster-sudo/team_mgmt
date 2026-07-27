"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getSchoolPlanAccess,
  canEditPlan,
  type SchoolPlanAccess,
} from "@/lib/schoolPlan/access";
import { bootstrapSchoolPlan } from "@/lib/schoolPlan/instantiate";
import { PILOT_SCHOOLS } from "@/lib/schoolPlan/stepTemplate";
import { planCompleteness, type PlanForCompleteness } from "@/lib/schoolPlan/completeness";
import { SCHOOL_PLAN_ROLES, SCHOOL_PLAN_ROLE_BY_KEY } from "@/lib/schoolPlan/roles";
import { rollupStep } from "@/lib/schoolPlan/rollup";
import { weekToDate } from "@/lib/seeding/weeks";
import type {
  SchoolPlanStepStatusValue,
  SchoolServiceStatusValue,
  SchoolComponentDeliveryValue,
  SchoolStaffPayrollValue,
  SchoolPlanStatusValue,
} from "@/lib/schoolPlan/types";

// ---------- Auth helper ----------

async function requireAccess(): Promise<SchoolPlanAccess> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const a = await getSchoolPlanAccess(session);
  if (!a.canAccess) redirect("/portal");
  return a;
}

async function requireEditPlan(planId: string): Promise<SchoolPlanAccess> {
  const a = await requireAccess();
  if (!canEditPlan(a, planId)) {
    throw new Error("Not authorised to edit this plan.");
  }
  return a;
}

async function requireStructure() {
  const a = await requireAccess();
  if (!a.canManageStructure) {
    throw new Error("Not authorised — central lead only.");
  }
  return a;
}

function refreshPlan(planId: string) {
  revalidatePath(`/schools/${planId}`, "layout");
  revalidatePath("/schools");
}

// ---------- Plan CRUD ----------

export async function createPlan(formData: FormData) {
  await requireStructure();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const officialName = String(formData.get("officialName") ?? "").trim() || null;
  const district = String(formData.get("district") ?? "").trim() || null;
  const taluk = String(formData.get("taluk") ?? "").trim() || null;
  const cpd = Number(formData.get("targetChildrenPerDay"));
  const plan = await prisma.schoolPlan.create({
    data: {
      name,
      officialName,
      district,
      taluk,
      targetChildrenPerDay: Number.isFinite(cpd) && cpd > 0 ? Math.round(cpd) : null,
    },
    select: { id: true },
  });
  await bootstrapSchoolPlan(plan.id);
  revalidatePath("/schools");
  redirect(`/schools/${plan.id}`);
}

export async function seedPilotSchools() {
  await requireStructure();
  for (const p of PILOT_SCHOOLS) {
    const exists = await prisma.schoolPlan.findFirst({
      where: { name: p.name, officialName: p.officialName },
      select: { id: true },
    });
    if (exists) continue;
    const plan = await prisma.schoolPlan.create({
      data: {
        name: p.name,
        officialName: p.officialName,
        taluk: p.taluk ?? null,
        district: p.district ?? null,
        targetChildrenPerDay: p.targetChildrenPerDay,
      },
      select: { id: true },
    });
    await bootstrapSchoolPlan(plan.id);
  }
  revalidatePath("/schools");
}

export async function updatePlan(planId: string, patch: Record<string, unknown>) {
  await requireEditPlan(planId);
  // Whitelist only editable fields to avoid mass-assignment.
  const editable = new Set([
    "name","officialName","diseCode","schoolType","addressText","geoLat","geoLng",
    "taluk","district","ward","yearEstablished","grades","sections","mediums",
    "enrolmentBoys","enrolmentGirls","teachersSanctioned","teachersWorking",
    "classroomsCount","otherRoomsCount","timings","shifts","vacationMonths",
    "headTeacherName","headTeacherPhone","sdmcStatus","deptContactName","ourLeadUserId",
    "anchorPartnerId","anchorPartnerName","campusAfterHoursUse","siteAreaSqft","builtupAreaSqft",
    "surveyStatus","targetChildrenPerDay","capacityRead","mobilisationNotes",
    "isInterimStructure","interimStructureSpec",
  ]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (editable.has(k)) data[k] = v;
  }
  await prisma.schoolPlan.update({ where: { id: planId }, data });
  refreshPlan(planId);
}

/** Toggle publicSlug on/off. Central-only. Deterministic slug from plan name. */
export async function togglePublicSlug(planId: string, publish: boolean) {
  await requireStructure();
  const plan = await prisma.schoolPlan.findUnique({
    where: { id: planId },
    select: { name: true, publicSlug: true },
  });
  if (!plan) throw new Error("Plan not found.");
  if (!publish) {
    await prisma.schoolPlan.update({ where: { id: planId }, data: { publicSlug: null } });
  } else if (!plan.publicSlug) {
    const { generateUniquePublicSlug } = await import("@/lib/schoolPlan/publicSlug");
    const slug = await generateUniquePublicSlug(plan.name, planId);
    await prisma.schoolPlan.update({ where: { id: planId }, data: { publicSlug: slug } });
  }
  refreshPlan(planId);
}

export async function deletePlan(planId: string) {
  await requireStructure();
  await prisma.schoolPlan.delete({ where: { id: planId } });
  revalidatePath("/schools");
  redirect("/schools");
}

export async function setPlanStatus(planId: string, status: SchoolPlanStatusValue) {
  await requireEditPlan(planId);
  if (status === "for_review" || status === "approved") {
    const c = await loadPlanForCompleteness(planId);
    const check = planCompleteness(c);
    if (!check.ready) {
      throw new Error(
        `Cannot move to ${status}: ${check.readyCount}/10 sections ready. Missing: ` +
          check.sections.filter((s) => !s.ready).map((s) => `§${s.section} (${s.missing.join(", ")})`).join(" · "),
      );
    }
  }
  await prisma.schoolPlan.update({ where: { id: planId }, data: { planStatus: status } });
  refreshPlan(planId);
}

// ---------- Catchment settlements ----------

export async function addCatchment(planId: string, input: {
  name: string; distanceMeters?: number | null; walkMinutes?: number | null;
  children0to3?: number | null; children3to14?: number | null; children14to18?: number | null;
  existingServices?: string | null;
}) {
  await requireEditPlan(planId);
  const name = input.name?.trim();
  if (!name) throw new Error("Settlement name required.");
  const max = await prisma.schoolPlanCatchment.aggregate({ where: { planId }, _max: { sortOrder: true } });
  await prisma.schoolPlanCatchment.create({
    data: {
      planId,
      name,
      distanceMeters: input.distanceMeters ?? null,
      walkMinutes: input.walkMinutes ?? null,
      children0to3: input.children0to3 ?? null,
      children3to14: input.children3to14 ?? null,
      children14to18: input.children14to18 ?? null,
      existingServices: input.existingServices?.trim() || null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  refreshPlan(planId);
}

export async function updateCatchment(id: string, patch: Record<string, unknown>) {
  const row = await prisma.schoolPlanCatchment.findUnique({ where: { id }, select: { planId: true } });
  if (!row) throw new Error("Not found.");
  await requireEditPlan(row.planId);
  const editable = new Set(["name","distanceMeters","walkMinutes","children0to3","children3to14","children14to18","existingServices"]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (editable.has(k)) data[k] = v;
  await prisma.schoolPlanCatchment.update({ where: { id }, data });
  refreshPlan(row.planId);
}

export async function deleteCatchment(id: string) {
  const row = await prisma.schoolPlanCatchment.findUnique({ where: { id }, select: { planId: true } });
  if (!row) return;
  await requireEditPlan(row.planId);
  await prisma.schoolPlanCatchment.delete({ where: { id } });
  refreshPlan(row.planId);
}

// ---------- Spaces ----------

export async function addSpace(planId: string, input: {
  name: string; building?: string | null; floor?: string | null;
  sizeSqm?: number | null; currentUse?: string | null; proposedUse?: string | null;
  capacityPerSession?: number | null; sessionsPerDay?: number | null;
  changesNeeded?: string | null; structuralFlags?: string | null;
}) {
  await requireEditPlan(planId);
  const name = input.name?.trim();
  if (!name) throw new Error("Space name required.");
  const max = await prisma.schoolPlanSpace.aggregate({ where: { planId }, _max: { sortOrder: true } });
  await prisma.schoolPlanSpace.create({
    data: {
      planId,
      name,
      building: input.building?.trim() || null,
      floor: input.floor?.trim() || null,
      sizeSqm: input.sizeSqm ?? null,
      currentUse: input.currentUse?.trim() || null,
      proposedUse: input.proposedUse?.trim() || null,
      capacityPerSession: input.capacityPerSession ?? null,
      sessionsPerDay: input.sessionsPerDay ?? 1,
      changesNeeded: input.changesNeeded?.trim() || null,
      structuralFlags: input.structuralFlags?.trim() || null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  refreshPlan(planId);
}

export async function updateSpace(id: string, patch: Record<string, unknown>) {
  const row = await prisma.schoolPlanSpace.findUnique({ where: { id }, select: { planId: true } });
  if (!row) throw new Error("Not found.");
  await requireEditPlan(row.planId);
  const editable = new Set(["name","building","floor","sizeSqm","currentUse","proposedUse","capacityPerSession","sessionsPerDay","changesNeeded","structuralFlags"]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (editable.has(k)) data[k] = v;
  await prisma.schoolPlanSpace.update({ where: { id }, data });
  refreshPlan(row.planId);
}

export async function deleteSpace(id: string) {
  const row = await prisma.schoolPlanSpace.findUnique({ where: { id }, select: { planId: true } });
  if (!row) return;
  await requireEditPlan(row.planId);
  await prisma.schoolPlanSpace.delete({ where: { id } });
  refreshPlan(row.planId);
}

// ---------- Services ----------

export async function setServiceStatus(planId: string, item: string, status: SchoolServiceStatusValue, details?: string | null) {
  await requireEditPlan(planId);
  await prisma.schoolPlanService.upsert({
    where: { planId_item: { planId, item } },
    create: { planId, item, status, details: details?.trim() || null },
    update: { status, details: details?.trim() || null },
  });
  refreshPlan(planId);
}

// ---------- Programme components ----------

export async function updateComponent(planId: string, componentKey: string, patch: {
  offerText?: string | null;
  deliveredBy?: SchoolComponentDeliveryValue;
  schedule?: string | null;
  childrenPerDay?: number | null;
  specialistPartnerId?: string | null;
  planVetted?: boolean;
}) {
  await requireEditPlan(planId);
  const existing = await prisma.schoolPlanComponent.findUnique({
    where: { planId_component: { planId, component: componentKey } },
  });
  if (!existing) throw new Error("Component not found — reseed the plan.");
  await prisma.schoolPlanComponent.update({
    where: { id: existing.id },
    data: {
      offerText: patch.offerText !== undefined ? (patch.offerText?.trim() || null) : undefined,
      deliveredBy: patch.deliveredBy,
      schedule: patch.schedule !== undefined ? (patch.schedule?.trim() || null) : undefined,
      childrenPerDay: patch.childrenPerDay,
      specialistPartnerId: patch.specialistPartnerId !== undefined ? (patch.specialistPartnerId?.trim() || null) : undefined,
      planVetted: patch.planVetted,
    },
  });
  refreshPlan(planId);
}

// ---------- Staffing ----------

export async function addStaffing(planId: string, input: {
  role: string; count: number; payroll: SchoolStaffPayrollValue; notes?: string | null;
}) {
  await requireEditPlan(planId);
  const role = input.role?.trim();
  if (!role) throw new Error("Role required.");
  const max = await prisma.schoolPlanStaffing.aggregate({ where: { planId }, _max: { sortOrder: true } });
  await prisma.schoolPlanStaffing.create({
    data: {
      planId, role, count: input.count, payroll: input.payroll,
      notes: input.notes?.trim() || null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  refreshPlan(planId);
}

export async function updateStaffing(id: string, patch: Record<string, unknown>) {
  const row = await prisma.schoolPlanStaffing.findUnique({ where: { id }, select: { planId: true } });
  if (!row) throw new Error("Not found.");
  await requireEditPlan(row.planId);
  const editable = new Set(["role","count","payroll","status","notes"]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (editable.has(k)) data[k] = v;
  await prisma.schoolPlanStaffing.update({ where: { id }, data });
  refreshPlan(row.planId);
}

export async function deleteStaffing(id: string) {
  const row = await prisma.schoolPlanStaffing.findUnique({ where: { id }, select: { planId: true } });
  if (!row) return;
  await requireEditPlan(row.planId);
  await prisma.schoolPlanStaffing.delete({ where: { id } });
  refreshPlan(row.planId);
}

// ---------- Milestones ----------

export async function addMilestone(planId: string, input: {
  name: string; targetDate?: string | null; dependsOn?: string | null;
}) {
  await requireEditPlan(planId);
  const name = input.name?.trim();
  if (!name) throw new Error("Milestone name required.");
  const max = await prisma.schoolPlanMilestone.aggregate({ where: { planId }, _max: { sortOrder: true } });
  await prisma.schoolPlanMilestone.create({
    data: {
      planId, name,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      dependsOn: input.dependsOn?.trim() || null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  refreshPlan(planId);
}

export async function updateMilestone(id: string, patch: { name?: string; targetDate?: string | null; dependsOn?: string | null; status?: string }) {
  const row = await prisma.schoolPlanMilestone.findUnique({ where: { id }, select: { planId: true } });
  if (!row) throw new Error("Not found.");
  await requireEditPlan(row.planId);
  await prisma.schoolPlanMilestone.update({
    where: { id },
    data: {
      name: patch.name?.trim(),
      targetDate: patch.targetDate === undefined ? undefined : (patch.targetDate ? new Date(patch.targetDate) : null),
      dependsOn: patch.dependsOn === undefined ? undefined : (patch.dependsOn?.trim() || null),
      status: patch.status,
    },
  });
  refreshPlan(row.planId);
}

export async function deleteMilestone(id: string) {
  const row = await prisma.schoolPlanMilestone.findUnique({ where: { id }, select: { planId: true } });
  if (!row) return;
  await requireEditPlan(row.planId);
  await prisma.schoolPlanMilestone.delete({ where: { id } });
  refreshPlan(row.planId);
}

// ---------- Risks ----------

export async function addRisk(planId: string, input: {
  description: string; mitigation?: string | null; ownerUserId?: string | null;
}) {
  await requireEditPlan(planId);
  const description = input.description?.trim();
  if (!description) throw new Error("Description required.");
  const max = await prisma.schoolPlanRisk.aggregate({ where: { planId }, _max: { sortOrder: true } });
  await prisma.schoolPlanRisk.create({
    data: {
      planId, description,
      mitigation: input.mitigation?.trim() || null,
      ownerUserId: input.ownerUserId || null,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  refreshPlan(planId);
}

export async function updateRisk(id: string, patch: Record<string, unknown>) {
  const row = await prisma.schoolPlanRisk.findUnique({ where: { id }, select: { planId: true } });
  if (!row) throw new Error("Not found.");
  await requireEditPlan(row.planId);
  const editable = new Set(["description","mitigation","ownerUserId","status"]);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (editable.has(k)) data[k] = v;
  await prisma.schoolPlanRisk.update({ where: { id }, data });
  refreshPlan(row.planId);
}

export async function deleteRisk(id: string) {
  const row = await prisma.schoolPlanRisk.findUnique({ where: { id }, select: { planId: true } });
  if (!row) return;
  await requireEditPlan(row.planId);
  await prisma.schoolPlanRisk.delete({ where: { id } });
  refreshPlan(row.planId);
}

// ---------- Steps ----------

export async function setStepStatus(stepId: string, status: SchoolPlanStepStatusValue, blockingNote?: string) {
  const step = await prisma.schoolPlanStep.findUnique({
    where: { id: stepId },
    select: { planId: true, _count: { select: { substeps: true } } },
  });
  if (!step) throw new Error("Step not found.");
  if (step._count.substeps > 0) {
    throw new Error("Step status is rolled up from substeps — edit the substeps instead.");
  }
  const a = await requireEditPlan(step.planId);
  const completed = status === "done"
    ? { completedAt: new Date(), completedById: a.userId ?? null }
    : { completedAt: null, completedById: null };
  await prisma.schoolPlanStep.update({
    where: { id: stepId },
    data: {
      status,
      blockingNote: status === "blocked" ? (blockingNote?.trim() || null) : null,
      ...completed,
    },
  });
  refreshPlan(step.planId);
}

export async function setStepOwner(stepId: string, ownerUserId: string | null) {
  const step = await prisma.schoolPlanStep.findUnique({ where: { id: stepId }, select: { planId: true } });
  if (!step) throw new Error("Step not found.");
  await requireEditPlan(step.planId);
  await prisma.schoolPlanStep.update({ where: { id: stepId }, data: { ownerUserId: ownerUserId || null } });
  refreshPlan(step.planId);
}

export async function setStepDueDate(stepId: string, iso: string | null) {
  const step = await prisma.schoolPlanStep.findUnique({ where: { id: stepId }, select: { planId: true } });
  if (!step) throw new Error("Step not found.");
  await requireEditPlan(step.planId);
  // Direct date pick clears dueWeek — user intent is now absolute, not week-relative.
  await prisma.schoolPlanStep.update({
    where: { id: stepId },
    data: { dueDate: iso ? new Date(iso) : null, dueWeek: null },
  });
  refreshPlan(step.planId);
}

// ---------- Path C: role owner + week model ----------

function validateOwnerRoleKey(role: string | null): string | null {
  if (!role) return null;
  if (!SCHOOL_PLAN_ROLE_BY_KEY[role]) {
    throw new Error(`Unknown owner role: ${role}`);
  }
  return role;
}

const MIN_DUE_WEEK = -12;
const MAX_DUE_WEEK = 260; // 5 years post-launch — plenty for pilots

function validateDueWeek(week: number | null): number | null {
  if (week === null || week === undefined) return null;
  if (!Number.isInteger(week)) throw new Error("dueWeek must be an integer.");
  if (week < MIN_DUE_WEEK || week > MAX_DUE_WEEK) {
    throw new Error(`dueWeek out of range (${MIN_DUE_WEEK}..${MAX_DUE_WEEK}).`);
  }
  return week;
}

export async function setStepOwnerRole(stepId: string, role: string | null) {
  const step = await prisma.schoolPlanStep.findUnique({
    where: { id: stepId },
    select: { planId: true, _count: { select: { substeps: true } } },
  });
  if (!step) throw new Error("Step not found.");
  if (step._count.substeps > 0) {
    // Owner-role on a rolled-up step would be misleading — the header is a
    // union across substeps. Force the assignment down to a substep instead.
    throw new Error("Step ownership is rolled up from substeps — assign the role on a substep.");
  }
  await requireEditPlan(step.planId);
  await prisma.schoolPlanStep.update({
    where: { id: stepId },
    data: { ownerRole: validateOwnerRoleKey(role) },
  });
  refreshPlan(step.planId);
}

export async function setSubstepOwnerRole(substepId: string, role: string | null) {
  const sub = await prisma.schoolPlanSubstep.findUnique({
    where: { id: substepId },
    select: { step: { select: { planId: true } } },
  });
  if (!sub) throw new Error("Substep not found.");
  await requireEditPlan(sub.step.planId);
  await prisma.schoolPlanSubstep.update({
    where: { id: substepId },
    data: { ownerRole: validateOwnerRoleKey(role) },
  });
  refreshPlan(sub.step.planId);
}

export async function setStepDueWeek(stepId: string, week: number | null) {
  const step = await prisma.schoolPlanStep.findUnique({
    where: { id: stepId },
    select: { planId: true, plan: { select: { launchDate: true } }, _count: { select: { substeps: true } } },
  });
  if (!step) throw new Error("Step not found.");
  if (step._count.substeps > 0) {
    throw new Error("Step due date is rolled up from substeps — set the week on a substep.");
  }
  await requireEditPlan(step.planId);
  const w = validateDueWeek(week);
  if (w !== null && !step.plan.launchDate) {
    throw new Error("Set the plan's launch date before scheduling by week.");
  }
  await prisma.schoolPlanStep.update({
    where: { id: stepId },
    data: {
      dueWeek: w,
      dueDate: w !== null && step.plan.launchDate ? weekToDate(step.plan.launchDate, w) : null,
    },
  });
  refreshPlan(step.planId);
}

export async function setSubstepDueWeek(substepId: string, week: number | null) {
  const sub = await prisma.schoolPlanSubstep.findUnique({
    where: { id: substepId },
    select: { step: { select: { planId: true, plan: { select: { launchDate: true } } } } },
  });
  if (!sub) throw new Error("Substep not found.");
  await requireEditPlan(sub.step.planId);
  const w = validateDueWeek(week);
  if (w !== null && !sub.step.plan.launchDate) {
    throw new Error("Set the plan's launch date before scheduling by week.");
  }
  await prisma.schoolPlanSubstep.update({
    where: { id: substepId },
    data: {
      dueWeek: w,
      dueDate: w !== null && sub.step.plan.launchDate ? weekToDate(sub.step.plan.launchDate, w) : null,
    },
  });
  refreshPlan(sub.step.planId);
}

export async function setSubstepDueDate(substepId: string, iso: string | null) {
  const sub = await prisma.schoolPlanSubstep.findUnique({
    where: { id: substepId },
    select: { step: { select: { planId: true } } },
  });
  if (!sub) throw new Error("Substep not found.");
  await requireEditPlan(sub.step.planId);
  // Absolute date wins → clear dueWeek so intent isn't stale.
  await prisma.schoolPlanSubstep.update({
    where: { id: substepId },
    data: { dueDate: iso ? new Date(iso) : null, dueWeek: null },
  });
  refreshPlan(sub.step.planId);
}

export async function setPlanLaunchDate(planId: string, iso: string | null) {
  await requireEditPlan(planId);
  const newLaunch = iso ? new Date(iso) : null;
  await prisma.$transaction(async (tx) => {
    await tx.schoolPlan.update({ where: { id: planId }, data: { launchDate: newLaunch } });
    if (!newLaunch) return; // Setting to null leaves existing dueDates as-is (they become standalone).
    // Cascade: recompute dueDate for every step + substep on this plan that
    // carries a dueWeek intent.
    const steps = await tx.schoolPlanStep.findMany({
      where: { planId, dueWeek: { not: null } },
      select: { id: true, dueWeek: true },
    });
    for (const s of steps) {
      await tx.schoolPlanStep.update({
        where: { id: s.id },
        data: { dueDate: weekToDate(newLaunch, s.dueWeek!) },
      });
    }
    const subs = await tx.schoolPlanSubstep.findMany({
      where: { step: { planId }, dueWeek: { not: null } },
      select: { id: true, dueWeek: true },
    });
    for (const ss of subs) {
      await tx.schoolPlanSubstep.update({
        where: { id: ss.id },
        data: { dueDate: weekToDate(newLaunch, ss.dueWeek!) },
      });
    }
  });
  refreshPlan(planId);
}

// ---------- Categories (grouping layer above steps) ----------

export async function addCategory(planId: string, input: { title: string; description?: string | null }) {
  await requireEditPlan(planId);
  const title = input.title.trim();
  if (!title) throw new Error("Title is required.");
  const last = await prisma.schoolPlanCategory.findFirst({
    where: { planId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await prisma.schoolPlanCategory.create({
    data: {
      planId,
      // key null → identifies a user-added category (vs seeded, which carries a slug)
      title,
      description: input.description?.trim() || null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  refreshPlan(planId);
  return created;
}

export async function renameCategory(categoryId: string, patch: { title?: string; description?: string | null }) {
  const cat = await prisma.schoolPlanCategory.findUnique({
    where: { id: categoryId },
    select: { planId: true },
  });
  if (!cat) throw new Error("Category not found.");
  await requireEditPlan(cat.planId);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw new Error("Title is required.");
    data.title = t;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (Object.keys(data).length === 0) return;
  await prisma.schoolPlanCategory.update({ where: { id: categoryId }, data });
  refreshPlan(cat.planId);
}

export async function deleteCategory(categoryId: string) {
  const cat = await prisma.schoolPlanCategory.findUnique({
    where: { id: categoryId },
    select: { planId: true, _count: { select: { steps: true } } },
  });
  if (!cat) throw new Error("Category not found.");
  await requireEditPlan(cat.planId);
  if (cat._count.steps > 0) {
    throw new Error("Move or delete this category's steps first.");
  }
  await prisma.schoolPlanCategory.delete({ where: { id: categoryId } });
  refreshPlan(cat.planId);
}

/** Reorder categories on a plan. `orderedIds` is the full new order —
 *  ids not on this plan are rejected. */
export async function reorderCategories(planId: string, orderedIds: string[]) {
  await requireEditPlan(planId);
  const cats = await prisma.schoolPlanCategory.findMany({
    where: { planId },
    select: { id: true },
  });
  const known = new Set(cats.map((c) => c.id));
  const clean = orderedIds.filter((id) => known.has(id));
  await prisma.$transaction(
    clean.map((id, idx) =>
      prisma.schoolPlanCategory.update({
        where: { id },
        data: { sortOrder: idx + 1 },
      }),
    ),
  );
  refreshPlan(planId);
}

// ---------- Steps: create / edit / delete / move ----------

export async function addStep(planId: string, input: {
  categoryId: string;
  title: string;
  description?: string | null;
  planSection?: string | null;
  requiredArtifactType?: string | null;
  blocksSignoff?: boolean;
  ownerUserId?: string | null;
  ownerRole?: string | null;
  dueDate?: string | null;
  dueWeek?: number | null;
}) {
  await requireEditPlan(planId);
  const title = input.title.trim();
  if (!title) throw new Error("Title is required.");
  const cat = await prisma.schoolPlanCategory.findFirst({
    where: { id: input.categoryId, planId },
    select: { id: true },
  });
  if (!cat) throw new Error("Category not found on this plan.");
  const w = validateDueWeek(input.dueWeek ?? null);
  if (w !== null) {
    const plan = await prisma.schoolPlan.findUnique({ where: { id: planId }, select: { launchDate: true } });
    if (!plan?.launchDate) throw new Error("Set the plan's launch date before scheduling by week.");
  }
  const [maxStepNo, maxSort] = await Promise.all([
    prisma.schoolPlanStep.findFirst({
      where: { planId },
      orderBy: { stepNo: "desc" },
      select: { stepNo: true },
    }),
    prisma.schoolPlanStep.findFirst({
      where: { planId, categoryId: input.categoryId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    }),
  ]);
  const plan = w !== null ? await prisma.schoolPlan.findUnique({ where: { id: planId }, select: { launchDate: true } }) : null;
  const created = await prisma.schoolPlanStep.create({
    data: {
      planId,
      categoryId: input.categoryId,
      // key null → user-added, distinguishes from template-provenance rows
      stepNo: (maxStepNo?.stepNo ?? 0) + 1,
      sortOrder: (maxSort?.sortOrder ?? 0) + 1,
      title,
      description: input.description?.trim() || null,
      planSection: input.planSection?.trim() || null,
      requiredArtifactType: input.requiredArtifactType?.trim() || null,
      // Default true — a new step matters until the user says otherwise.
      blocksSignoff: input.blocksSignoff ?? true,
      ownerUserId: input.ownerUserId || null,
      ownerRole: validateOwnerRoleKey(input.ownerRole ?? null),
      dueDate: w !== null && plan?.launchDate
        ? weekToDate(plan.launchDate, w)
        : input.dueDate ? new Date(input.dueDate) : null,
      dueWeek: w,
    },
  });
  refreshPlan(planId);
  return created;
}

export async function updateStep(stepId: string, patch: {
  title?: string;
  description?: string | null;
  planSection?: string | null;
  requiredArtifactType?: string | null;
  blocksSignoff?: boolean;
  categoryId?: string;
}) {
  const step = await prisma.schoolPlanStep.findUnique({
    where: { id: stepId },
    select: { planId: true, categoryId: true },
  });
  if (!step) throw new Error("Step not found.");
  await requireEditPlan(step.planId);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw new Error("Title is required.");
    data.title = t;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.planSection !== undefined) data.planSection = patch.planSection?.trim() || null;
  if (patch.requiredArtifactType !== undefined) data.requiredArtifactType = patch.requiredArtifactType?.trim() || null;
  if (patch.blocksSignoff !== undefined) data.blocksSignoff = patch.blocksSignoff;
  if (patch.categoryId !== undefined && patch.categoryId !== step.categoryId) {
    const cat = await prisma.schoolPlanCategory.findFirst({
      where: { id: patch.categoryId, planId: step.planId },
      select: { id: true },
    });
    if (!cat) throw new Error("Target category not found on this plan.");
    data.categoryId = patch.categoryId;
    // Drop to the bottom of the target category so the move is visible + safe.
    const last = await prisma.schoolPlanStep.findFirst({
      where: { planId: step.planId, categoryId: patch.categoryId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    data.sortOrder = (last?.sortOrder ?? 0) + 1;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.schoolPlanStep.update({ where: { id: stepId }, data });
  refreshPlan(step.planId);
}

export async function deleteStep(stepId: string) {
  const step = await prisma.schoolPlanStep.findUnique({
    where: { id: stepId },
    select: { planId: true, _count: { select: { artifacts: true } } },
  });
  if (!step) throw new Error("Step not found.");
  await requireEditPlan(step.planId);
  if (step._count.artifacts > 0) {
    throw new Error("Detach or delete this step's artifacts first.");
  }
  // Substeps cascade via the FK; artifacts don't (they carry evidence and
  // deserve an explicit user decision).
  await prisma.schoolPlanStep.delete({ where: { id: stepId } });
  refreshPlan(step.planId);
}

/** Reorder steps within a category. `orderedIds` is the new order for exactly
 *  one category — steps from other categories on the list are ignored. */
export async function reorderStepsInCategory(planId: string, categoryId: string, orderedIds: string[]) {
  await requireEditPlan(planId);
  const steps = await prisma.schoolPlanStep.findMany({
    where: { planId, categoryId },
    select: { id: true },
  });
  const known = new Set(steps.map((s) => s.id));
  const clean = orderedIds.filter((id) => known.has(id));
  await prisma.$transaction(
    clean.map((id, idx) =>
      prisma.schoolPlanStep.update({
        where: { id },
        data: { sortOrder: idx + 1 },
      }),
    ),
  );
  refreshPlan(planId);
}

// ---------- Substeps ----------

export async function addSubstep(stepId: string, input: {
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  ownerRole?: string | null;
  dueDate?: string | null;
  dueWeek?: number | null;
}) {
  const step = await prisma.schoolPlanStep.findUnique({
    where: { id: stepId },
    select: { planId: true, plan: { select: { launchDate: true } } },
  });
  if (!step) throw new Error("Step not found.");
  await requireEditPlan(step.planId);
  const title = input.title.trim();
  if (!title) throw new Error("Title is required.");
  const w = validateDueWeek(input.dueWeek ?? null);
  if (w !== null && !step.plan.launchDate) {
    throw new Error("Set the plan's launch date before scheduling by week.");
  }
  const derivedDueDate = w !== null && step.plan.launchDate
    ? weekToDate(step.plan.launchDate, w)
    : input.dueDate ? new Date(input.dueDate) : null;
  const last = await prisma.schoolPlanSubstep.findFirst({
    where: { stepId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const substep = await prisma.$transaction(async (tx) => {
    const created = await tx.schoolPlanSubstep.create({
      data: {
        stepId,
        position: (last?.position ?? -1) + 1,
        title,
        description: input.description?.trim() || null,
        ownerUserId: input.ownerUserId || null,
        ownerRole: validateOwnerRoleKey(input.ownerRole ?? null),
        dueDate: derivedDueDate,
        dueWeek: w,
      },
    });
    // Adding the first substep flips the parent into rolled-up mode; recompute
    // so its chip reflects the fresh (pending) substep set rather than any
    // stale self-owned status.
    await rollupStep(tx, stepId, null);
    return created;
  });
  refreshPlan(step.planId);
  return substep;
}

export async function updateSubstep(substepId: string, patch: {
  title?: string;
  description?: string | null;
  ownerUserId?: string | null;
  ownerRole?: string | null;
  dueDate?: string | null;
  blockingNote?: string | null;
  position?: number;
}) {
  const sub = await prisma.schoolPlanSubstep.findUnique({
    where: { id: substepId },
    select: { stepId: true, step: { select: { planId: true } } },
  });
  if (!sub) throw new Error("Substep not found.");
  await requireEditPlan(sub.step.planId);
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw new Error("Title is required.");
    data.title = t;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.ownerUserId !== undefined) data.ownerUserId = patch.ownerUserId || null;
  if (patch.ownerRole !== undefined) data.ownerRole = validateOwnerRoleKey(patch.ownerRole);
  if (patch.dueDate !== undefined) {
    // Direct date pick via updateSubstep clears dueWeek (mirrors setSubstepDueDate).
    data.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    data.dueWeek = null;
  }
  if (patch.blockingNote !== undefined) data.blockingNote = patch.blockingNote?.trim() || null;
  if (patch.position !== undefined) data.position = patch.position;
  await prisma.schoolPlanSubstep.update({ where: { id: substepId }, data });
  refreshPlan(sub.step.planId);
}

export async function setSubstepStatus(
  substepId: string,
  status: SchoolPlanStepStatusValue,
  blockingNote?: string,
) {
  const sub = await prisma.schoolPlanSubstep.findUnique({
    where: { id: substepId },
    select: { stepId: true, step: { select: { planId: true } } },
  });
  if (!sub) throw new Error("Substep not found.");
  const a = await requireEditPlan(sub.step.planId);
  const completed = status === "done"
    ? { completedAt: new Date(), completedById: a.userId ?? null }
    : { completedAt: null, completedById: null };
  await prisma.$transaction(async (tx) => {
    await tx.schoolPlanSubstep.update({
      where: { id: substepId },
      data: {
        status,
        blockingNote: status === "blocked" ? (blockingNote?.trim() || null) : null,
        ...completed,
      },
    });
    await rollupStep(tx, sub.stepId, a.userId ?? null);
  });
  refreshPlan(sub.step.planId);
}

export async function deleteSubstep(substepId: string) {
  const sub = await prisma.schoolPlanSubstep.findUnique({
    where: { id: substepId },
    select: { stepId: true, step: { select: { planId: true } } },
  });
  if (!sub) throw new Error("Substep not found.");
  await requireEditPlan(sub.step.planId);
  await prisma.$transaction(async (tx) => {
    await tx.schoolPlanSubstep.delete({ where: { id: substepId } });
    // If this was the last substep, rollupStep is a no-op and the step keeps
    // whatever status it had. That's intended — it re-enters self-owned mode.
    await rollupStep(tx, sub.stepId, null);
  });
  refreshPlan(sub.step.planId);
}

// ---------- Signoff ----------

export async function upsertSignoff(planId: string, patch: {
  markPrepared?: boolean;
  markReviewed?: boolean;
  markApproved?: boolean;
  reviewerNotes?: string | null;
  approvalNotes?: string | null;
}) {
  const a = await requireEditPlan(planId);
  const now = new Date();
  await prisma.schoolPlanSignoff.upsert({
    where: { planId },
    create: {
      planId,
      preparedAt: patch.markPrepared ? now : null,
      preparedById: patch.markPrepared ? a.userId : null,
      reviewedAt: patch.markReviewed ? now : null,
      reviewedById: patch.markReviewed ? a.userId : null,
      reviewerNotes: patch.reviewerNotes?.trim() || null,
      approvedAt: patch.markApproved ? now : null,
      approvedById: patch.markApproved ? a.userId : null,
      approvalNotes: patch.approvalNotes?.trim() || null,
    },
    update: {
      preparedAt: patch.markPrepared ? now : undefined,
      preparedById: patch.markPrepared ? a.userId : undefined,
      reviewedAt: patch.markReviewed ? now : undefined,
      reviewedById: patch.markReviewed ? a.userId : undefined,
      reviewerNotes: patch.reviewerNotes === undefined ? undefined : (patch.reviewerNotes?.trim() || null),
      approvedAt: patch.markApproved ? now : undefined,
      approvedById: patch.markApproved ? a.userId : undefined,
      approvalNotes: patch.approvalNotes === undefined ? undefined : (patch.approvalNotes?.trim() || null),
    },
  });
  refreshPlan(planId);
}

// ---------- Members (admin) ----------

export async function addMember(input: { userEmail: string; role: string; planId: string | null }) {
  await requireStructure();
  const email = input.userEmail?.trim().toLowerCase();
  if (!email) throw new Error("Email required.");
  if (!SCHOOL_PLAN_ROLES.some((r) => r.key === input.role)) throw new Error("Unknown role.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}.`);
  const planId = input.planId ?? null;
  // Compound-unique reference doesn't work through Prisma when one key is
  // nullable — use findFirst + create instead.
  const existing = await prisma.schoolPlanMember.findFirst({
    where: { userId: user.id, role: input.role, planId },
    select: { id: true },
  });
  if (!existing) {
    await prisma.schoolPlanMember.create({ data: { userId: user.id, role: input.role, planId } });
  }
  revalidatePath("/schools/admin/members");
}

export async function removeMember(id: string) {
  await requireStructure();
  await prisma.schoolPlanMember.delete({ where: { id } });
  revalidatePath("/schools/admin/members");
}

// ---------- Completeness helper (shared by pages) ----------

export async function loadPlanForCompleteness(planId: string): Promise<PlanForCompleteness> {
  const plan = await prisma.schoolPlan.findUnique({
    where: { id: planId },
    include: {
      steps: {
        select: {
          stepNo: true, title: true, status: true,
          planSection: true, requiredArtifactType: true, blocksSignoff: true,
        },
      },
      _count: {
        select: {
          settlements: true, spaces: true, staffing: true, milestones: true, risks: true,
        },
      },
      services: { select: { status: true } },
      components: { select: { offerText: true } },
      artifacts: { select: { kind: true } },
      signoff: { select: { approvedAt: true } },
    },
  });
  if (!plan) throw new Error("Plan not found.");
  const artifactsByKind: Record<string, number> = {};
  for (const a of plan.artifacts) artifactsByKind[a.kind] = (artifactsByKind[a.kind] ?? 0) + 1;
  return {
    id: plan.id,
    name: plan.name,
    officialName: plan.officialName,
    district: plan.district,
    headTeacherName: plan.headTeacherName,
    enrolmentBoys: plan.enrolmentBoys,
    enrolmentGirls: plan.enrolmentGirls,
    targetChildrenPerDay: plan.targetChildrenPerDay,
    siteAreaSqft: plan.siteAreaSqft,
    builtupAreaSqft: plan.builtupAreaSqft,
    surveyStatus: plan.surveyStatus,
    capacityRead: plan.capacityRead,
    mobilisationNotes: plan.mobilisationNotes,
    budgetId: plan.budgetId,
    ourLeadUserId: plan.ourLeadUserId,
    anchorPartnerName: plan.anchorPartnerName,
    steps: plan.steps.map((s) => ({
      stepNo: s.stepNo,
      title: s.title,
      status: s.status as SchoolPlanStepStatusValue,
      planSection: s.planSection,
      requiredArtifactType: s.requiredArtifactType,
      blocksSignoff: s.blocksSignoff,
    })),
    settlementsCount: plan._count.settlements,
    spacesCount: plan._count.spaces,
    servicesAssessedCount: plan.services.filter((s) => s.status !== "unknown").length,
    componentsWithOfferCount: plan.components.filter((c) => (c.offerText ?? "").trim().length > 0).length,
    staffingCount: plan._count.staffing,
    milestonesCount: plan._count.milestones,
    risksCount: plan._count.risks,
    artifactsByKind,
    signoffApproved: !!plan.signoff?.approvedAt,
  };
}
