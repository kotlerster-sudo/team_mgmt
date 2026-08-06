/**
 * Remove the test1 account's goals that pollute operational surfaces (Command
 * Center, /operations, accountability). test1@gmail.com is a QA account that
 * created duplicate "(Existing)" facility goals (second/third copies on
 * facilities that already have the real RP's goal) plus a couple of standalone
 * test goals. Their follow-ups are junk ("testing", "dkjfndf", …).
 *
 * Mirrors the app's own goal-delete cascade (app/api/goals/[goalId] DELETE):
 *   soft-delete pitstops + their events, HARD-delete checklist items + action
 *   points, then soft-delete the goal. Reversible for the goal/pitstops/events
 *   (deletedAt); checklist items + APs are hard-removed exactly as a normal
 *   goal delete does — fine here since they're test noise.
 *
 * Dry-run by default. Apply with:
 *   npx tsx --env-file=.env.local scripts/cleanup-test1-goals.ts --apply
 *
 * Hard-scoped to the test1 email — it will not touch any other user's data.
 */

import prisma from "../lib/prisma";

const TEST_EMAIL = "test1@gmail.com";
const APPLY = process.argv.includes("--apply");

async function main() {
  const user = await prisma.user.findFirst({ where: { email: TEST_EMAIL }, select: { id: true, name: true } });
  if (!user) {
    console.log(`No user with email ${TEST_EMAIL}; nothing to do.`);
    return;
  }

  const goals = await prisma.goal.findMany({
    where: { ownerId: user.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      mode: true,
      linkedFacility: { select: { name: true } },
      _count: { select: { outcomes: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (goals.length === 0) {
    console.log("No non-deleted goals owned by test1; already clean.");
    return;
  }

  // Safety gate: never remove a goal that carries real delivery outcomes.
  const withOutcomes = goals.filter((g) => g._count.outcomes > 0);
  if (withOutcomes.length > 0) {
    console.error("ABORT — some test1 goals carry GoalOutcome rows (real delivery). Review manually:");
    for (const g of withOutcomes) console.error(`  ${g.id} "${g.title}" outcomes=${g._count.outcomes}`);
    process.exit(1);
  }

  const goalIds = goals.map((g) => g.id);
  const pitstops = await prisma.pitstop.findMany({ where: { goalId: { in: goalIds }, deletedAt: null }, select: { id: true } });
  const pitstopIds = pitstops.map((p) => p.id);
  const [eventCount, checklistCount, apCount] = await Promise.all([
    pitstopIds.length
      ? prisma.pitstopEvent.count({
          where: { deletedAt: null, OR: [{ pitstops: { some: { pitstopId: { in: pitstopIds } } } }, { checklistItem: { pitstopId: { in: pitstopIds } } }] },
        })
      : Promise.resolve(0),
    pitstopIds.length ? prisma.checklistItem.count({ where: { pitstopId: { in: pitstopIds } } }) : Promise.resolve(0),
    prisma.actionPoint.count({ where: { goalId: { in: goalIds } } }),
  ]);

  console.log(`test1 (${user.id}) — ${goals.length} goals to remove:`);
  for (const g of goals) {
    console.log(`  ${g.id.slice(-8)} "${g.title.slice(0, 40).padEnd(40)}" ${g.mode.padEnd(5)} fac=${g.linkedFacility?.name ?? "none"}`);
  }
  console.log(`\nCascade: ${pitstopIds.length} pitstops + ${eventCount} events soft-deleted; ${checklistCount} checklist items + ${apCount} action points hard-deleted.`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to execute.");
    return;
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (pitstopIds.length > 0) {
      await tx.pitstop.updateMany({ where: { id: { in: pitstopIds } }, data: { deletedAt: now } });
      await tx.pitstopEvent.updateMany({
        where: { deletedAt: null, OR: [{ pitstops: { some: { pitstopId: { in: pitstopIds } } } }, { checklistItem: { pitstopId: { in: pitstopIds } } }] },
        data: { deletedAt: now },
      });
      await tx.checklistItem.deleteMany({ where: { pitstopId: { in: pitstopIds } } });
    }
    await tx.actionPoint.deleteMany({ where: { goalId: { in: goalIds } } });
    await tx.goal.updateMany({ where: { id: { in: goalIds } }, data: { deletedAt: now } });
  });

  console.log(`\n✓ Applied. ${goals.length} test1 goals removed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
