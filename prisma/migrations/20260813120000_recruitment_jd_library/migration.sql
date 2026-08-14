-- Recruitment JD library (Phase 1). Purely additive — three new tables
-- (RecruitmentLocation, RecruitmentJob, RecruitmentScoutingDay). The existing
-- RecruitmentScoutState is untouched. Existing blob-only scouting docs keep
-- working; `RecruitmentScoutingDay` is populated from now onwards. `jobId` on
-- ScoutingDay is nullable so JD-less one-off runs remain possible.

-- CreateTable
CREATE TABLE "RecruitmentLocation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "primaryLanguage" TEXT,
    "localSalaryBands" JSONB,
    "localReferenceOrgs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "localRedFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mobilityDefault" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "RecruitmentLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentJob" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seniority" TEXT,
    "locationId" TEXT NOT NULL,
    "dayToDay" TEXT NOT NULL DEFAULT '',
    "mustHaves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niceToHaves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hardDisqualifiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salaryBand" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'football',
    "notes" TEXT NOT NULL DEFAULT '',
    "redFlagRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yellowFlagRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scrutiniseFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lockedAxes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceDocUrl" TEXT,
    "extractedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "RecruitmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentScoutingDay" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "jobId" TEXT,
    "matchday" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "jobSnapshotJson" JSONB,
    "snapshotJson" JSONB NOT NULL,
    "renderedBlobUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentScoutingDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentLocation_slug_key" ON "RecruitmentLocation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentJob_slug_key" ON "RecruitmentJob"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentScoutingDay_slug_key" ON "RecruitmentScoutingDay"("slug");

-- CreateIndex
CREATE INDEX "RecruitmentScoutingDay_jobId_idx" ON "RecruitmentScoutingDay"("jobId");

-- AddForeignKey
ALTER TABLE "RecruitmentJob" ADD CONSTRAINT "RecruitmentJob_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RecruitmentLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentJob" ADD CONSTRAINT "RecruitmentJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentScoutingDay" ADD CONSTRAINT "RecruitmentScoutingDay_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RecruitmentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentScoutingDay" ADD CONSTRAINT "RecruitmentScoutingDay_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
