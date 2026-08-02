import prisma from "@/lib/prisma";
import { sendInApp } from "./adapters/inApp";
import { sendPush } from "./adapters/push";
import { sendEmail } from "./adapters/email";
import {
  type AdapterResult,
  type ChannelInput,
  type DispatchInput,
  WIKI_BRAND,
  WIKI_KIND_TO_NOTIFICATION_TYPE,
} from "./types";

const ADAPTERS = [sendInApp, sendPush, sendEmail] as const;

/** Fan one message out across every channel. Callers own their own logging. */
export async function dispatchToChannels(input: ChannelInput): Promise<AdapterResult[]> {
  return Promise.all(ADAPTERS.map((adapter) => adapter(input)));
}

/**
 * Dispatch a wiki-related notification through every available channel.
 * Writes one WikiNotificationLog row per channel result.
 */
export async function dispatchWikiNotification(input: DispatchInput): Promise<AdapterResult[]> {
  const results = await dispatchToChannels({
    userId: input.userId,
    notificationType: WIKI_KIND_TO_NOTIFICATION_TYPE[input.kind],
    title: input.title,
    body: input.body,
    link: input.link,
    brand: WIKI_BRAND,
  });

  await prisma.wikiNotificationLog.createMany({
    data: results.map((r) => ({
      userId: input.userId,
      pageId: input.pageId ?? null,
      kind: input.kind,
      channel: r.channel,
      status: r.status,
      payload: {
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
      error: r.error ?? null,
    })),
  });

  return results;
}

/**
 * Best-effort variant: catches every error so a notification failure
 * never blocks the original mutation (flag/comment create, cron tick, etc.).
 */
export async function dispatchWikiNotificationSafe(input: DispatchInput): Promise<void> {
  try {
    await dispatchWikiNotification(input);
  } catch (err) {
    console.error("[wiki notify] dispatch failed", { kind: input.kind, userId: input.userId, err });
  }
}
