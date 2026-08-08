-- Ad-hoc tasks: work that doesn't belong to the goal → pitstop → checklist →
-- activity hierarchy. An ActionPoint becomes the single tracking model for both
-- visit follow-ups (source='activity', the existing rows) and free-standing
-- tasks (source='adhoc'), so a person has one inbox rather than two.
--
-- The three parent FKs go nullable. ON DELETE CASCADE only fires on a set FK, so
-- existing rows keep their current behaviour untouched. Every read filters by a
-- specific parent id, so null-parent rows are simply excluded from them.

ALTER TABLE "ActionPoint" ALTER COLUMN "goalId"         DROP NOT NULL;
ALTER TABLE "ActionPoint" ALTER COLUMN "pitstopId"      DROP NOT NULL;
ALTER TABLE "ActionPoint" ALTER COLUMN "pitstopEventId" DROP NOT NULL;

-- Stored rather than derived from a null goalId: an ad-hoc task may well name a
-- goal, so a null parent is not a reliable discriminator.
ALTER TABLE "ActionPoint" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'activity';

-- Who asked, as distinct from who recorded it. Differs from createdById only on
-- delegation, and is what makes a task closeable-but-not-editable by its owner.
ALTER TABLE "ActionPoint" ADD COLUMN "assignedById" TEXT;

-- Geography, mirroring Goal's four levels so an ad-hoc task can be scoped to a
-- city, zone, cluster or settlement when it names no goal.
ALTER TABLE "ActionPoint" ADD COLUMN "needsSettlementId" TEXT;
ALTER TABLE "ActionPoint" ADD COLUMN "needsClusterId"    TEXT;
ALTER TABLE "ActionPoint" ADD COLUMN "needsZoneId"       TEXT;
ALTER TABLE "ActionPoint" ADD COLUMN "needsCityId"       TEXT;

-- Set when the task is also presented as a catalog item on a live centre; the
-- join that lets a tick on the visit screen close the task.
ALTER TABLE "ActionPoint" ADD COLUMN "catalogItemKey" TEXT;

CREATE INDEX "ActionPoint_source_status_dueDate_idx" ON "ActionPoint"("source", "status", "dueDate");
CREATE INDEX "ActionPoint_needsClusterId_status_idx"  ON "ActionPoint"("needsClusterId", "status");
CREATE INDEX "ActionPoint_assignedById_status_idx"    ON "ActionPoint"("assignedById", "status");

ALTER TABLE "ActionPoint" ADD CONSTRAINT "ActionPoint_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionPoint" ADD CONSTRAINT "ActionPoint_needsSettlementId_fkey"
  FOREIGN KEY ("needsSettlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionPoint" ADD CONSTRAINT "ActionPoint_needsClusterId_fkey"
  FOREIGN KEY ("needsClusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionPoint" ADD CONSTRAINT "ActionPoint_needsZoneId_fkey"
  FOREIGN KEY ("needsZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActionPoint" ADD CONSTRAINT "ActionPoint_needsCityId_fkey"
  FOREIGN KEY ("needsCityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
