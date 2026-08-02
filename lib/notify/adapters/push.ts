import prisma from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import type { AdapterResult, ChannelInput } from "../types";

export async function sendPush(input: ChannelInput): Promise<AdapterResult> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { channel: "push", status: "skipped", error: "VAPID keys not configured" };
  }

  const subCount = await prisma.pushSubscription.count({ where: { userId: input.userId } });
  if (subCount === 0) {
    return { channel: "push", status: "skipped", error: "no push subscriptions" };
  }

  try {
    await sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      link: input.link,
    });
    return { channel: "push", status: "sent" };
  } catch (err) {
    return {
      channel: "push",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
