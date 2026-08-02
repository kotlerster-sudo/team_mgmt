-- Named, frozen copies of a scope's cost registry so a rate revision can be
-- published and rolled back as one unit.
CREATE TABLE "CostRegistryVersion" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "CostRegistryVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CostRegistryVersion_city_publishedAt_idx" ON "CostRegistryVersion"("city", "publishedAt");
