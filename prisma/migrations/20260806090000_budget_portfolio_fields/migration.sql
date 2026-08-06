-- Approvals wizard, Step 5 portfolio comparables.
-- Adds 5 nullable metadata fields on Budget + a composite index used by the
-- comparables query in lib/approvals/budget/derive.ts. All columns nullable
-- so existing rows survive unmodified.

ALTER TABLE "Budget"
  ADD COLUMN "theme" TEXT,
  ADD COLUMN "interventionModel" TEXT,
  ADD COLUMN "beneficiariesPerYear" INTEGER,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAmount" DOUBLE PRECISION;

CREATE INDEX "Budget_city_domains_interventionModel_approvedAt_idx"
  ON "Budget"("city", "domains", "interventionModel", "approvedAt");
