// Daily cron — nudges grantees about reports at 10d / 3d / 0d before the due
// date and once again a week after it. Until this existed nothing in the portal
// ever told a partner a report was due; they found out when someone WhatsApped
// them. The internal grant lead is copied on the same thresholds so the chase
// is visible on our side too.
//
// Called with Authorization: Bearer $CRON_SECRET.

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { dispatchToChannels } from "@/lib/notify/dispatch";
import type { NotifyBrand } from "@/lib/notify/types";

const THRESHOLDS = [
  { type: "10d", days: 10 },
  { type: "3d", days: 3 },
  { type: "due", days: 0 },
  { type: "overdue7", days: -7 },
] as const;

const EYEBROW = "Grant reporting";
const CTA = "Open the report";

// Two footers, not one: a grantee is not "the grant lead on this budget", and
// neither of them can reach /settings/notifications — the wiki footer pointed
// external recipients at a page they have no access to.
const PARTNER_BRAND: NotifyBrand = {
  eyebrow: EYEBROW,
  cta: CTA,
  footer: "You're receiving this because your organisation files reports on this grant.",
};
const LEAD_BRAND: NotifyBrand = {
  eyebrow: EYEBROW,
  cta: CTA,
  footer: "You're receiving this because you're the grant lead on this budget.",
};

/** Slot dates are built entirely in UTC (lib/budget-report-slots.ts), so compare in UTC. */
const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = utcMidnight(new Date());
  const window = (days: number) => new Date(today - days * 86400000);

  const slots = await prisma.budgetReportSlot.findMany({
    where: {
      status: { in: ["pending", "sent_back"] },
      // Only the four threshold days can match; the range just keeps the scan small.
      dueDate: { gte: window(8), lte: window(-11) },
      budget: { status: "approved" },
    },
    select: {
      id: true,
      periodFrom: true,
      periodTo: true,
      dueDate: true,
      budget: {
        select: {
          id: true,
          name: true,
          grantLeadId: true,
          grantPartner: { select: { name: true, logins: { select: { userId: true } } } },
        },
      },
      reminderLogs: { select: { userId: true, type: true } },
    },
  });

  let sent = 0;

  for (const slot of slots) {
    const daysLeft = Math.round((utcMidnight(slot.dueDate) - today) / 86400000);
    const threshold = THRESHOLDS.find((t) => t.days === daysLeft);
    if (!threshold) continue;

    const { budget } = slot;
    const period = `${fmt(slot.periodFrom)} – ${fmt(slot.periodTo)}`;
    const link = `/budget/${budget.id}/reports/${slot.id}`;
    const overdue = daysLeft < 0;

    const recipients: { userId: string; title: string; brand: NotifyBrand }[] = [];

    // Every login the grantee holds: the person who files and the person who
    // signs are not always the same, and only one of them being told is how a
    // report goes quietly late.
    for (const login of budget.grantPartner?.logins ?? []) {
      recipients.push({
        userId: login.userId,
        brand: PARTNER_BRAND,
        title: overdue
          ? `Report overdue — ${budget.name}`
          : daysLeft === 0
            ? `Report due today — ${budget.name}`
            : `Report due in ${daysLeft} days — ${budget.name}`,
      });
    }
    if (budget.grantLeadId) {
      const who = budget.grantPartner?.name ?? budget.name;
      recipients.push({
        userId: budget.grantLeadId,
        brand: LEAD_BRAND,
        title: overdue
          ? `${who}: report is ${-daysLeft} days overdue`
          : daysLeft === 0
            ? `${who}: report due today`
            : `${who}: report due in ${daysLeft} days`,
      });
    }

    const alreadySent = new Set(slot.reminderLogs.map((l) => `${l.userId}:${l.type}`));

    for (const r of recipients) {
      if (alreadySent.has(`${r.userId}:${threshold.type}`)) continue;

      const results = await dispatchToChannels({
        userId: r.userId,
        notificationType: overdue ? "BudgetReportOverdue" : "BudgetReportDue",
        title: r.title,
        body: `Period ${period}. Due ${fmt(slot.dueDate)}.`,
        link,
        brand: r.brand,
      });

      // Log every channel outcome, including skips — a row here is what stops a
      // second run today from re-sending, so a skip must be recorded too.
      await prisma.budgetReportReminderLog.createMany({
        data: results.map((res) => ({
          slotId: slot.id,
          userId: r.userId,
          type: threshold.type,
          channel: res.channel,
          status: res.status,
          error: res.error ?? null,
        })),
        skipDuplicates: true,
      });
      sent++;
    }
  }

  return Response.json({ ok: true, slotsChecked: slots.length, sent });
}
