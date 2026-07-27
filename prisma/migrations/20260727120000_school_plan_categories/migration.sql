-- Add a per-plan grouping layer (SchoolPlanCategory) above SchoolPlanStep.
-- Existing plans are backfilled: 6 seeded categories per plan, and every
-- existing step is wired to a category by its template stepNo→categoryKey map.
-- User-added steps after this migration can freely re-parent to any category.
--
-- Written defensively (IF NOT EXISTS + ON CONFLICT + DO $$ blocks) so a
-- partially-applied first attempt can be marked rolled-back and re-run
-- against the same DB without conflict.

-- 1. New table -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SchoolPlanCategory" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchoolPlanCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SchoolPlanCategory_planId_key_key" ON "SchoolPlanCategory"("planId", "key");
CREATE INDEX IF NOT EXISTS "SchoolPlanCategory_planId_sortOrder_idx" ON "SchoolPlanCategory"("planId", "sortOrder");

DO $$ BEGIN
    ALTER TABLE "SchoolPlanCategory"
        ADD CONSTRAINT "SchoolPlanCategory_planId_fkey"
        FOREIGN KEY ("planId") REFERENCES "SchoolPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. New columns on SchoolPlanStep (both nullable during backfill) -------------
ALTER TABLE "SchoolPlanStep" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "SchoolPlanStep" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Make `key` nullable so user-added steps aren't forced to carry a template slug.
ALTER TABLE "SchoolPlanStep" ALTER COLUMN "key" DROP NOT NULL;

-- 3. Backfill: seed 6 categories per existing plan ----------------------------
INSERT INTO "SchoolPlanCategory" ("id", "planId", "key", "title", "description", "sortOrder", "createdAt", "updatedAt")
SELECT
    -- deterministic id so re-runs are safe: prefix + hash of (planId, key)
    'sc_' || substr(md5(p."id" || ':' || c."key"), 1, 22),
    p."id",
    c."key",
    c."title",
    c."description",
    c."sortOrder",
    NOW(),
    NOW()
FROM "SchoolPlan" p
CROSS JOIN (VALUES
    ('discovery',          'Discovery',              'Snapshot the school + its catchment.',                            1),
    ('site_infra',         'Site & infrastructure',  'Survey, design, services, refurbishment.',                        2),
    ('programme_partners', 'Programme & partners',   'Programme offer, anchor + specialist partners, staffing.',        3),
    ('approvals_timeline', 'Approvals & timeline',   'Departmental permissions and milestone timeline.',                4),
    ('financials',         'Financials',             'Vendor quotes and full budget vs standard.',                      5),
    ('governance',         'Governance',             'Risks, open issues, review + approval.',                          6)
) AS c("key", "title", "description", "sortOrder")
ON CONFLICT ("planId", "key") DO NOTHING;

-- 4. Backfill: wire every existing step to its category + assign sortOrder ----
-- Postgres UPDATE ... FROM can't reference the update target inside a JOIN's
-- ON clause; use a comma-list FROM and move the target reference to WHERE.
WITH step_map ("stepNo", "categoryKey", "sortOrder") AS (VALUES
    ( 1, 'discovery',          1),
    ( 4, 'discovery',          2),
    ( 2, 'site_infra',         1),
    ( 3, 'site_infra',         2),
    ( 5, 'site_infra',         3),
    ( 6, 'site_infra',         4),
    ( 7, 'programme_partners', 1),
    ( 8, 'programme_partners', 2),
    ( 9, 'programme_partners', 3),
    (10, 'programme_partners', 4),
    (13, 'approvals_timeline', 1),
    (14, 'approvals_timeline', 2),
    (11, 'financials',         1),
    (12, 'financials',         2),
    (15, 'governance',         1),
    (16, 'governance',         2)
)
UPDATE "SchoolPlanStep" s
SET "categoryId" = c."id",
    "sortOrder"  = m."sortOrder"
FROM step_map m, "SchoolPlanCategory" c
WHERE s."stepNo"    = m."stepNo"
  AND c."key"       = m."categoryKey"
  AND c."planId"    = s."planId"
  AND s."categoryId" IS NULL;

-- Any step still without a category (e.g. a stepNo that isn't in the 16 template
-- rows) drops into the first category of that plan so no step is orphaned.
UPDATE "SchoolPlanStep" s
SET "categoryId" = (
    SELECT c."id" FROM "SchoolPlanCategory" c
    WHERE c."planId" = s."planId"
    ORDER BY c."sortOrder" ASC LIMIT 1
)
WHERE s."categoryId" IS NULL;

-- 5. Wire the FK. Column stays nullable so category deletion can SetNull the
-- link (steps then fall into an "Uncategorised" bucket in the UI until the
-- user reassigns them). New seeded steps always have a category.
DO $$ BEGIN
    ALTER TABLE "SchoolPlanStep"
        ADD CONSTRAINT "SchoolPlanStep_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "SchoolPlanCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "SchoolPlanStep_planId_categoryId_sortOrder_idx"
    ON "SchoolPlanStep"("planId", "categoryId", "sortOrder");
