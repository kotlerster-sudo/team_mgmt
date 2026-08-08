-- Phase 2: link a caregiver-practice observation to its follow-up ActionPoint
-- (raised when action = EscalateToSupervisor) + enforce one row per practice
-- per visit so the writer can upsert + reconcile the AP.

ALTER TABLE "CaregiverPracticeObservation" ADD COLUMN "actionPointId" TEXT;

-- The compound unique below covers visitEventId (leftmost), so the standalone drops.
DROP INDEX "CaregiverPracticeObservation_visitEventId_idx";

CREATE UNIQUE INDEX "CaregiverPracticeObservation_actionPointId_key" ON "CaregiverPracticeObservation"("actionPointId");
CREATE UNIQUE INDEX "CaregiverPracticeObservation_visitEventId_practiceId_key" ON "CaregiverPracticeObservation"("visitEventId", "practiceId");

ALTER TABLE "CaregiverPracticeObservation"
  ADD CONSTRAINT "CaregiverPracticeObservation_actionPointId_fkey"
  FOREIGN KEY ("actionPointId") REFERENCES "ActionPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
