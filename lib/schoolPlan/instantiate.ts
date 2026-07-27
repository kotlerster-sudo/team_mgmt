import prisma from "@/lib/prisma";
import {
  SCHOOL_PLAN_CATEGORIES,
  SCHOOL_PLAN_STEPS,
  SERVICE_ITEMS,
  PROGRAMME_COMPONENTS,
} from "./stepTemplate";

/** Idempotent: seeds the 6 default categories for a plan. Categories are then
 *  DB-owned — users can rename/reorder/add/delete freely per plan. Matching by
 *  `key` means re-runs only add categories the plan doesn't already carry. */
export async function ensureSchoolPlanCategories(planId: string): Promise<number> {
  const existing = await prisma.schoolPlanCategory.findMany({
    where: { planId, key: { not: null } },
    select: { key: true },
  });
  const have = new Set(existing.map((r) => r.key).filter((k): k is string => !!k));
  const missing = SCHOOL_PLAN_CATEGORIES.filter((c) => !have.has(c.key));
  if (missing.length === 0) return 0;
  await prisma.schoolPlanCategory.createMany({
    data: missing.map((c) => ({
      planId,
      key: c.key,
      title: c.title,
      description: c.description ?? null,
      sortOrder: c.sortOrder,
    })),
    skipDuplicates: true,
  });
  return missing.length;
}

/** Idempotent: creates any missing step rows from the template, wiring each to
 *  its seeded category. Safe to re-run after a template edit that only adds
 *  new steps. Requires ensureSchoolPlanCategories to have run first — steps
 *  whose categoryKey doesn't resolve to a seeded row are skipped. */
export async function ensureSchoolPlanSteps(planId: string): Promise<number> {
  const [existing, categories] = await Promise.all([
    prisma.schoolPlanStep.findMany({ where: { planId }, select: { stepNo: true } }),
    prisma.schoolPlanCategory.findMany({
      where: { planId, key: { not: null } },
      select: { id: true, key: true },
    }),
  ]);
  const have = new Set(existing.map((r) => r.stepNo));
  const catIdByKey = new Map(
    categories.map((c) => [c.key ?? "", c.id] as const).filter(([k]) => k),
  );
  const missing = SCHOOL_PLAN_STEPS.filter((s) => !have.has(s.stepNo));
  if (missing.length === 0) return 0;
  // Per-category sortOrder starts from (existing max within that category) + 1
  // so re-seeding into a plan that already has custom steps doesn't collide.
  const usedSort = await prisma.schoolPlanStep.groupBy({
    by: ["categoryId"],
    where: { planId, categoryId: { in: Array.from(catIdByKey.values()) } },
    _max: { sortOrder: true },
  });
  const nextSort = new Map<string, number>(
    usedSort.map((r) => [r.categoryId ?? "", (r._max.sortOrder ?? 0) + 1]),
  );
  const rows = missing
    .map((s) => {
      const categoryId = catIdByKey.get(s.categoryKey) ?? null;
      if (!categoryId) return null;
      const sortOrder = nextSort.get(categoryId) ?? 1;
      nextSort.set(categoryId, sortOrder + 1);
      return {
        planId,
        categoryId,
        stepNo: s.stepNo,
        sortOrder,
        key: s.key,
        title: s.title,
        description: s.description,
        planSection: s.planSection,
        requiredArtifactType: s.requiredArtifactType,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return 0;
  await prisma.schoolPlanStep.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

/** Idempotent: seeds the 8 default service checklist rows in `unknown` state. */
export async function ensureSchoolPlanServices(planId: string): Promise<number> {
  const existing = await prisma.schoolPlanService.findMany({
    where: { planId },
    select: { item: true },
  });
  const have = new Set(existing.map((r) => r.item));
  const missing = SERVICE_ITEMS.filter((s) => !have.has(s.key));
  if (missing.length === 0) return 0;
  await prisma.schoolPlanService.createMany({
    data: missing.map((s) => ({ planId, item: s.key })),
    skipDuplicates: true,
  });
  return missing.length;
}

/** Idempotent: seeds the 8 programme-component rows with the ownership-matrix
 *  defaults. Users override `deliveredBy` per plan. */
export async function ensureSchoolPlanComponents(planId: string): Promise<number> {
  const existing = await prisma.schoolPlanComponent.findMany({
    where: { planId },
    select: { component: true },
  });
  const have = new Set(existing.map((r) => r.component));
  const missing = PROGRAMME_COMPONENTS.filter((c) => !have.has(c.key));
  if (missing.length === 0) return 0;
  await prisma.schoolPlanComponent.createMany({
    data: missing.map((c, idx) => ({
      planId,
      component: c.key,
      deliveredBy: c.defaultDelivery,
      sortOrder: idx,
    })),
    skipDuplicates: true,
  });
  return missing.length;
}

/** Run all ensurers in sequence. Called from School.create action + seed
 *  script. Categories must precede steps (steps FK into categories). */
export async function bootstrapSchoolPlan(planId: string): Promise<{
  categoriesAdded: number;
  stepsAdded: number;
  servicesAdded: number;
  componentsAdded: number;
}> {
  const categoriesAdded = await ensureSchoolPlanCategories(planId);
  const stepsAdded = await ensureSchoolPlanSteps(planId);
  const servicesAdded = await ensureSchoolPlanServices(planId);
  const componentsAdded = await ensureSchoolPlanComponents(planId);
  return { categoriesAdded, stepsAdded, servicesAdded, componentsAdded };
}
