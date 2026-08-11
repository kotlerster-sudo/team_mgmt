import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { DbPitstop, interpolatePitstops, normalizeActivities, slugifyChecklistText } from "@/lib/templateDb";
import { attachGoalToProgrammeJourney } from "@/lib/programmeJourneys";
import { setCentreLive } from "@/lib/operations/goLive";
import { RELATIONAL_READS, templatePitstopsFromRelationalBySlug } from "@/lib/controlplane/read";
import {
  buildScheduleConfig,
  getWorkingDays,
  nearestWorkingDay,
  scheduleActivitiesInWindow,
  snapToWeekday,
  pitstopTypeToEventType,
} from "@/lib/scheduleActivities";
import { auditLog } from "@/lib/auditLog";

async function resolveCityName(
  needsCityId?: string | null,
  needsZoneId?: string | null,
  needsClusterId?: string | null,
  needsSettlementId?: string | null,
): Promise<string | null> {
  if (needsCityId) {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM "City" WHERE id = ${needsCityId} LIMIT 1
    `;
    return rows[0]?.name ?? null;
  }
  if (needsSettlementId) {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT c.name FROM "City" c
      JOIN "Settlement" s ON s."cityId" = c.id
      WHERE s.id = ${needsSettlementId} LIMIT 1
    `;
    return rows[0]?.name ?? null;
  }
  if (needsClusterId) {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT c.name FROM "City" c
      JOIN "Zone" z ON z."cityId" = c.id
      JOIN "Cluster" cl ON cl."zoneId" = z.id
      WHERE cl.id = ${needsClusterId} LIMIT 1
    `;
    return rows[0]?.name ?? null;
  }
  if (needsZoneId) {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT c.name FROM "City" c
      JOIN "Zone" z ON z."cityId" = c.id
      WHERE z.id = ${needsZoneId} LIMIT 1
    `;
    return rows[0]?.name ?? null;
  }
  return null;
}

function getCadenceDays(recurrence: string): number {
  if (recurrence === "Weekly")    return 7;
  if (recurrence === "Quarterly") return 90;
  return 30;
}

function instanceLabel(recurrence: string, idx: number): string {
  if (recurrence === "Weekly")    return `Week ${idx + 1}`;
  if (recurrence === "Quarterly") return `Q${idx + 1}`;
  return `Month ${idx + 1}`;
}

type PitstopInstance = {
  pt: DbPitstop;
  title: string;
  pitstopStart: Date;
  pitstopTarget: Date;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rows = await prisma.$queryRaw<{ pitstops: unknown }[]>`
    SELECT pitstops FROM "GoalTemplateDef"
    WHERE slug = ${id} AND "isActive" = true
    LIMIT 1
  `;
  if (!rows[0]) return Response.json({ error: "Template not found" }, { status: 404 });

  const body = await req.json();
  const {
    title, description, targetDate, startDate, params: templateParams,
    needsDomain, needsSettlementId, needsClusterId, needsZoneId, needsCityId,
    linkedFacilityId,
    ownerId,
    recurrence,
    parameter,
  } = body;

  if (!title) return Response.json({ error: "Title required" }, { status: 400 });
  if (!startDate) return Response.json({ error: "Start date required" }, { status: 400 });

  const rawPitstops = RELATIONAL_READS ? await templatePitstopsFromRelationalBySlug(id) : (rows[0].pitstops as DbPitstop[]);
  const pitstopTemplates = interpolatePitstops(rawPitstops, templateParams ?? {});
  const goalStart = new Date(startDate);
  const goalOwnerId = ownerId ?? session.user.id;

  // Expand recurring pitstops into individual instances
  const allInstances: PitstopInstance[] = [];
  for (const pt of pitstopTemplates) {
    const isRecurring = pt.recurrence && pt.recurrence !== "None";
    const repeatCount = isRecurring ? Math.max(1, pt.repeatCount ?? 1) : 1;
    const cadence = isRecurring ? getCadenceDays(pt.recurrence!) : 0;

    const startOffset = Number.isFinite(pt.startSlaDays) ? pt.startSlaDays : 0;
    const targetOffset = Number.isFinite(pt.slaDays) ? pt.slaDays : startOffset;

    for (let i = 0; i < repeatCount; i++) {
      const pitstopStart = new Date(goalStart);
      pitstopStart.setDate(pitstopStart.getDate() + startOffset + i * cadence);
      const pitstopTarget = new Date(goalStart);
      pitstopTarget.setDate(pitstopTarget.getDate() + targetOffset + i * cadence);

      allInstances.push({
        pt,
        title: repeatCount > 1 ? `${pt.title} (${instanceLabel(pt.recurrence!, i)})` : pt.title,
        pitstopStart: snapToWeekday(pitstopStart),
        pitstopTarget: snapToWeekday(pitstopTarget),
      });
    }
  }

  const resolvedTargetDate = snapToWeekday(
    targetDate
      ? new Date(targetDate)
      : allInstances.length > 0
        ? allInstances.reduce((max, inst) => inst.pitstopTarget > max ? inst.pitstopTarget : max, allInstances[0].pitstopTarget)
        : (() => { const d = new Date(goalStart); d.setDate(d.getDate() + 365); return d; })()
  );

  const validTypes = [
    "Meeting", "Training", "SiteVisit", "Discussion",
    "AppDevelopment", "Budgeting", "Proposal", "Research", "Review", "Custom",
  ];
  const validRecurrences = ["None", "Weekly", "Monthly", "Quarterly"];

  const validGoalRecurrences = ["None", "Weekly", "Monthly", "Quarterly", "Yearly"];
  const goal = await prisma.goal.create({
    data: {
      title,
      description: description ?? null,
      status: "Active",
      ownerId: goalOwnerId,
      startDate: goalStart,
      targetDate: resolvedTargetDate,
      needsDomain: needsDomain ?? null,
      parameter: (parameter != null && !isNaN(Number(parameter))) ? Number(parameter) : null,
      needsSettlementId: needsSettlementId ?? null,
      needsClusterId: needsClusterId ?? null,
      needsZoneId: needsZoneId ?? null,
      needsCityId: needsCityId ?? null,
      linkedFacilityId: linkedFacilityId ?? null,
      ...(recurrence && recurrence !== "None" && validGoalRecurrences.includes(recurrence) && { recurrence }),
      pitstops: {
        create: allInstances.map((inst, idx) => {
          const pitstopType = validTypes.includes(inst.pt.type) ? inst.pt.type : "Discussion";
          const recurrence = inst.pt.recurrence && validRecurrences.includes(inst.pt.recurrence)
            ? inst.pt.recurrence
            : "None";

          const pitstopTemplateKey = (inst.pt.key ?? "").trim() || slugifyChecklistText(inst.pt.title);
          return {
            title: inst.title,
            type: pitstopType as any,
            notes: inst.pt.notes,
            order: idx,
            ownerId: goalOwnerId,
            ownerInherited: true,
            recurrence: recurrence as any,
            startDate: inst.pitstopStart,
            targetDate: inst.pitstopTarget,
            templateSlug: id,
            templateKey: pitstopTemplateKey || null,
            checklistItems: {
              create: inst.pt.checklist.map((item, itemIdx) => {
                const itemActivities = item.activities ?? [];
                const derivedType = item.completionType ?? itemActivities[0]?.completionType;
                const itemKey = (item.key ?? "").trim() || slugifyChecklistText(item.text);
                return {
                  text: item.text,
                  order: itemIdx,
                  key: itemKey || null,
                  templateSlug: id,
                  ...(derivedType && derivedType !== "Activity"
                    ? { completionType: derivedType as "Voice" | "Upload" }
                    : {}),
                };
              }),
            },
          };
        }),
      },
    },
    include: {
      owner: { select: { id: true, name: true, image: true } },
      pitstops: { select: { id: true, status: true } },
    },
  });

  // Fetch pitstops in template order — Prisma include does not guarantee insertion order
  const pitstopsOrdered = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Pitstop"
    WHERE "goalId" = ${goal.id} AND "deletedAt" IS NULL
    ORDER BY "order" ASC
  `;

  // Set progressTag on pitstops
  for (let idx = 0; idx < allInstances.length; idx++) {
    const tag = allInstances[idx]?.pt.progressTag ?? null;
    const pitstop = pitstopsOrdered[idx];
    if (!pitstop) continue;
    await prisma.$executeRaw`
      UPDATE "Pitstop" SET "progressTag" = ${tag} WHERE id = ${pitstop.id}
    `;
  }

  // Auto-follow: goal owner always follows; creator also follows if creating on behalf of someone else
  await prisma.goalFollow.upsert({
    where: { userId_goalId: { userId: goalOwnerId, goalId: goal.id } },
    create: { userId: goalOwnerId, goalId: goal.id },
    update: {},
  });
  if (goalOwnerId !== session.user.id) {
    await prisma.goalFollow.upsert({
      where: { userId_goalId: { userId: session.user.id, goalId: goal.id } },
      create: { userId: session.user.id, goalId: goal.id },
      update: {},
    });
  }

  auditLog({
    entityType: "Goal", entityId: goal.id, userId: session.user.id,
    action: "created", newValue: `${title} (from template)`,
  });

  // Auto-schedule activities for checklist items that have activities defined
  const appSettings = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM "AppSetting"
  `;
  const schedConfig = buildScheduleConfig(appSettings);
  const cityName = await resolveCityName(needsCityId, needsZoneId, needsClusterId, needsSettlementId);

  const offsetClamps: Array<{ pitstopTitle: string; activityTitle: string; requestedOffset: number; appliedDate: string }> = [];

  for (let piIdx = 0; piIdx < allInstances.length; piIdx++) {
    const pitstop = pitstopsOrdered[piIdx];
    const inst = allInstances[piIdx];
    if (!pitstop || !inst) continue;

    const pt = inst.pt;

    const itemsWithActivities = pt.checklist
      .map((item, idx) => ({ item, idx, activities: normalizeActivities(item) }))
      .filter(({ activities }) => activities.length > 0);

    const totalActivities = itemsWithActivities.reduce((sum, { activities }) => sum + activities.length, 0);
    if (totalActivities === 0) continue;

    // Use the instance's own date window for scheduling. SLA=0 collapses to a
    // single-day window (start === target) so all activities — pinned or
    // unpinned — land on the same day.
    const pitstopWindowStart = inst.pitstopStart;
    const pitstopWindowEnd = inst.pitstopTarget >= inst.pitstopStart
      ? inst.pitstopTarget
      : inst.pitstopStart;

    const workingDays = getWorkingDays(pitstopWindowStart, pitstopWindowEnd, cityName, schedConfig);
    const effectiveDays = workingDays.length > 0
      ? workingDays
      : [nearestWorkingDay(pitstopWindowEnd, cityName, schedConfig)];

    // Flatten activities in checklist-order to match the date stream
    const flatActivities = itemsWithActivities.flatMap(({ activities }) => activities);
    const { dates: scheduledDates, clamps } = scheduleActivitiesInWindow(
      flatActivities.map(a => ({ dayOffset: a.dayOffset })),
      pitstopWindowStart,
      effectiveDays,
    );
    for (const c of clamps) {
      offsetClamps.push({
        pitstopTitle: inst.title,
        activityTitle: flatActivities[c.index]?.title ?? "",
        requestedOffset: c.requestedOffset,
        appliedDate: c.appliedDate.toISOString(),
      });
    }
    const eventType = pitstopTypeToEventType(pt.type);

    const ciIds = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ChecklistItem" WHERE "pitstopId" = ${pitstop.id} ORDER BY "order" ASC
    `;

    let dateIdx = 0;
    for (const { idx: ciIdx, activities } of itemsWithActivities) {
      const dbId = ciIds[ciIdx]?.id;
      for (const act of activities) {
        const scheduledAt = scheduledDates[dateIdx++];
        if (!dbId || !scheduledAt) continue;

        const activityTemplateKey = (act.key ?? "").trim() || slugifyChecklistText(act.title);

        const event = await prisma.pitstopEvent.create({
          data: {
            title: act.title,
            type: eventType as any,
            scheduledAt,
            originalScheduledAt: scheduledAt,
            createdById: session.user.id,
            templateKey: activityTemplateKey || null,
            pitstops: { create: [{ pitstopId: pitstop.id }] },
            attendees: { create: [{ userId: goalOwnerId }] },
          },
          select: { id: true },
        });

        await prisma.$executeRaw`
          UPDATE "PitstopEvent" SET "checklistItemId" = ${dbId}
          WHERE id = ${event.id} AND "checklistItemId" IS NULL
        `;
        await prisma.$executeRaw`
          UPDATE "ChecklistItem"
          SET status = 'Scheduled'::"ChecklistItemStatus", "updatedAt" = NOW()
          WHERE id = ${dbId} AND status = 'NotStarted'::"ChecklistItemStatus"
        `;
      }
    }
  }

  // Layer 3: auto-link this goal into a programme journey (silent on failures)
  try {
    await attachGoalToProgrammeJourney({
      goalId: goal.id,
      templateSlug: id,
      domain: needsDomain ?? null,
      settlementId: needsSettlementId ?? null,
    });
  } catch (e) {
    console.error("[templates/apply] programme journey attach failed:", e);
  }

  // Existing-nature templates (`-existing`) describe already-operating programmes/centres, not a
  // setup project — so they're born LIVE (visit-driven), not setup. setCentreLive freezes the
  // domain catalog + seeds a recurring Operations pitstop + flips mode. Silent on failure so goal
  // creation never breaks; a stuck one can still be taken live via the button / backfill.
  if (id.endsWith("-existing")) {
    try {
      await setCentreLive(goal.id);
    } catch (e) {
      console.error("[templates/apply] auto go-live for -existing template failed:", e);
    }
  }

  return Response.json({ ...goal, offsetClamps }, { status: 201 });
}
