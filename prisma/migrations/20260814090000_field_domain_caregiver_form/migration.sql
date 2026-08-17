-- Additive: gate the caregiver_practices form option per domain. Default false;
-- flip Creche on (it is the only domain with a caregiver-practice catalog today).
ALTER TABLE "FieldDomainConfig" ADD COLUMN "caregiverForm" BOOLEAN NOT NULL DEFAULT false;

UPDATE "FieldDomainConfig" SET "caregiverForm" = true WHERE "domain" = 'Creche';
