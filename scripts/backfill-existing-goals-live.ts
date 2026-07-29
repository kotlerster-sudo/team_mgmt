/**
 * One-off backfill: take LIVE every setup goal that was created from an "-existing" goal template.
 *
 * Existing-nature templates (`*-existing`, e.g. creche-program-existing) describe programmes/centres
 * that are ALREADY operating — they should be visit-driven (mode="live"), but the apply route used to
 * always create goals as mode="setup", and auto-go-live never fires for them (their setup pitstops
 * never "complete"). This flips them via setCentreLive() — idempotent, freezes the domain catalog +
 * seeds a recurring Operations pitstop + cadence. Centres in a domain without an authored catalog go
 * live with an empty menu (valid; the menu appears once a catalog is authored).
 *
 * Reversible: writes a pre-state snapshot (mode + whether a CentreCatalog / recurring pitstop already
 * existed) to rbac-backups/ before mutating, so you can tell exactly what this run created.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/backfill-existing-goals-live.ts
 *      add --dry to preview without mutating.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import { setCentreLive } from "../lib/operations/goLive";

async function main() {
  const dry = process.argv.includes("--dry");

  const candidates = await prisma.goal.findMany({
    where: {
      deletedAt: null,
      mode: "setup",
      status: { not: "Complete" },
      pitstops: { some: { deletedAt: null, templateSlug: { endsWith: "-existing" } } },
    },
    select: {
      id: true, title: true, mode: true, needsDomain: true,
      centreCatalog: { select: { id: true } },
      pitstops: { where: { deletedAt: null }, select: { id: true, recurrence: true, templateSlug: true } },
    },
  });

  console.log(`[backfill-live] ${candidates.length} setup goal(s) from an -existing template${dry ? " (DRY RUN)" : ""}`);

  // Pre-state snapshot for reversibility.
  const preState = candidates.map((g) => ({
    goalId: g.id,
    title: g.title,
    needsDomain: g.needsDomain,
    priorMode: g.mode,
    hadCentreCatalog: Boolean(g.centreCatalog),
    priorRecurringPitstopIds: g.pitstops.filter((p) => p.recurrence !== "None").map((p) => p.id),
  }));
  const dir = join(process.cwd(), "rbac-backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = join(dir, `backfill-existing-live-${stamp}.json`);
  if (!dry) writeFileSync(backupFile, JSON.stringify(preState, null, 2));

  if (dry) {
    for (const g of candidates) {
      console.log(`   [dry] ${g.title}  (domain ${g.needsDomain ?? "—"}, catalog ${g.centreCatalog ? "exists" : "none"})`);
    }
    console.log("[backfill-live] dry run — nothing changed.");
    await prisma.$disconnect();
    return;
  }

  let flipped = 0, alreadyLive = 0, failed = 0, seededMenu = 0, emptyMenu = 0;
  for (const g of candidates) {
    try {
      const r = await setCentreLive(g.id);
      if (r.alreadyLive) alreadyLive += 1; else flipped += 1;
      if (r.seededCategories > 0) seededMenu += 1; else emptyMenu += 1;
      console.log(`   ✓ ${g.title} → live (${r.seededCategories} categories, pitstop ${r.livePitstopId.slice(0, 8)})`);
    } catch (e) {
      failed += 1;
      console.error(`   ✗ ${g.title}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\n[backfill-live] done. flipped=${flipped} alreadyLive=${alreadyLive} failed=${failed} · menu: ${seededMenu} seeded / ${emptyMenu} empty`);
  console.log(`[backfill-live] pre-state backup → ${backupFile}`);
}

main()
  .catch((err) => { console.error("[backfill-live] FAILED:", err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
