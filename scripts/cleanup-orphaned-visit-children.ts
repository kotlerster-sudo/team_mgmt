/**
 * One-off cleanup: soft-delete visit child activities that were left behind by CLOSED/cancelled/
 * deleted visits. The close route used to mark only the Visit Done and leave its un-completed
 * materialised children as Scheduled — so they lingered as "due" work and piled up on every close
 * (each visit re-materialises the full catalog). The close route now clears them; this repairs the
 * backlog those earlier closes created.
 *
 * Soft-deletes a child event (visitEventId set, not Done, not already Cancelled/deleted) only when
 * its PARENT visit is Done / Cancelled / soft-deleted. Done children are always kept (the record +
 * indicator captures). Open children under a still-open visit are left alone.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/cleanup-orphaned-visit-children.ts [--dry]
 */

import prisma from "../lib/prisma";

async function main() {
  const dry = process.argv.includes("--dry");

  const orphans = await prisma.$queryRaw<{ id: string; goalTitle: string | null }[]>`
    SELECT child.id AS id, g.title AS "goalTitle"
    FROM "PitstopEvent" child
    JOIN "PitstopEvent" parent ON parent.id = child."visitEventId"
    LEFT JOIN "ChecklistItem" ci ON ci.id = child."checklistItemId"
    LEFT JOIN "Pitstop" p ON p.id = ci."pitstopId"
    LEFT JOIN "Goal" g ON g.id = p."goalId"
    WHERE child."visitEventId" IS NOT NULL
      AND child."deletedAt" IS NULL
      AND child.status NOT IN ('Done'::"PitstopEventStatus", 'Cancelled'::"PitstopEventStatus")
      AND (parent.status IN ('Done'::"PitstopEventStatus", 'Cancelled'::"PitstopEventStatus") OR parent."deletedAt" IS NOT NULL)
  `;

  const byGoal = new Map<string, number>();
  for (const o of orphans) byGoal.set(o.goalTitle ?? "(unknown)", (byGoal.get(o.goalTitle ?? "(unknown)") ?? 0) + 1);
  console.log(`[cleanup-orphans] ${orphans.length} orphaned visit-child activities under closed/cancelled visits${dry ? " (DRY)" : ""}`);
  for (const [g, n] of [...byGoal.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${n.toString().padStart(4)}  ${g}`);

  if (dry || orphans.length === 0) { console.log("[cleanup-orphans] " + (dry ? "dry run — nothing changed." : "nothing to do.")); await prisma.$disconnect(); return; }

  const res = await prisma.$executeRaw`
    UPDATE "PitstopEvent" child
    SET "deletedAt" = NOW(), "updatedAt" = NOW()
    FROM "PitstopEvent" parent
    WHERE parent.id = child."visitEventId"
      AND child."deletedAt" IS NULL
      AND child.status NOT IN ('Done'::"PitstopEventStatus", 'Cancelled'::"PitstopEventStatus")
      AND (parent.status IN ('Done'::"PitstopEventStatus", 'Cancelled'::"PitstopEventStatus") OR parent."deletedAt" IS NOT NULL)
  `;
  console.log(`[cleanup-orphans] soft-deleted ${res} orphaned child activities.`);
}

main().catch((e) => { console.error("[cleanup-orphans] FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
