-- Visit-driven operations: Goal.mode, visit arrival + grouping on PitstopEvent,
-- catalog template def + per-centre catalog + catalog item approval.
-- All additive/nullable — safe to apply to a live DB.

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'setup';

-- AlterTable
ALTER TABLE "PitstopEvent" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedById" TEXT,
ADD COLUMN     "visitEventId" TEXT;

-- CreateTable
CREATE TABLE "CatalogTemplateDef" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "needsDomain" TEXT,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "defaultCadenceCount" INTEGER,
    "defaultCadencePeriod" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogTemplateDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentreCatalog" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "catalogSlug" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "cadenceCount" INTEGER,
    "cadencePeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentreCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemApproval" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItemApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTemplateDef_slug_key" ON "CatalogTemplateDef"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CentreCatalog_goalId_key" ON "CentreCatalog"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemApproval_goalId_itemKey_key" ON "CatalogItemApproval"("goalId", "itemKey");

-- AddForeignKey
ALTER TABLE "PitstopEvent" ADD CONSTRAINT "PitstopEvent_arrivedById_fkey" FOREIGN KEY ("arrivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitstopEvent" ADD CONSTRAINT "PitstopEvent_visitEventId_fkey" FOREIGN KEY ("visitEventId") REFERENCES "PitstopEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentreCatalog" ADD CONSTRAINT "CentreCatalog_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemApproval" ADD CONSTRAINT "CatalogItemApproval_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemApproval" ADD CONSTRAINT "CatalogItemApproval_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
