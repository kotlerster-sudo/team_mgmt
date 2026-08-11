-- De-hardcode centre-type suggestions: editable per facility layer.
ALTER TABLE "FacilityLayerConfig" ADD COLUMN "centreTypes" JSONB NOT NULL DEFAULT '[]';
