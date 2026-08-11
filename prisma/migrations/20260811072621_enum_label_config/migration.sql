-- De-hardcoded, editable display labels for behavior-bearing enums (code stays the stable key).
CREATE TABLE "EnumLabelConfig" (
    "id" TEXT NOT NULL,
    "enumKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnumLabelConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnumLabelConfig_enumKey_code_key" ON "EnumLabelConfig"("enumKey", "code");
CREATE INDEX "EnumLabelConfig_enumKey_sortOrder_idx" ON "EnumLabelConfig"("enumKey", "sortOrder");
