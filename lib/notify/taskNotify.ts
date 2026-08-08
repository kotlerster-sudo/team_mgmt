// One-shot notifications for work handed from one person to another: a task
// assigned or reassigned, and catalog items deployed onto someone's centre.
// No cron and no dedup log — each fires on a deliberate human action.
//
// Self-assignment sends nothing. You already know what you asked yourself for.

import prisma from "@/lib/prisma";
import { dispatchToChannels } from "@/lib/notify/dispatch";
import type { NotifyBrand } from "@/lib/notify/types";

const BRAND: NotifyBrand = {
  eyebrow: "Pitstops",
  cta: "Open it",
  footer: "You're receiving this because someone on your team assigned this to you.",
};

/** Never let a delivery failure roll back the write that triggered it — a task
 *  that was assigned but whose email bounced is still assigned. */
async function fanOut(
  userIds: string[],
  notificationType: "TaskAssigned" | "CatalogItemDeployed",
  title: string,
  body: string,
  link: string,
) {
  await Promise.allSettled(
    userIds.map((userId) =>
      dispatchToChannels({ userId, notificationType, title, body, link, brand: BRAND }),
    ),
  );
}

const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export async function notifyTaskAssigned(task: {
  ownerId: string;
  assignedById: string;
  title: string;
  dueDate: Date | string | null;
}) {
  if (task.ownerId === task.assignedById) return;

  const assigner = await prisma.user.findUnique({
    where: { id: task.assignedById },
    select: { name: true },
  });
  const due = task.dueDate ? ` · due ${IST_DATE.format(new Date(task.dueDate))}` : "";

  await fanOut(
    [task.ownerId],
    "TaskAssigned",
    `${assigner?.name ?? "Someone"} assigned you a task`,
    `${task.title}${due}\n\nYou can close this off when it's done. Changes to the ask stay with the person who raised it.`,
    "/operations/tasks",
  );
}

/**
 * Everyone who holds the centre — owner and co-owners — minus the supervisor
 * who deployed. Without this the items are a silent surprise on the next visit.
 */
export async function notifyItemsDeployed(args: {
  goalId: string;
  deployedById: string;
  count: number;
}) {
  const goal = await prisma.goal.findUnique({
    where: { id: args.goalId },
    select: { title: true, ownerId: true, coOwners: { select: { userId: true } } },
  });
  if (!goal) return;

  const recipients = Array.from(
    new Set([goal.ownerId, ...goal.coOwners.map((c) => c.userId)]),
  ).filter((id) => id !== args.deployedById);
  if (!recipients.length) return;

  const deployer = await prisma.user.findUnique({
    where: { id: args.deployedById },
    select: { name: true },
  });
  const n = args.count;

  await fanOut(
    recipients,
    "CatalogItemDeployed",
    `${n} item${n === 1 ? "" : "s"} added to ${goal.title}`,
    `${deployer?.name ?? "Your supervisor"} added ${n === 1 ? "an item" : `${n} items`} to this centre's catalog under "Assigned". ${n === 1 ? "It" : "They"} will appear on your next visit.`,
    `/operations/visit/${args.goalId}`,
  );
}
