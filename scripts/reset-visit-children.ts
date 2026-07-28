// One-off migration: the visit model changed from one child event PER CHECKLIST to one PER ACTIVITY.
// Existing in-progress visits hold stale checklist-keyed child events that would block the new
// per-activity materialisation (materialise skips checklists that already have events). Soft-delete
// the un-completed (Scheduled) child events under in-progress visits so materialise rebuilds them in
// the new model on the next visit load. Reversible (soft delete) and never touches Done completions.
//
// Run: npx tsx scripts/reset-visit-children.ts
import prisma from "@/lib/prisma";

async function main() {
  const visits = await prisma.pitstopEvent.findMany({
    where: { type: "Visit", visitEventId: null, deletedAt: null, status: { notIn: ["Done", "Cancelled"] } },
    select: { id: true },
  });
  const visitIds = visits.map((v) => v.id);

  const res = await prisma.pitstopEvent.updateMany({
    where: { visitEventId: { in: visitIds }, deletedAt: null, status: "Scheduled" },
    data: { deletedAt: new Date() },
  });
  console.log(`Soft-deleted ${res.count} stale Scheduled visit child events across ${visitIds.length} in-progress visits.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
