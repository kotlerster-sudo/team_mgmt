// Parity check for the creche /field backfill. Read-only.
import { prisma } from "../lib/prisma";

async function main() {
  const steps = await prisma.fieldStep.groupBy({ by: ["kind"], _count: { _all: true } });
  console.log("FieldStep by kind:", steps.map((s) => `${s.kind}=${s._count._all}`).join(" "));
  console.log("FieldVisit total:", await prisma.fieldVisit.count());

  // Spot-check: the Royapuram live goal — its setup should be 8 Done + 1 InProgress.
  const g = await prisma.goal.findFirst({
    where: { needsDomain: "Creche", title: { contains: "Royapuram" } },
    select: { id: true, title: true, fieldAnchorAt: true, overallSlaDays: true, cadenceCount: true, cadencePeriod: true },
  });
  if (!g) return;
  const setup = await prisma.fieldStep.findMany({
    where: { goalId: g.id, kind: "Setup" },
    orderBy: { order: "asc" },
    select: { title: true, status: true, dueDate: true, blockedByKey: true, formKind: true, answers: true },
  });
  console.log(`\n${g.title}`);
  console.log(`  anchor=${g.fieldAnchorAt?.toISOString().slice(0,10)} overallSla=${g.overallSlaDays}d cadence=${g.cadenceCount}/${g.cadencePeriod}`);
  for (const s of setup) {
    const checked = s.answers && typeof s.answers === "object" ? Object.values((s.answers as any).checked ?? {}).filter(Boolean).length : 0;
    const total = s.answers && typeof s.answers === "object" ? Object.keys((s.answers as any).checked ?? {}).length : 0;
    console.log(`  [${s.status.padEnd(10)}] ${s.title.slice(0,40).padEnd(40)} due=${s.dueDate?.toISOString().slice(0,10) ?? "-"} blockedBy=${s.blockedByKey ?? "-"} ${s.formKind ?? ""} ${total?`(${checked}/${total} ticked)`:""}`);
  }
  const doneVisitsThisAndPast = await prisma.fieldVisit.count({ where: { goalId: g.id, closedAt: { not: null } } });
  console.log(`  closed FieldVisits: ${doneVisitsThisAndPast}`);
}

main().finally(() => prisma.$disconnect());
