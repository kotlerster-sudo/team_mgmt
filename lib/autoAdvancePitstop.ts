import prisma from "@/lib/prisma";
import { cloneRecurringPitstopOnDone } from "@/lib/recurringPitstop";
import { maybeAutoGoLive } from "@/lib/operations/goLive";

/**
 * After a checklist item changes, recompute pitstop status (forward-only):
 *   Upcoming   → InProgress  when ≥1 item is Done
 *   InProgress → Done        when ≥1 item exists and all non-Cancelled items are Done
 * Never demotes an explicitly-set Done. Triggers the recurring clone when it
 * flips a recurring pitstop to Done.
 */
export async function autoAdvancePitstopFromItem(itemId: string): Promise<void> {
  const rows = await prisma.$queryRaw<{ pitstopId: string }[]>`
    SELECT "pitstopId" FROM "ChecklistItem" WHERE id = ${itemId} LIMIT 1
  `;
  if (!rows[0]) return;
  await autoAdvancePitstopById(rows[0].pitstopId);
}

export async function autoAdvancePitstopById(pitstopId: string): Promise<void> {
  const [pitstop] = await prisma.$queryRaw<{ status: string; recurrence: string; mode: string }[]>`
    SELECT p.status::text AS status, p.recurrence::text AS recurrence, g.mode AS mode
    FROM "Pitstop" p JOIN "Goal" g ON g.id = p."goalId"
    WHERE p.id = ${pitstopId} LIMIT 1
  `;
  if (!pitstop) return;
  // Only forward-advance from these two states. Done/Cancelled/etc. are owned by the user.
  if (pitstop.status !== "Upcoming" && pitstop.status !== "InProgress") return;

  // A LIVE centre's recurring pitstop is its permanent VISIT ANCHOR, not a classic checklist that
  // gets "finished". Completing visit items would otherwise flip it Done + clone the next instance,
  // sweeping the open Visit off the pitstop and bouncing the RP back to the "I have reached" gate.
  // The visit's own close route owns visit lifecycle — so never auto-complete a live recurring anchor.
  const isLiveVisitAnchor = pitstop.mode === "live" && pitstop.recurrence !== "None";

  const [stats] = await prisma.$queryRaw<{ total: bigint; done: bigint; open: bigint }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status <> 'Cancelled'::"ChecklistItemStatus")::bigint AS total,
      COUNT(*) FILTER (WHERE status = 'Done'::"ChecklistItemStatus")::bigint AS done,
      COUNT(*) FILTER (
        WHERE status NOT IN ('Done'::"ChecklistItemStatus", 'Cancelled'::"ChecklistItemStatus")
      )::bigint AS open
    FROM "ChecklistItem"
    WHERE "pitstopId" = ${pitstopId}
  `;
  const total = Number(stats?.total ?? 0);
  const done  = Number(stats?.done  ?? 0);
  const open  = Number(stats?.open  ?? 0);

  if (total > 0 && open === 0 && !isLiveVisitAnchor) {
    await prisma.pitstop.updateMany({
      where: { id: pitstopId, status: { in: ["Upcoming", "InProgress"] } },
      data: { status: "Done", completedAt: new Date() },
    });
    await cloneRecurringPitstopOnDone(pitstopId, pitstop.status);
    // Completing the last setup pitstop may auto-flip the centre to live (visit-driven).
    const [{ goalId }] = await prisma.$queryRaw<{ goalId: string }[]>`
      SELECT "goalId" FROM "Pitstop" WHERE id = ${pitstopId} LIMIT 1
    `;
    if (goalId) await maybeAutoGoLive(goalId);
    return;
  }

  if (pitstop.status === "Upcoming" && done > 0) {
    await prisma.pitstop.updateMany({
      where: { id: pitstopId, status: "Upcoming" },
      data: { status: "InProgress" },
    });
  }
}
