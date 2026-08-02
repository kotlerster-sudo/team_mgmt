import prisma from "@/lib/prisma";
import { type AdapterResult, type ChannelInput } from "../types";

export async function sendInApp(input: ChannelInput): Promise<AdapterResult> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.notificationType,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });
    return { channel: "inApp", status: "sent" };
  } catch (err) {
    return {
      channel: "inApp",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
