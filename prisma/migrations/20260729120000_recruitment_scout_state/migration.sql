-- Shared team scouting state for recruitment docs at /recruitment/[slug].
-- One row per doc; the doc's client PUTs its whole state blob (scores,
-- verdicts, notes, question ticks). `version` bumps on every write so pollers
-- can detect teammate edits. Super-admin only; gated in the API route.

CREATE TABLE "RecruitmentScoutState" (
    "slug" TEXT NOT NULL,
    "stateJson" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "RecruitmentScoutState_pkey" PRIMARY KEY ("slug")
);

ALTER TABLE "RecruitmentScoutState"
  ADD CONSTRAINT "RecruitmentScoutState_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
