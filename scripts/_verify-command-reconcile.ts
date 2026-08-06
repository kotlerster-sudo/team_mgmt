/**
 * READ-ONLY reconciliation: command-center rollup vs the existing surfaces it
 * must agree with (they share code paths, so any mismatch = bug).
 *
 *   1. setup front node  ≡ loadCentrePlan().thisWeek   (/operations plan page)
 *   2. cadence done      ≡ doneVisitsByGoal()          (/operations portal)
 *   3. open AP count     ≡ direct ActionPoint count    (/api/action-points)
 *
 *   npx tsx --env-file=.env.local scripts/_verify-command-reconcile.ts [zoneName]
 */

import prisma from "../lib/prisma";
import { loadCommandRollup } from "../lib/operations/command";
import { loadCentrePlan } from "../lib/operations/plan";
import { doneVisitsByGoal, monthBounds } from "../lib/operations/month";

async function main() {
  const zoneName = process.argv[2] ?? "West";
  const zone = await prisma.zone.findFirst({
    where: { deletedAt: null, name: zoneName },
    select: { id: true, name: true },
  });
  if (!zone) throw new Error(`zone "${zoneName}" not found`);
  const rollup = await loadCommandRollup({ kind: "zone", id: zone.id });
  if (!rollup) throw new Error("rollup null");
  let ok = 0,
    bad = 0;

  // 1. Setup front vs loadCentrePlan.thisWeek
  for (const r of rollup.rows.filter((x) => x.setup?.front).slice(0, 5)) {
    const plan = await loadCentrePlan(r.goalId);
    const match = plan?.thisWeek?.pitstopId === r.setup!.front!.pitstopId;
    console.log(
      `${match ? "✓" : "✗"} front: ${r.name} — rollup="${r.setup!.front!.title}" plan="${plan?.thisWeek?.title ?? "null"}"`,
    );
    match ? ok++ : bad++;
  }

  // 2. Cadence done vs doneVisitsByGoal
  const liveIds = rollup.rows.filter((x) => x.live).map((x) => x.goalId);
  const visits = await doneVisitsByGoal(liveIds, monthBounds(new Date()));
  for (const r of rollup.rows.filter((x) => x.live).slice(0, 8)) {
    const expect = visits.get(r.goalId) ?? 0;
    const match = r.live!.cadence.done === expect;
    console.log(`${match ? "✓" : "✗"} visits: ${r.name} — rollup=${r.live!.cadence.done} doneVisitsByGoal=${expect}`);
    match ? ok++ : bad++;
  }

  // 3. AP open counts vs direct query
  for (const r of rollup.rows.filter((x) => x.aps.open > 0).slice(0, 5)) {
    const direct = await prisma.actionPoint.count({ where: { goalId: r.goalId, status: "open" } });
    const match = r.aps.open === direct;
    console.log(`${match ? "✓" : "✗"} APs: ${r.name} — rollup=${r.aps.open} direct=${direct}`);
    match ? ok++ : bad++;
  }

  console.log(`\n${ok} match, ${bad} mismatch`);
  if (bad > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
