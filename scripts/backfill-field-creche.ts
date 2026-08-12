// P2 — Backfill existing creche goals into the /field spine. Projection only:
// the old Pitstop/ChecklistItem/PitstopEvent rows are left untouched and remain
// readable by /operations. Re-runnable (pre-launch): derived rows (templateSlug
// set) are replaced each run; ad-hoc /field rows (templateSlug null) are preserved.
//
//   Goal            ← fieldAnchorAt, overallSlaDays, cadenceCount/Period
//   FieldStep Setup ← the goal's setup pitstops WITH real completion state; the
//                     pitstop's checklist items become a "checklist" form + answers
//   FieldStep Visit ← the domain visit recipe (VisitStepTemplate)
//   FieldVisit      ← genuinely-completed monthly visits (arrived + closed), skipping
//                     the Flagged/never-arrived cruft
//
// Run: DATABASE_URL=... npx tsx scripts/backfill-field-creche.ts [--commit]
import { prisma } from "../lib/prisma";
import type { Prisma } from "../app/generated/prisma/client";

const DOMAIN = "Creche";
const SETUP_SRC_SLUG = "creche-program";
const VISIT_SRC_SLUG = "creche-visit-catalog";
const COMMIT = process.argv.includes("--commit");

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

async function main() {
  const domainConfig = await prisma.fieldDomainConfig.findUnique({ where: { domain: DOMAIN } });
  if (!domainConfig) throw new Error("FieldDomainConfig for Creche missing — run seed-field-templates-creche.ts first");
  const setupTmpls = await prisma.setupStepTemplate.findMany({ where: { domain: DOMAIN }, orderBy: { order: "asc" } });
  const visitTmpls = await prisma.visitStepTemplate.findMany({ where: { domain: DOMAIN }, orderBy: { order: "asc" } });
  const setupByKey = new Map(setupTmpls.map((t) => [t.stepKey, t]));

  const goals = await prisma.goal.findMany({
    where: { needsDomain: DOMAIN, deletedAt: null },
    include: {
      pitstops: { where: { deletedAt: null }, orderBy: { order: "asc" }, include: { checklistItems: true } },
      centreCatalog: true,
    },
  });

  let setupCount = 0, visitRecipeCount = 0, visitOccCount = 0;
  const report: string[] = [];

  for (const goal of goals) {
    const anchor = goal.startDate ?? goal.createdAt;
    const cadenceCount = goal.centreCatalog?.cadenceCount ?? domainConfig.cadenceCount;
    const cadencePeriod = goal.centreCatalog?.cadencePeriod ?? domainConfig.cadencePeriod;

    // ── Setup steps from real pitstops ──────────────────────────────────────
    const setupPitstops = goal.pitstops.filter((p) => (p.recurrence ?? "None") === "None");
    const setupRows: Prisma.FieldStepUncheckedCreateInput[] = setupPitstops.map((p, i) => {
      const stepKey = p.templateKey ?? slug(p.title);
      const tmpl = setupByKey.get(stepKey);
      const status = p.status === "Done" ? "Done" : p.status === "InProgress" ? "InProgress" : "Todo";
      const items = p.checklistItems.map((c) => ({ key: c.key ?? slug(c.text), text: c.text }));
      const checked: Record<string, boolean> = {};
      for (const c of p.checklistItems) checked[c.key ?? slug(c.text)] = c.checked || c.status === "Done";
      const slaDays = tmpl?.slaDays ?? null;
      const dueDate = p.targetDate ?? (slaDays != null ? addDays(anchor, slaDays) : null);
      return {
        goalId: goal.id,
        kind: "Setup" as const,
        title: p.title,
        order: i,
        templateSlug: SETUP_SRC_SLUG,
        stepKey,
        slaDays,
        startSlaDays: tmpl?.startSlaDays ?? null,
        blockedByKey: tmpl?.blockedByKey ?? null,
        dueDate,
        formKind: items.length ? "checklist" : (tmpl?.formKind ?? null),
        formSchema: items.length ? { items } : (tmpl?.formSchema ?? undefined),
        status,
        answers: items.length ? { checked } : undefined,
        completedById: null,
        completedAt: p.completedAt,
        startedAt: p.startDate,
      };
    });

    // ── Visit recipe (only for goals that reached live / have a catalog) ─────
    const isLive = goal.mode === "live" || !!goal.centreCatalog;
    const visitRows: Prisma.FieldStepUncheckedCreateInput[] = isLive
      ? visitTmpls.map((t, i) => ({
          goalId: goal.id,
          kind: "Visit" as const,
          title: t.title,
          order: i,
          templateSlug: VISIT_SRC_SLUG,
          stepKey: t.stepKey,
          mandatory: t.mandatory,
          formKind: t.formKind,
          formSchema: t.formSchema ?? undefined,
        }))
      : [];

    // ── Completed monthly visits (skip Flagged / never-arrived cruft) ────────
    const completedVisits = await prisma.pitstopEvent.findMany({
      where: {
        type: "Visit",
        visitEventId: null,
        status: "Done",
        completedAt: { not: null },
        checklistItem: { pitstop: { goalId: goal.id } },
      },
      select: { scheduledAt: true, arrivedAt: true, arrivedById: true, completedAt: true, completedById: true },
    });

    setupCount += setupRows.length;
    visitRecipeCount += visitRows.length;
    visitOccCount += completedVisits.length;
    report.push(
      `  ${goal.title.slice(0, 42).padEnd(42)} mode=${goal.mode.padEnd(5)} setup=${setupRows.length} visitRecipe=${visitRows.length} doneVisits=${completedVisits.length}`,
    );

    if (!COMMIT) continue;

    await prisma.$transaction(async (tx) => {
      await tx.goal.update({
        where: { id: goal.id },
        data: { fieldAnchorAt: anchor, overallSlaDays: domainConfig.overallSlaDays, cadenceCount, cadencePeriod },
      });
      // Replace derived rows only (preserve ad-hoc /field additions).
      await tx.fieldStep.deleteMany({ where: { goalId: goal.id, templateSlug: { in: [SETUP_SRC_SLUG, VISIT_SRC_SLUG] } } });
      for (const r of [...setupRows, ...visitRows]) await tx.fieldStep.create({ data: r });
      // Visits: pre-launch there are no /field visits yet, safe to rebuild wholesale.
      await tx.fieldVisit.deleteMany({ where: { goalId: goal.id } });
      for (const v of completedVisits) {
        await tx.fieldVisit.create({
          data: {
            goalId: goal.id,
            scheduledFor: v.scheduledAt ?? v.completedAt!,
            arrivedAt: v.arrivedAt,
            arrivedById: v.arrivedById,
            closedAt: v.completedAt,
            closedById: v.completedById,
          },
        });
      }
    });
  }

  console.log(`=== Backfill ${COMMIT ? "(COMMIT)" : "(DRY RUN — pass --commit to write)"} ===`);
  console.log(report.join("\n"));
  console.log(`\nTotals: ${goals.length} goals · ${setupCount} setup steps · ${visitRecipeCount} visit-recipe steps · ${visitOccCount} completed visits`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
