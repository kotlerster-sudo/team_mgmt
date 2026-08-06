-- Per-facility grain for Layer-2 indicators.
--
-- FacilityIndicator was unique per (defId, settlementId) — one row per
-- settlement, so multiple creches in one settlement shared a single set of
-- values. Add a nullable facilityId so a value can be captured against a
-- specific facility (a facility-linked goal's LayerFeature). NULL keeps the
-- settlement-level aggregate grain (MIS sync, civic domains, unlinked goals).
--
-- Safe: additive nullable column + index changes on a tiny table. No backfill —
-- existing rows stay settlement-level (facilityId NULL).

ALTER TABLE "FacilityIndicator" ADD COLUMN "facilityId" TEXT;

-- Replace the settlement-only unique with (def, settlement, facility). Postgres
-- treats NULLs as distinct in a composite unique, so this alone would allow
-- multiple settlement-level (NULL) rows — the partial index below closes that.
DROP INDEX "FacilityIndicator_defId_settlementId_key";

CREATE UNIQUE INDEX "FacilityIndicator_defId_settlementId_facilityId_key"
  ON "FacilityIndicator" ("defId", "settlementId", "facilityId");

-- Guarantee exactly one settlement-level (NULL-facility) row per (def, settlement).
CREATE UNIQUE INDEX "FacilityIndicator_def_settlement_null_facility_key"
  ON "FacilityIndicator" ("defId", "settlementId")
  WHERE "facilityId" IS NULL;

CREATE INDEX "FacilityIndicator_facilityId_idx" ON "FacilityIndicator" ("facilityId");

ALTER TABLE "FacilityIndicator"
  ADD CONSTRAINT "FacilityIndicator_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "LayerFeature" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
