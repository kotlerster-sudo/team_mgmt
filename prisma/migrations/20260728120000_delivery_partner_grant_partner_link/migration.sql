-- Link BudgetDeliveryPartner to the same GrantPartner registry that
-- Budget.grantPartnerId uses. Nullable so pre-link rows (free-text names)
-- survive until backfilled by scripts/backfill-delivery-partner-links.ts.
-- ON DELETE SET NULL matches Budget.grantPartner behaviour: deleting a
-- registry row keeps the budget line/tab intact with its free-text name.
ALTER TABLE "BudgetDeliveryPartner"
  ADD COLUMN IF NOT EXISTS "grantPartnerId" TEXT;

ALTER TABLE "BudgetDeliveryPartner"
  ADD CONSTRAINT "BudgetDeliveryPartner_grantPartnerId_fkey"
  FOREIGN KEY ("grantPartnerId") REFERENCES "GrantPartner"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "BudgetDeliveryPartner_grantPartnerId_idx"
  ON "BudgetDeliveryPartner"("grantPartnerId");
