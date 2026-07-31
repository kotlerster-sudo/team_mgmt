-- Scored checklists on facility indicator defs + per-capture answers.
-- Creche 24-point safety tick-list is the first consumer. All additive.

-- CreateTable
CREATE TABLE "IndicatorChecklistItemDef" (
    "id" TEXT NOT NULL,
    "defId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT,
    "nonNegotiable" BOOLEAN NOT NULL DEFAULT false,
    "naAllowed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndicatorChecklistItemDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndicatorPointAnswer" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "itemDefId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndicatorPointAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndicatorChecklistItemDef_defId_itemKey_key" ON "IndicatorChecklistItemDef"("defId", "itemKey");

-- CreateIndex
CREATE INDEX "IndicatorChecklistItemDef_defId_sortOrder_idx" ON "IndicatorChecklistItemDef"("defId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "IndicatorPointAnswer_pointId_itemDefId_key" ON "IndicatorPointAnswer"("pointId", "itemDefId");

-- CreateIndex
CREATE INDEX "IndicatorPointAnswer_itemDefId_answer_idx" ON "IndicatorPointAnswer"("itemDefId", "answer");

-- AddForeignKey
ALTER TABLE "IndicatorChecklistItemDef" ADD CONSTRAINT "IndicatorChecklistItemDef_defId_fkey" FOREIGN KEY ("defId") REFERENCES "FacilityIndicatorDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndicatorPointAnswer" ADD CONSTRAINT "IndicatorPointAnswer_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "FacilityIndicatorPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndicatorPointAnswer" ADD CONSTRAINT "IndicatorPointAnswer_itemDefId_fkey" FOREIGN KEY ("itemDefId") REFERENCES "IndicatorChecklistItemDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
