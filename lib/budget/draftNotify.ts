// One-shot notifications for the grant-making round-trip: the lead shares a
// draft, the grantee submits it, the lead sends it back. No cron and no dedup
// log — each of these fires on a deliberate human action, unlike the reporting
// reminders which repeat against a due date.

import prisma from "@/lib/prisma";
import { dispatchToChannels } from "@/lib/notify/dispatch";
import type { NotifyBrand } from "@/lib/notify/types";
import type { NotificationType } from "@/app/generated/prisma/client";

const EYEBROW = "Grant budget";

// Two footers, mirroring the reporting reminders: a grantee is not "the grant
// lead on this budget", and neither can reach /settings/notifications.
const PARTNER_BRAND: NotifyBrand = {
  eyebrow: EYEBROW,
  cta: "Open the budget",
  footer: "You're receiving this because your organisation is the grantee on this budget.",
};
const LEAD_BRAND: NotifyBrand = {
  eyebrow: EYEBROW,
  cta: "Open the budget",
  footer: "You're receiving this because you're the grant lead on this budget.",
};

type Audience = "grantee" | "lead";

/** Never let a delivery failure roll back the state change that triggered it —
 *  a budget that is shared but whose email bounced is still shared. */
async function fanOut(
  userIds: string[],
  audience: Audience,
  type: NotificationType,
  title: string,
  body: string,
  link: string,
) {
  await Promise.allSettled(
    userIds.map(userId =>
      dispatchToChannels({
        userId,
        notificationType: type,
        title,
        body,
        link,
        brand: audience === "grantee" ? PARTNER_BRAND : LEAD_BRAND,
      }),
    ),
  );
}

/** Every login the grantee org holds. The person who edits the budget and the
 *  person who signs for it are not always the same. */
async function granteeLogins(grantPartnerId: string | null): Promise<string[]> {
  if (!grantPartnerId) return [];
  const rows = await prisma.grantPartnerUser.findMany({
    where: { grantPartnerId },
    select: { userId: true },
  });
  return rows.map(r => r.userId);
}

type NotifyBudget = {
  id: string;
  name: string;
  grantPartnerId: string | null;
  grantLeadId: string | null;
};

export async function notifyDraftShared(budget: NotifyBudget) {
  await fanOut(
    await granteeLogins(budget.grantPartnerId),
    "grantee",
    "BudgetDraftShared",
    `Budget open for your input — ${budget.name}`,
    "The Foundation has shared a draft budget with you. Adjust the line items, quantities and workings to your own costs, then submit it back.",
    `/budget/${budget.id}/draft`,
  );
}

export async function notifyDraftSubmitted(budget: NotifyBudget, granteeName: string | null) {
  if (!budget.grantLeadId) return;
  await fanOut(
    [budget.grantLeadId],
    "lead",
    "BudgetDraftSubmitted",
    `${granteeName ?? budget.name}: budget submitted`,
    `${granteeName ?? "The grantee"} has submitted their edits on ${budget.name}. Review the changes, then send it back or take the draft.`,
    `/budget/${budget.id}`,
  );
}

export async function notifyDraftSentBack(budget: NotifyBudget, note: string) {
  await fanOut(
    await granteeLogins(budget.grantPartnerId),
    "grantee",
    "BudgetDraftSentBack",
    `Budget returned for changes — ${budget.name}`,
    note,
    `/budget/${budget.id}/draft`,
  );
}
