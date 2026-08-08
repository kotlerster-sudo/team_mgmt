-- Caregiver Practice Observation — creche live-visit quality layer.
--
-- A dedicated observation layer (NOT the binary FacilityIndicator scored
-- checklist): 3-level taxonomy + graded 5-value status + exception-based
-- capture + derived carry-forward. Additive, zero backfill.

CREATE TYPE "CaregiverPracticeStatus" AS ENUM ('OK', 'NeedsImprovement', 'NotPracticed', 'NotObserved', 'NotApplicable');
CREATE TYPE "CaregiverPracticeAction" AS ENUM ('FeedbackOnSpot', 'RefresherPlanned', 'EscalateToSupervisor');

CREATE TABLE "CaregiverPracticeCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CaregiverPracticeCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaregiverPracticeCategory_code_key" ON "CaregiverPracticeCategory"("code");

CREATE TABLE "CaregiverPractice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "shortLabel" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "trainingModule" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CaregiverPractice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaregiverPractice_code_key" ON "CaregiverPractice"("code");
CREATE INDEX "CaregiverPractice_categoryId_sortOrder_idx" ON "CaregiverPractice"("categoryId", "sortOrder");
CREATE INDEX "CaregiverPractice_trainingModule_idx" ON "CaregiverPractice"("trainingModule");

CREATE TABLE "CaregiverPracticeObservation" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "visitEventId" TEXT NOT NULL,
    "status" "CaregiverPracticeStatus" NOT NULL,
    "remarks" TEXT,
    "action" "CaregiverPracticeAction",
    "photoUrl" TEXT,
    "capturedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaregiverPracticeObservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CaregiverPracticeObservation_facilityId_practiceId_capturedAt_idx" ON "CaregiverPracticeObservation"("facilityId", "practiceId", "capturedAt");
CREATE INDEX "CaregiverPracticeObservation_visitEventId_idx" ON "CaregiverPracticeObservation"("visitEventId");
CREATE INDEX "CaregiverPracticeObservation_facilityId_status_idx" ON "CaregiverPracticeObservation"("facilityId", "status");
CREATE INDEX "CaregiverPracticeObservation_practiceId_status_idx" ON "CaregiverPracticeObservation"("practiceId", "status");

ALTER TABLE "CaregiverPractice" ADD CONSTRAINT "CaregiverPractice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CaregiverPracticeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "CaregiverPractice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "LayerFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_visitEventId_fkey" FOREIGN KEY ("visitEventId") REFERENCES "PitstopEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
