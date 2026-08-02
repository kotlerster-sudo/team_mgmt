import type { NotificationType } from "@/app/generated/prisma/client";

export type WikiNotificationKind =
  | "wiki_flag_created"
  | "wiki_comment_created"
  | "wiki_weekly_digest"
  | "wiki_review_overdue"
  | "wiki_review_steward_14d"
  | "wiki_review_steward_30d"
  | "wiki_owner_term_expiring"
  | "wiki_owner_term_expired"
  | "wiki_handover_proposed"
  | "wiki_circle_prompt"
  | "wiki_gap_assigned"
  | "wiki_gap_resolved"
  | "wiki_gap_published"
  | "wiki_shadow_recorded"
  | "wiki_page_orphaned";

export type ChannelName = "push" | "inApp" | "email";

/**
 * The wording an email is dressed in. Split out because the adapters are now
 * shared with the grant portal, whose recipients are external grantee
 * organisations — "you're in the wiki rhythm" would be nonsense in their inbox,
 * and they have no access to /settings/notifications to act on it.
 */
export interface NotifyBrand {
  /** Small uppercase eyebrow above the title. */
  eyebrow: string;
  /** Label on the call-to-action button. */
  cta: string;
  /** One line saying why this landed in their inbox. Plain text. */
  footer: string;
  /** Overrides RESEND_FROM_EMAIL for this message. */
  from?: string;
}

export const WIKI_BRAND: NotifyBrand = {
  eyebrow: "Pitstops Wiki",
  cta: "Open in Pitstops",
  footer: "You're getting this because you're in the wiki rhythm. Adjust delivery in your notification settings.",
};

/** What a channel adapter needs. Deliberately free of wiki concepts. */
export interface ChannelInput {
  userId: string;
  notificationType: NotificationType;
  title: string;
  body?: string;
  link?: string;
  brand?: NotifyBrand;
}

export interface DispatchInput {
  userId: string;
  kind: WikiNotificationKind;
  pageId?: string | null;
  title: string;
  body?: string;
  link?: string;
}

export interface AdapterResult {
  channel: ChannelName;
  status: "sent" | "skipped" | "failed";
  error?: string;
}

export const WIKI_KIND_TO_NOTIFICATION_TYPE: Record<
  WikiNotificationKind,
  NotificationType
> = {
  wiki_flag_created: "WikiFlagCreated",
  wiki_comment_created: "WikiCommentCreated",
  wiki_weekly_digest: "WikiWeeklyDigest",
  wiki_review_overdue: "WikiReviewOverdue",
  wiki_review_steward_14d: "WikiReviewOverdue",
  wiki_review_steward_30d: "WikiReviewOverdue",
  wiki_owner_term_expiring: "WikiOwnerTermExpiring",
  wiki_owner_term_expired: "WikiOwnerTermExpired",
  wiki_handover_proposed: "WikiHandoverProposed",
  wiki_circle_prompt: "WikiCirclePrompt",
  wiki_gap_assigned: "WikiGapAssigned",
  wiki_gap_resolved: "WikiGapResolved",
  wiki_gap_published: "WikiGapPublished",
  wiki_shadow_recorded: "WikiShadowRecorded",
  wiki_page_orphaned: "WikiReviewOverdue",
};
