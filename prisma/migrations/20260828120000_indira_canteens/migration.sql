-- Create IndiraCanteen table (Karnataka govt subsidised-meal canteens) mapped to settlements
CREATE TABLE "IndiraCanteen" (
  "id"        TEXT             NOT NULL,
  "name"      TEXT             NOT NULL,
  "lat"       DOUBLE PRECISION NOT NULL,
  "lng"       DOUBLE PRECISION NOT NULL,
  "kgisCode"  TEXT,
  "address"   TEXT,
  "createdAt" TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT "IndiraCanteen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndiraCanteen_kgisCode_key" ON "IndiraCanteen"("kgisCode");

-- Junction table: settlement ↔ Indira canteen with haversine distance
CREATE TABLE "SettlementCanteen" (
  "id"           TEXT             NOT NULL,
  "settlementId" TEXT             NOT NULL,
  "canteenId"    TEXT             NOT NULL,
  "distanceKm"   DOUBLE PRECISION NOT NULL,
  CONSTRAINT "SettlementCanteen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementCanteen_settlementId_canteenId_key"
  ON "SettlementCanteen"("settlementId", "canteenId");

ALTER TABLE "SettlementCanteen"
  ADD CONSTRAINT "SettlementCanteen_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementCanteen"
  ADD CONSTRAINT "SettlementCanteen_canteenId_fkey"
  FOREIGN KEY ("canteenId") REFERENCES "IndiraCanteen"("id") ON DELETE CASCADE ON UPDATE CASCADE;
