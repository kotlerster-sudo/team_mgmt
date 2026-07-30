/**
 * Consolidate each LIVE centre onto a single dedicated "Operations" recurring pitstop (the visit
 * anchor), fixing the "-existing" centres that carry several recurring pitstops (repeatCount +
 * since-fixed clone bug). Symptoms it cures: visits scattered across pitstops, monthDone not counting
 * closed visits, currentVisit not resolving → spurious "I have reached" + duplicate open visits.
 *
 * Per live centre:
 *   1. Ensure the dedicated "Operations" anchor exists (create if missing).
 *   2. Repoint every visit-driven Visit event (title "Visit —") to the anchor.
 *   3. Dedupe open arrived visits THIS MONTH: keep the most recent, Cancel the rest + soft-delete
 *      their un-done child activities (clears the orphaned "due today").
 *
 * Idempotent. Writes a reversible backup. Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/consolidate-visit-anchors.ts [--dry]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import { monthBounds } from "../lib/operations/month";
import { resolveOperationsAnchorId, resolveOrCreateOperationsAnchorId } from "../lib/operations/anchor";

async function main() {
  const dry = process.argv.includes("--dry");
  const { start, end } = monthBounds();

  const goals = await prisma.goal.findMany({
    where: { deletedAt: null, mode: "live" },
    select: { id: true, title: true, needsDomain: true },
    orderBy: { title: "asc" },
  });

  const report: Record<string, unknown>[] = [];
  let anchorsCreated = 0, totalRepointed = 0, totalCancelled = 0, totalChildrenCleared = 0;

  for (const g of goals) {
    // Visit-driven visits of this centre (via any of its pitstops).
    const visits = await prisma.pitstopEvent.findMany({
      where: {
        type: "Visit", visitEventId: null, deletedAt: null, title: { startsWith: "Visit —" },
        pitstops: { some: { pitstop: { goalId: g.id } } },
      },
      select: { id: true, status: true, arrivedAt: true, scheduledAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const openThisMonth = visits.filter(
      (v) => v.arrivedAt && !["Done", "Cancelled"].includes(v.status) && v.scheduledAt >= start && v.scheduledAt <= end,
    );

    let anchorId = await resolveOperationsAnchorId(g.id);
    const willCreateAnchor = !anchorId;
    const toCancel = openThisMonth.slice(1); // keep most recent (index 0)

    if (visits.length === 0 && !willCreateAnchor) continue; // nothing to do

    if (dry) {
      report.push({ goal: g.title, domain: g.needsDomain, willCreateAnchor, visits: visits.length, openThisMonth: openThisMonth.length, wouldCancel: toCancel.length });
      continue;
    }

    // 1. Anchor.
    if (willCreateAnchor) { anchorId = await resolveOrCreateOperationsAnchorId(g.id); anchorsCreated++; }

    // 2. Repoint every visit's pitstop link to the anchor (visits carry a single link).
    let repointed = 0;
    if (visits.length) {
      const res = await prisma.pitstopEventPitstop.updateMany({
        where: { eventId: { in: visits.map((v) => v.id) }, pitstopId: { not: anchorId! } },
        data: { pitstopId: anchorId! },
      });
      repointed = res.count;
      totalRepointed += repointed;
    }

    // 3. Dedupe open visits — cancel all but the newest, clear their un-done children.
    let childrenCleared = 0;
    for (const v of toCancel) {
      await prisma.pitstopEvent.update({
        where: { id: v.id },
        data: { status: "Cancelled", cancellationReason: "Duplicate visit — consolidated onto the centre anchor" },
      });
      const c = await prisma.pitstopEvent.updateMany({
        where: { visitEventId: v.id, deletedAt: null, status: { notIn: ["Done", "Cancelled"] } },
        data: { deletedAt: new Date() },
      });
      childrenCleared += c.count;
    }
    totalCancelled += toCancel.length;
    totalChildrenCleared += childrenCleared;

    report.push({ goalId: g.id, goal: g.title, anchorId, anchorCreated: willCreateAnchor, visitsRepointed: repointed, visitsCancelled: toCancel.map((v) => v.id), childrenCleared });
    console.log(`   ✓ ${g.title}: anchor ${willCreateAnchor ? "created" : "reused"}, repointed ${repointed}, cancelled ${toCancel.length} dup (${childrenCleared} children cleared)`);
  }

  if (dry) {
    const act = report.filter((r) => (r.visits as number) > 0 || r.willCreateAnchor);
    console.log(`[consolidate] DRY — ${act.length} live centre(s) would change:`);
    for (const r of act) console.log(`   ${r.goal}: createAnchor=${r.willCreateAnchor} visits=${r.visits} openThisMonth=${r.openThisMonth} wouldCancel=${r.wouldCancel}`);
    await prisma.$disconnect();
    return;
  }

  const dir = join(process.cwd(), "rbac-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `consolidate-visit-anchors-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n[consolidate] done. anchorsCreated=${anchorsCreated} visitsRepointed=${totalRepointed} dupVisitsCancelled=${totalCancelled} childrenCleared=${totalChildrenCleared}`);
  console.log(`[consolidate] backup → ${file}`);
}

main().catch((e) => { console.error("[consolidate] FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
