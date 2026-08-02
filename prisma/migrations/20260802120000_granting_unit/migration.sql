-- GrantingUnit: who makes and manages a grant (geo office / thematic team / ops team).
-- Distinct from City, which is operational geography. Replaces the hardcoded
-- ["Bangalore","Chennai","Others"] arrays and the `city === "Others" ? "Bangalore"`
-- registry fallback scattered across the budget portal.

CREATE TABLE "GrantingUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'geo',
    "registryCity" TEXT NOT NULL DEFAULT 'Bangalore',
    "cityId" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantingUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GrantingUnit_name_key" ON "GrantingUnit"("name");
CREATE INDEX "GrantingUnit_isActive_sortOrder_idx" ON "GrantingUnit"("isActive", "sortOrder");

ALTER TABLE "GrantingUnit" ADD CONSTRAINT "GrantingUnit_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrantingUnit" ADD CONSTRAINT "GrantingUnit_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "GrantingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the three units the hardcoded arrays used to encode. "Others" is the
-- catch-all every non-city grant landed in; it reads the Bangalore registry,
-- which is exactly what the old fallback did.
INSERT INTO "GrantingUnit" ("id", "name", "kind", "registryCity", "cityId", "sortOrder")
SELECT 'gu_bangalore', 'Bangalore', 'operational', 'Bangalore',
       (SELECT "id" FROM "City" WHERE "name" = 'Bangalore' AND "deletedAt" IS NULL LIMIT 1), 0
WHERE NOT EXISTS (SELECT 1 FROM "GrantingUnit" WHERE "name" = 'Bangalore');

INSERT INTO "GrantingUnit" ("id", "name", "kind", "registryCity", "cityId", "sortOrder")
SELECT 'gu_chennai', 'Chennai', 'operational', 'Chennai',
       (SELECT "id" FROM "City" WHERE "name" = 'Chennai' AND "deletedAt" IS NULL LIMIT 1), 1
WHERE NOT EXISTS (SELECT 1 FROM "GrantingUnit" WHERE "name" = 'Chennai');

INSERT INTO "GrantingUnit" ("id", "name", "kind", "registryCity", "cityId", "sortOrder")
SELECT 'gu_others', 'Others', 'thematic', 'Bangalore', NULL, 99
WHERE NOT EXISTS (SELECT 1 FROM "GrantingUnit" WHERE "name" = 'Others');

-- Budget.grantingUnitId
ALTER TABLE "Budget" ADD COLUMN "grantingUnitId" TEXT;
CREATE INDEX "Budget_grantingUnitId_idx" ON "Budget"("grantingUnitId");
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_grantingUnitId_fkey"
    FOREIGN KEY ("grantingUnitId") REFERENCES "GrantingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Budget" b SET "grantingUnitId" = g."id"
FROM "GrantingUnit" g WHERE g."name" = b."city";
-- Anything whose free-text city matched no unit belongs in the catch-all.
UPDATE "Budget" SET "grantingUnitId" = 'gu_others' WHERE "grantingUnitId" IS NULL;

-- GrantPartner.grantingUnitId
ALTER TABLE "GrantPartner" ADD COLUMN "grantingUnitId" TEXT;
CREATE INDEX "GrantPartner_grantingUnitId_idx" ON "GrantPartner"("grantingUnitId");
ALTER TABLE "GrantPartner" ADD CONSTRAINT "GrantPartner_grantingUnitId_fkey"
    FOREIGN KEY ("grantingUnitId") REFERENCES "GrantingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "GrantPartner" p SET "grantingUnitId" = g."id"
FROM "GrantingUnit" g WHERE g."name" = p."city";
UPDATE "GrantPartner" SET "grantingUnitId" = 'gu_others' WHERE "grantingUnitId" IS NULL;

-- Uniqueness moves from the free-text city label to the unit.
DROP INDEX IF EXISTS "GrantPartner_city_name_key";
CREATE UNIQUE INDEX "GrantPartner_grantingUnitId_name_key" ON "GrantPartner"("grantingUnitId", "name");
