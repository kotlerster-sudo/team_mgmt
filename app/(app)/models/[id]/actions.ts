"use server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext, can } from "@/lib/rbac";
import { isAdminUser } from "@/lib/roleGuard";
import { revalidatePath } from "next/cache";
import type { InstanceInputs } from "@/lib/models/types";

/**
 * Resolve RBAC for a mutation and assert the user can act on this instance.
 * Returns the (loaded) instance for convenience.
 *
 * OWN scope rule for member: createdById must match. Orphaned instances
 * (createdById = null — e.g. seeded ones) are treated as community-owned and
 * mutable by any authenticated user with the permission.
 */
async function authorizeInstance(instanceId: string, action: "update" | "delete" | "promote_to_budget") {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const ctx = await buildRbacContext(session);
  if (!(await can(ctx, "operating_model", action))) throw new Error("Forbidden");

  const inst = await prisma.modelInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, createdById: true, templateId: true, name: true, pitstopId: true, scenarioName: true, parentInstanceId: true, inputsJson: true },
  });
  if (!inst) throw new Error("Instance not found");

  const isAdmin = isAdminUser(session);
  const isOwner = inst.createdById === session.user.id;
  const isOrphan = inst.createdById === null;
  if (!isAdmin && !isOwner && !isOrphan) throw new Error("Forbidden");

  return { session, ctx, inst };
}

/** Save sparse input overrides for a model instance. Empty values delete the override. */
export async function saveInstanceInputs(instanceId: string, inputs: InstanceInputs) {
  await authorizeInstance(instanceId, "update");

  const sanitized: InstanceInputs = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      sanitized[k] = v;
    } else if (Array.isArray(v) && v.every(n => typeof n === "number")) {
      sanitized[k] = v;
    }
  }

  await prisma.modelInstance.update({
    where: { id: instanceId },
    data: { inputsJson: sanitized },
  });
  revalidatePath(`/models/${instanceId}`);
  return { ok: true };
}

/** Rename a model instance. */
export async function renameInstance(instanceId: string, name: string) {
  await authorizeInstance(instanceId, "update");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name cannot be empty");
  await prisma.modelInstance.update({ where: { id: instanceId }, data: { name: trimmed } });
  revalidatePath(`/models/${instanceId}`);
}

/** Fork an instance as a sibling scenario, copying current inputs. */
export async function forkScenario(instanceId: string, scenarioName: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const ctx = await buildRbacContext(session);
  if (!(await can(ctx, "operating_model", "create"))) throw new Error("Forbidden");

  const src = await prisma.modelInstance.findUnique({ where: { id: instanceId } });
  if (!src) throw new Error("Instance not found");

  const parentId = src.parentInstanceId ?? src.id;
  const child = await prisma.modelInstance.create({
    data: {
      templateId: src.templateId,
      name: `${src.name} — ${scenarioName}`,
      parentInstanceId: parentId,
      scenarioName,
      pitstopId: src.pitstopId,
      inputsJson: src.inputsJson ?? {},
      createdById: session.user.id,
    },
  });
  revalidatePath(`/models/${instanceId}`);
  return { id: child.id };
}

/** Delete a model instance. */
export async function deleteInstance(instanceId: string) {
  await authorizeInstance(instanceId, "delete");
  await prisma.modelInstance.delete({ where: { id: instanceId } });
  revalidatePath(`/models`);
}

/** Attach/detach an instance to a Pitstop. */
export async function setInstancePitstop(instanceId: string, pitstopId: string | null) {
  await authorizeInstance(instanceId, "update");
  await prisma.modelInstance.update({
    where: { id: instanceId },
    data: { pitstopId },
  });
  revalidatePath(`/models/${instanceId}`);
}

/** Search pitstops for the attach picker. Limits to user's accessible scope. */
export async function searchPitstops(q: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  // Light scope: pitstops owned by user OR by their direct reports. Keeps the
  // surface tractable; admins also see their own. Heavier RBAC scope can come later.
  const rows = await prisma.pitstop.findMany({
    where: {
      deletedAt: null,
      OR: [
        { title: { contains: trimmed, mode: "insensitive" } },
        { goal: { title: { contains: trimmed, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true, title: true,
      goal: { select: { title: true } },
      needsSettlement: { select: { id: true, name: true } },
    },
    take: 10,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(r => ({
    id: r.id, title: r.title, goalTitle: r.goal?.title ?? null,
    settlementName: r.needsSettlement?.name ?? null,
  }));
}

/**
 * Snapshot the instance's computed values into a new Budget. The model template
 * declares a ModelOutput of kind 'budgetExport' with config:
 *   { domainName, years, capexLines: [{nodeKey, description}],
 *     opexLines: [{nodeKey, description, costCategory, months}] }
 *
 * Capex nodes contribute one line each at y1 (units=1, unitCost=value).
 * Opex nodes contribute one line each at y1 (units=months, unitCost=monthlyValue).
 * The created Budget links back via name reference; users iterate it like any other budget.
 */
export async function promoteToBudget(instanceId: string, outputKey: string, budgetName: string) {
  const { session } = await authorizeInstance(instanceId, "promote_to_budget");
  const ctx = await buildRbacContext(session);
  if (!(await can(ctx, "budget", "create"))) throw new Error("Forbidden: no budget.create");

  // Lazy imports to keep this action's hot path light.
  const { toEngineTemplate } = await import("@/lib/models/fromPrisma");
  const { compute } = await import("@/lib/models/engine");

  const instance = await prisma.modelInstance.findUnique({
    where: { id: instanceId },
    include: {
      template: {
        include: {
          groups: { orderBy: { order: "asc" } },
          nodes: { orderBy: { order: "asc" }, include: { group: { select: { key: true } } } },
          outputs: { orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!instance) throw new Error("Instance not found");

  const output = instance.template.outputs.find(o => o.key === outputKey && o.kind === "budgetExport");
  if (!output) throw new Error(`No budgetExport output '${outputKey}'`);

  type BudgetExportConfig = {
    domainName?: string;
    years?: number;
    // templateKey (optional) links the promoted line back to a LineTemplate row
    // so the budget can be regenerated parametrically from Budget.inputs later,
    // exactly matching a /budget/new build with the same inputs.
    capexLines?: Array<{ nodeKey: string; description: string; templateKey?: string }>;
    opexLines?: Array<{ nodeKey: string; description: string; costCategory?: "Salary" | "Other" | "Nil"; months?: number; templateKey?: string }>;
    // Optional mapping from model input key → budget inp.* key (drop the
    // "inp." prefix in the value). Populated into Budget.inputs.extraInputs
    // so subsequent regeneration reads the same capacity inputs.
    inputMapping?: Record<string, string>;
  };
  const cfg = (output.config ?? {}) as BudgetExportConfig;
  const domain = cfg.domainName ?? "Operating_Model";
  const years = (cfg.years === 3 ? 3 : 1) as 1 | 3;
  const horizonMonths = years * 12;
  // Legacy model-driven budgets only applied inflation when years was 3.
  const applyInflation = years === 3;

  const template = toEngineTemplate(instance.template);
  const result = compute(template, (instance.inputsJson ?? {}) as InstanceInputs);

  const scalarOf = (key: string): number => {
    const v = result.values[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v) && typeof v[0] === "number") return v[0];
    return 0;
  };

  const trimmedName = budgetName.trim() || `${instance.name} budget`;

  // Derive extraInputs from the model's saved inputsJson via cfg.inputMapping.
  // Every mapping entry writes ONE numeric into Budget.inputs.extraInputs (the
  // sentinel expansion for enum pickers is stored in the model side already, so
  // the same 0/1 sentinels land in extraInputs; the budget form's picker will
  // display the right option when the user opens it later).
  const rawInputs = (instance.inputsJson ?? {}) as InstanceInputs;
  const extraInputs: Record<string, number> = {};
  for (const [modelKey, budgetKey] of Object.entries(cfg.inputMapping ?? {})) {
    const v = rawInputs[modelKey];
    if (typeof v === "number") extraInputs[budgetKey] = v;
    else if (typeof v === "boolean") extraInputs[budgetKey] = v ? 1 : 0;
    else if (v !== undefined && v !== null && !Array.isArray(v)) {
      const n = Number(v);
      if (Number.isFinite(n)) extraInputs[budgetKey] = n;
    }
  }

  const created = await prisma.budget.create({
    data: {
      name: trimmedName,
      partnerId: session.user!.id!,
      domains: [domain],
      years,
      horizonMonths,
      applyInflation,
      status: "draft",
      inputs: {
        create: Object.keys(extraInputs).length > 0 ? { extraInputs } : {},
      },
    },
  });

  // Capex lines (section: capex). Stamp templateKey when the output config
  // supplies it — that lets scripts/regenerate-sanitation-budgets.ts recognise
  // and refresh promoted lines from the same LineTemplate row.
  let position = 0;
  for (const cl of cfg.capexLines ?? []) {
    const value = scalarOf(cl.nodeKey);
    await prisma.budgetLine.create({
      data: {
        budgetId: created.id, domain, section: "capex", position: position++,
        description: cl.description, costCategory: "Other",
        unitType: "lumpsum", isAutoGenerated: false,
        templateKey: cl.templateKey ?? null,
        y1Units: 1, y1UnitCost: value, y1AllocPct: 1, y1Total: value,
        notes: `From model node '${cl.nodeKey}'`,
      },
    });
  }
  // Opex lines (section: programme).
  for (const ol of cfg.opexLines ?? []) {
    const monthly = scalarOf(ol.nodeKey);
    const months = ol.months ?? 12;
    const total = monthly * months;
    await prisma.budgetLine.create({
      data: {
        budgetId: created.id, domain, section: "programme", position: position++,
        description: ol.description, costCategory: (ol.costCategory ?? "Other") as "Salary" | "Other" | "Nil",
        unitType: "months", isAutoGenerated: false,
        templateKey: ol.templateKey ?? null,
        y1Units: months, y1UnitCost: monthly, y1AllocPct: 1, y1Total: total,
        notes: `From model node '${ol.nodeKey}' (monthly × ${months} months)`,
      },
    });
  }

  revalidatePath(`/budget`);
  revalidatePath(`/models/${instanceId}`);
  return { budgetId: created.id };
}
