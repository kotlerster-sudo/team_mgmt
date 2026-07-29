

export type TabKey =
  | "today" | "past" | "health" | "zl-health" | "rp-health" | "coverage"
  | "clusters" | "goals" | "overview" | "geography" | "team" | "pipeline"
  | "attention" | "team-health" | "engagement" | "activity"
  | "follow-ups"
  | "team-report"
  | "accountability";

/**
 * Each row is one AuditLog "Activity / created" entry joined back to the
 * PitstopEvent it created. Powers the Leader's Activity tab. Soft-deleted
 * activities are filtered out at the server.
 */
export type LeaderActivityCreated = {
  auditId: string;
  /** When the create action happened — the natural "day" bucket. */
  createdAt: string;
  /** Activity (PitstopEvent) id — null if the underlying activity was deleted. */
  activityId: string;
  title: string;
  type: "Meeting" | "Visit" | "Event" | string;
  scheduledAt: string;
  creator: { id: string; name: string | null; image: string | null };
  goal: {
    id: string;
    title: string;
    needsDomain: string | null;
    needsCluster: { id: string; name: string } | null;
    needsSettlement: { id: string; name: string } | null;
  } | null;
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActivityGoal = {
  id: string; title: string; needsDomain: string | null;
  linkedFacilityId?: string | null;
  needsCluster:    { id: string; name: string } | null;
  needsSettlement: { id: string; name: string } | null;
  needsZone:       { id: string; name: string } | null;
  /**
   * Resolved linked facility (LayerFeature). Populated when the goal points
   * at a specific facility (creche, centre, water ATM, etc.). Carries the
   * facility's own cluster — many goals don't set `needsCluster` directly
   * but the facility does, so ActivityCard falls back through this chain
   * to surface "where is this visit" reliably.
   */
  linkedFacility?: {
    name: string;
    cluster: { id: string; name: string } | null;
  } | null;
};
export type Activity = {
  id: string; title: string; type: string; scheduledAt: string;
  location: string | null; status: string;
  attendees?: { user: { id: string; name: string | null } }[];
  pitstops?: { pitstop: { id: string; title: string; ownerId: string; goal: ActivityGoal } }[];
  /* Reschedule provenance — propagated when the page-level loader selects
     them. UI uses `rescheduleCount` to badge chronic slippage. */
  rescheduleCount?: number;
  rescheduleReasonCode?: string | null;
  /* Add-to-today override. When set to today's start, this activity also
     surfaces on today's list regardless of where scheduledAt actually lives. */
  displayDate?: string | null;
  /* Lifetime count of add_to_today AuditLog actions for this event. Drives
     the "Pulled N×" chip — surfaces patterns of repeated pull-ins even when
     the activity isn't currently pulled. Populated by the home loader. */
  addedToTodayCount?: number;
  /* Optional Done-log enrichment — present on `rpDoneActivities` from the
     page loader so the Done-log feed can render proof + completion time. */
  completedAt?: string | null;
  completedBy?: { id: string; name: string | null } | null;
  checklistItem?: {
    id: string;
    notes: string | null;
    completionType: "Activity" | "Voice" | "Upload";
    attachments: { id: string; url: string; name: string; mimeType: string | null }[];
  } | null;
};

export type ChecklistItem = {
  id: string; text: string; status: string; checked: boolean;
  completionType: "Activity" | "Voice" | "Upload";
  activities: { id: string; title: string; status: string; scheduledAt: string; type: string }[];
  /* Stable catalog binding + read-only enrichments. Populated by the supervisory
     drill-down (loadCentreDetail) so the read-only view can mirror the RP's rich
     checklist card — the interactive RP paths leave these undefined. */
  key?: string | null;
  templateSlug?: string | null;
  /** blocksSignoff — soft-mandatory for a clean visit close (from the centre catalog). */
  mandatory?: boolean;
  /** null | "pending" | "approved" | "rejected" — from CatalogItemApproval. */
  approval?: string | null;
  /** Indicator/journey-outcome labels this checklist captures on completion. */
  indicators?: { label: string; color: string; kind: "facility" | "journey" }[];
  pitstop: {
    id: string; title: string; targetDate: string | null; status: string; ownerId: string;
    owner: { id: string; name: string | null };
    goal: {
      id: string; title: string; needsDomain: string | null;
      linkedFacilityId?: string | null;
      needsCluster: { id: string; name: string } | null;
      needsSettlement?: { id: string; name: string } | null;
      linkedFacility?: {
        name: string;
        cluster: { id: string; name: string } | null;
      } | null;
    };
  };
};

export type Goal = {
  id: string; title: string; status: string;
  needsDomain: string | null; needsClusterId: string | null; needsZoneId: string | null;
  parameter: number | null; outcomeCount: number | null;
  targetDate?: string | null;
  ownerId: string | null;
  owner: { id: string; name: string | null } | null;
  coOwners?: { userId: string }[];
  needsCluster?: { id: string; name: string } | null;
  pitstops: { id: string; status: string }[];
};

export type TeamMember = {
  id: string; name: string | null; image: string | null;
  rpClusters?: { id: string; name: string }[];
};

export type ZLTeamActivity = {
  id: string; title: string; type: string; scheduledAt: string;
  location?: string | null; status: string;
  attendees: { user: { id: string; name: string | null } }[];
  pitstops: {
    pitstop: {
      ownerId: string;
      owner?: { id: string; name: string | null } | null;
      targetDate: string | null;
      goal: {
        id: string; title: string; needsDomain: string | null; needsClusterId: string | null;
        needsCluster:    { id: string; name: string } | null;
        needsSettlement: { id: string; name: string } | null;
        needsZone:       { id: string; name: string } | null;
      };
    };
  }[];
};
