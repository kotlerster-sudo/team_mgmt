/**
 * Two City rows are named "Bangalore". cmnstarnd… was soft-deleted on 2026-04-10
 * but the cleanup never repointed what hung off it, so every user in Bangalore
 * still carries a cityId that resolves to a deleted city — anything joining a
 * user to geography through cityId comes up empty.
 *
 * Everything else on the dead row is itself soft-deleted (the Majestic
 * settlement, the Central zone and its single cluster) and is left alone; only
 * live rows move. Separately, six live settlements carry a null cityId whose
 * cluster → zone already points at the live city, so the column is backfilled
 * from the zone rather than guessed.
 *
 * The dead City row stays, since soft-deleted children still reference it.
 *
 * Idempotent: every updateMany is scoped to the wrong state.
 */
import prisma from "../lib/prisma";

const DEAD = "cmnstarnd000004jqlyvq7enc";
const LIVE = "cmnswofl9000004l8llyf9241";

async function main() {
  const [dead, live] = await Promise.all([
    prisma.city.findUnique({ where: { id: DEAD }, select: { name: true, deletedAt: true } }),
    prisma.city.findUnique({ where: { id: LIVE }, select: { name: true, deletedAt: true } }),
  ]);
  if (!dead?.deletedAt) throw new Error(`${DEAD} is not soft-deleted — refusing to move rows off it`);
  if (!live || live.deletedAt) throw new Error(`${LIVE} is not a live city`);
  if (dead.name !== live.name) throw new Error(`names differ: ${dead.name} vs ${live.name}`);

  const users = await prisma.user.updateMany({ where: { cityId: DEAD }, data: { cityId: LIVE } });
  console.log(`users → live Bangalore: ${users.count}`);

  const goals = await prisma.goal.updateMany({ where: { needsCityId: DEAD }, data: { needsCityId: LIVE } });
  console.log(`goals (needsCityId) → live Bangalore: ${goals.count}`);

  const orphans = await prisma.settlement.findMany({
    where: { cityId: null, deletedAt: null },
    select: { id: true, name: true, cluster: { select: { zone: { select: { cityId: true } } } } },
  });
  for (const s of orphans) {
    const cityId = s.cluster?.zone?.cityId;
    if (!cityId) {
      console.log(`! ${s.name}: no city derivable from cluster → zone, skipped`);
      continue;
    }
    await prisma.settlement.update({ where: { id: s.id }, data: { cityId } });
    console.log(`~ ${s.name} cityId ← zone (${cityId.slice(0, 10)})`);
  }

  for (const id of [DEAD, LIVE]) {
    const c = await prisma.city.findUnique({
      where: { id },
      select: {
        name: true, deletedAt: true,
        _count: { select: { users: true, zones: true, settlements: true, needsGoals: true, grantingUnits: true } },
      },
    });
    console.log(`${c!.name}[${id.slice(0, 10)}] deleted=${!!c!.deletedAt}`, c!._count);
  }
}

main().finally(() => prisma.$disconnect());
