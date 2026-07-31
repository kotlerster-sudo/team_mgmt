/**
 * ActionPoint client-side types. Mirrors the selectFull projection on the API
 * (app/api/action-points/route.ts) and the pitstop-nested list. Keep both in
 * sync — the API is the source of truth for which fields exist.
 */

export type APUser = { id: string; name: string | null; image: string | null };

export type APStatus = "open" | "done" | "cancelled";
export type APPriority = "routine" | "urgent";

export type ActionPoint = {
  id: string;
  goalId: string;
  pitstopId: string;
  pitstopEventId: string;

  title: string;
  detail: string | null;
  partnerStaffLabel: string | null;

  ownerId: string;
  dueDate: string; // ISO
  priority: APPriority;

  status: APStatus;
  closureNote: string | null;
  closureProofUrl: string | null;
  completedAt: string | null;
  completedById: string | null;

  createdAt: string;
  createdById: string;

  owner?: APUser;
  createdBy?: APUser;
  completedBy?: APUser | null;
  pitstop?: { id: string; title: string; goalId?: string };
  goal?: { id: string; title: string };
  pitstopEvent?: { id: string; title: string; scheduledAt?: string; status?: string };
};

/** Input shape for a single AP being created via the close-out modal. */
export type ActionPointDraft = {
  // Stable client-side row id for React keys + edit handlers; never sent to server.
  clientId: string;
  pitstopEventId: string;
  title: string;
  detail: string;
  // YYYY-MM-DD as displayed in the date input; converted to ISO on submit.
  dueDateYmd: string;
  priority: APPriority;
  partnerStaffLabel: string;
  // Client-only tag linking an auto-prefilled draft to the failed
  // non-negotiable checklist item that spawned it (so flipping the answer
  // back removes exactly this draft). Never sent to the server.
  sourceItemKey?: string;
};
