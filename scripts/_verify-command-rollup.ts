/**
 * READ-ONLY verification harness for the command-center rollup loader.
 *
 * Runs loadCommandRollup for every zone, printing per-zone timing, row counts
 * and invariant violations. No writes anywhere — safe against the shared
 * prod Neon DB.
 *
 *   npx tsx --env-file=.env.local scripts/_verify-command-rollup.ts
 */

import prisma from "../lib/prisma";
import { loadCommandRollup } from "../lib/operations/command";

async function main() {
  const zones = await prisma.zone.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, city: { select: { name: true } } },
    orderBy: [{ city: { name: "asc" } }, { name: "asc" }],
  });
  console.log(`${zones.length} zones\n`);

  let totalProblems = 0;

  for (const z of zones) {
    const t0 = Date.now();
    const rollup = await loadCommandRollup({ kind: "zone", id: z.id });
    const ms = Date.now() - t0;
    if (!rollup) {
      console.log(`✗ ${z.name}: rollup returned null`);
      totalProblems++;
      continue;
    }

    const problems: string[] = [];
    const live = rollup.rows.filter((r) => r.phase.lifecycle === "live");
    const setup = rollup.rows.filter((r) => r.phase.lifecycle === "setting_up");

    for (const r of rollup.rows) {
      if (r.mode === "live" && !r.live) problems.push(`${r.name}: live mode but no live facet`);
      if (r.mode !== "live" && !r.setup) problems.push(`${r.name}: setup mode but no setup facet`);
      if (r.live) {
        if (r.live.monthly.length !== rollup.months.length)
          problems.push(`${r.name}: monthly length ${r.live.monthly.length} ≠ ${rollup.months.length}`);
        const last = r.live.monthly[r.live.monthly.length - 1];
        if (last && (last.done !== r.live.cadence.done || last.required !== r.live.cadence.required))
          problems.push(`${r.name}: cadence ≠ last monthly bucket`);
        const visitSum = r.live.monthly.reduce((s, m) => s + m.done, 0);
        if (visitSum > 0 && !r.live.lastVisitAt) problems.push(`${r.name}: visits done but no lastVisitAt`);
      }
      if (r.setup) {
        if (r.setup.front && r.setup.front.daysStuck < 0) problems.push(`${r.name}: negative daysStuck`);
        const wsTotal = r.setup.workstreams.reduce((s, w) => s + w.total, 0);
        if (r.phase.totalSteps != null && wsTotal !== r.phase.totalSteps)
          problems.push(`${r.name}: workstream total ${wsTotal} ≠ phase totalSteps ${r.phase.totalSteps}`);
      }
      if (r.aps.maxAgeDays < 0) problems.push(`${r.name}: negative AP age`);
      if (r.aps.overdue > r.aps.open) problems.push(`${r.name}: overdue APs > open APs`);
      if (!r.themeKey) problems.push(`${r.name}: missing themeKey`);
      for (const i of r.indicators) {
        if (i.sharedFacilityCount < 1) problems.push(`${r.name}: sharedFacilityCount < 1`);
      }
    }

    const apTotal = rollup.rows.reduce((s, r) => s + r.aps.open, 0);
    const stuck = rollup.rows.filter(
      (r) => r.setup?.front && (r.setup.front.daysOverdue > 0 || r.setup.front.daysStuck >= 14),
    ).length;
    const withIndicators = rollup.rows.filter((r) => r.indicators.some((i) => i.value != null)).length;

    console.log(
      `${problems.length === 0 ? "✓" : "✗"} ${z.city?.name ?? "—"} · ${z.name}: ${rollup.rows.length} rows ` +
        `(${live.length} live, ${setup.length} setup) · ${apTotal} open APs · ${stuck} stuck · ` +
        `${withIndicators} rows w/ indicator data · ${rollup.scope.clusters.length} clusters · ${ms}ms`,
    );
    for (const p of problems) console.log(`    ! ${p}`);
    totalProblems += problems.length;
  }

  console.log(`\n${totalProblems === 0 ? "All invariants hold." : `${totalProblems} problem(s) found.`}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
