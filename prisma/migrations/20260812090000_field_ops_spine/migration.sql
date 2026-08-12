-- Field-ops surface (/field): the minimal RP spine. Purely additive — new tables,
-- new nullable columns, and one constraint loosening (visitEventId NOT NULL -> nullable).
-- The old Pitstop/ChecklistItem/PitstopEvent/CentreCatalog spine is left intact.
-- (Pre-existing live-DB drift on ChecklistItem/Goal/PitstopEvent indexes and SchoolPlan
-- defaults is intentionally NOT included here — it is unrelated to this feature.)

-- CreateEnum
CREATE TYPE "FieldStepKind" AS ENUM ('Setup', 'Visit');

-- CreateEnum
CREATE TYPE "FieldStepStatus" AS ENUM ('Todo', 'InProgress', 'Blocked', 'Done', 'Skipped');

-- AlterTable
ALTER TABLE "CaregiverPracticeObservation" ADD COLUMN     "fieldVisitId" TEXT,
ALTER COLUMN "visitEventId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "cadenceCount" INTEGER,
ADD COLUMN     "cadencePeriod" TEXT,
ADD COLUMN     "fieldAnchorAt" TIMESTAMP(3),
ADD COLUMN     "overallSlaDays" INTEGER;

-- CreateTable
CREATE TABLE "FieldStep" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "kind" "FieldStepKind" NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "templateSlug" TEXT,
    "stepKey" TEXT,
    "slaDays" INTEGER,
    "startSlaDays" INTEGER,
    "blockedByKey" TEXT,
    "dueDate" TIMESTAMP(3),
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "formKind" TEXT,
    "formSchema" JSONB,
    "status" "FieldStepStatus" NOT NULL DEFAULT 'Todo',
    "answers" JSONB,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisit" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "arrivedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldVisitStep" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "FieldStepStatus" NOT NULL DEFAULT 'Todo',
    "answers" JSONB,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldVisitStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupStepTemplate" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "stepKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slaDays" INTEGER,
    "startSlaDays" INTEGER,
    "blockedByKey" TEXT,
    "formKind" TEXT,
    "formSchema" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupStepTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitStepTemplate" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "stepKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "formKind" TEXT,
    "formSchema" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitStepTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDomainConfig" (
    "domain" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'settlement',
    "overallSlaDays" INTEGER,
    "cadenceCount" INTEGER,
    "cadencePeriod" TEXT,
    "hasLivePhase" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldDomainConfig_pkey" PRIMARY KEY ("domain")
);

-- CreateIndex
CREATE INDEX "FieldStep_goalId_kind_order_idx" ON "FieldStep"("goalId", "kind", "order");

-- CreateIndex
CREATE INDEX "FieldStep_goalId_status_idx" ON "FieldStep"("goalId", "status");

-- CreateIndex
CREATE INDEX "FieldStep_templateSlug_stepKey_idx" ON "FieldStep"("templateSlug", "stepKey");

-- CreateIndex
CREATE INDEX "FieldVisit_goalId_scheduledFor_idx" ON "FieldVisit"("goalId", "scheduledFor");

-- CreateIndex
CREATE INDEX "FieldVisitStep_stepId_status_idx" ON "FieldVisitStep"("stepId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FieldVisitStep_visitId_stepId_key" ON "FieldVisitStep"("visitId", "stepId");

-- CreateIndex
CREATE INDEX "SetupStepTemplate_domain_order_idx" ON "SetupStepTemplate"("domain", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SetupStepTemplate_domain_stepKey_key" ON "SetupStepTemplate"("domain", "stepKey");

-- CreateIndex
CREATE INDEX "VisitStepTemplate_domain_order_idx" ON "VisitStepTemplate"("domain", "order");

-- CreateIndex
CREATE UNIQUE INDEX "VisitStepTemplate_domain_stepKey_key" ON "VisitStepTemplate"("domain", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaregiverPracticeObservation_fieldVisitId_practiceId_key" ON "CaregiverPracticeObservation"("fieldVisitId", "practiceId");

-- AddForeignKey
ALTER TABLE "CaregiverPracticeObservation" ADD CONSTRAINT "CaregiverPracticeObservation_fieldVisitId_fkey" FOREIGN KEY ("fieldVisitId") REFERENCES "FieldVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldStep" ADD CONSTRAINT "FieldStep_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldStep" ADD CONSTRAINT "FieldStep_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_arrivedById_fkey" FOREIGN KEY ("arrivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisit" ADD CONSTRAINT "FieldVisit_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitStep" ADD CONSTRAINT "FieldVisitStep_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FieldVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitStep" ADD CONSTRAINT "FieldVisitStep_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FieldStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldVisitStep" ADD CONSTRAINT "FieldVisitStep_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
