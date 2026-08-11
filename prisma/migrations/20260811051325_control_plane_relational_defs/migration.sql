-- Control-plane relational config graph (P1b). ADDITIVE ONLY — shreds GoalTemplateDef.pitstops /
-- CatalogTemplateDef.categories JSON into real tables, and adds FK-clean anchor columns to
-- ActivityIndicatorBinding / ProgrammeJourneyOutcome. JSON columns are kept (dual-write) and read
-- paths are unchanged until the P2 cutover. Hand-authored to exclude pre-existing schema drift.

-- AlterTable: FK-clean anchors (nullable, backfilled by script; string keys retained during dual-write)
ALTER TABLE "ActivityIndicatorBinding" ADD COLUMN     "catalogItemDefId" TEXT,
ADD COLUMN     "checklistDefId" TEXT;

ALTER TABLE "ProgrammeJourneyOutcome" ADD COLUMN     "bindingCatalogItemDefId" TEXT,
ADD COLUMN     "bindingChecklistDefId" TEXT;

-- CreateTable
CREATE TABLE "TemplatePitstopDef" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Discussion',
    "notes" TEXT NOT NULL DEFAULT '',
    "slaDays" INTEGER NOT NULL DEFAULT 0,
    "startSlaDays" INTEGER NOT NULL DEFAULT 0,
    "recurrence" TEXT NOT NULL DEFAULT 'None',
    "repeatCount" INTEGER NOT NULL DEFAULT 1,
    "progressTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplatePitstopDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateChecklistDef" (
    "id" TEXT NOT NULL,
    "pitstopDefId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completionType" TEXT NOT NULL DEFAULT 'Activity',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateChecklistDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateActivityDef" (
    "id" TEXT NOT NULL,
    "checklistDefId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completionType" TEXT NOT NULL DEFAULT 'Activity',
    "dayOffset" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateActivityDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCategoryDef" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCategoryDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemDef" (
    "id" TEXT NOT NULL,
    "categoryDefId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completionType" TEXT NOT NULL DEFAULT 'Activity',
    "blocksSignoff" BOOLEAN NOT NULL DEFAULT true,
    "checklistDefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItemDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplatePitstopDef_templateId_order_idx" ON "TemplatePitstopDef"("templateId", "order");
CREATE UNIQUE INDEX "TemplatePitstopDef_templateId_key_key" ON "TemplatePitstopDef"("templateId", "key");
CREATE INDEX "TemplateChecklistDef_pitstopDefId_order_idx" ON "TemplateChecklistDef"("pitstopDefId", "order");
CREATE UNIQUE INDEX "TemplateChecklistDef_pitstopDefId_key_key" ON "TemplateChecklistDef"("pitstopDefId", "key");
CREATE INDEX "TemplateActivityDef_checklistDefId_order_idx" ON "TemplateActivityDef"("checklistDefId", "order");
CREATE UNIQUE INDEX "TemplateActivityDef_checklistDefId_key_key" ON "TemplateActivityDef"("checklistDefId", "key");
CREATE INDEX "CatalogCategoryDef_catalogId_order_idx" ON "CatalogCategoryDef"("catalogId", "order");
CREATE UNIQUE INDEX "CatalogCategoryDef_catalogId_key_key" ON "CatalogCategoryDef"("catalogId", "key");
CREATE INDEX "CatalogItemDef_categoryDefId_order_idx" ON "CatalogItemDef"("categoryDefId", "order");
CREATE UNIQUE INDEX "CatalogItemDef_categoryDefId_key_key" ON "CatalogItemDef"("categoryDefId", "key");
CREATE INDEX "ActivityIndicatorBinding_checklistDefId_idx" ON "ActivityIndicatorBinding"("checklistDefId");
CREATE INDEX "ActivityIndicatorBinding_catalogItemDefId_idx" ON "ActivityIndicatorBinding"("catalogItemDefId");
CREATE INDEX "ProgrammeJourneyOutcome_bindingChecklistDefId_idx" ON "ProgrammeJourneyOutcome"("bindingChecklistDefId");
CREATE INDEX "ProgrammeJourneyOutcome_bindingCatalogItemDefId_idx" ON "ProgrammeJourneyOutcome"("bindingCatalogItemDefId");

-- AddForeignKey
ALTER TABLE "TemplatePitstopDef" ADD CONSTRAINT "TemplatePitstopDef_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GoalTemplateDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateChecklistDef" ADD CONSTRAINT "TemplateChecklistDef_pitstopDefId_fkey" FOREIGN KEY ("pitstopDefId") REFERENCES "TemplatePitstopDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateActivityDef" ADD CONSTRAINT "TemplateActivityDef_checklistDefId_fkey" FOREIGN KEY ("checklistDefId") REFERENCES "TemplateChecklistDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogCategoryDef" ADD CONSTRAINT "CatalogCategoryDef_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "CatalogTemplateDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogItemDef" ADD CONSTRAINT "CatalogItemDef_categoryDefId_fkey" FOREIGN KEY ("categoryDefId") REFERENCES "CatalogCategoryDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogItemDef" ADD CONSTRAINT "CatalogItemDef_checklistDefId_fkey" FOREIGN KEY ("checklistDefId") REFERENCES "TemplateChecklistDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityIndicatorBinding" ADD CONSTRAINT "ActivityIndicatorBinding_checklistDefId_fkey" FOREIGN KEY ("checklistDefId") REFERENCES "TemplateChecklistDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityIndicatorBinding" ADD CONSTRAINT "ActivityIndicatorBinding_catalogItemDefId_fkey" FOREIGN KEY ("catalogItemDefId") REFERENCES "CatalogItemDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgrammeJourneyOutcome" ADD CONSTRAINT "ProgrammeJourneyOutcome_bindingChecklistDefId_fkey" FOREIGN KEY ("bindingChecklistDefId") REFERENCES "TemplateChecklistDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProgrammeJourneyOutcome" ADD CONSTRAINT "ProgrammeJourneyOutcome_bindingCatalogItemDefId_fkey" FOREIGN KEY ("bindingCatalogItemDefId") REFERENCES "CatalogItemDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
